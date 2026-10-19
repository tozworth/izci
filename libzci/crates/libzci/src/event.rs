//! Observer events and bounded telemetry.
//!
//! Observers receive authoritative snapshots plus a bounded,
//! coalesced event stream. Slow consumers cannot accumulate
//! unlimited telemetry: progress/meters coalesce to the latest,
//! while state completions and errors are never dropped silently
//! (the queue reports overflow explicitly).

use std::collections::VecDeque;

use crate::error::LibzciError;
use crate::ids::{Generation, RequestId, Revision, SessionId};

/// Session transport snapshot shared with all observers.
#[derive(Clone, Debug)]
pub struct Snapshot {
    /// Session observed.
    pub session: SessionId,
    /// Snapshot revision (bumped after every committed change).
    pub revision: Revision,
    /// Current validity epoch.
    pub generation: Generation,
    /// Transport state.
    pub state: crate::session::TransportState,
    /// Selected provider, when a source is open.
    pub provider: Option<crate::provider::ProviderInfo>,
    /// Position in provider-timeline frames.
    pub position_frames: u64,
    /// Finite total in frames, when known.
    pub total_frames: Option<u64>,
    /// Last terminal error, if the state is failed.
    pub error: Option<LibzciError>,
    /// Request that produced this snapshot, when applicable.
    pub request_id: Option<RequestId>,
    pub layout: Option<crate::PcmLayout>,
    pub metadata: Option<std::sync::Arc<crate::ProviderMetadata>>,
    pub volume: f32,
    pub mute: bool,
    pub requested: crate::RequestedState,
    pub running: crate::RunningState,
    pub decoding_eof: bool,
    pub pending_operation: bool,
    pub capabilities: crate::ModuleCapabilities,
    pub module: Option<std::sync::Arc<crate::ModuleObservation>>,
}

/// A bounded event drain includes loss counters and a recovery snapshot.
#[derive(Clone, Debug)]
pub struct EventBatch {
    pub events: Vec<Event>,
    pub coalesced: u64,
    pub dropped: u64,
    pub snapshot: Snapshot,
}

/// Observable session event.
#[derive(Clone, Debug)]
pub enum Event {
    /// Authoritative state changed; render `snapshot`.
    StateChanged {
        /// Session that changed.
        session: SessionId,
        /// Current generation.
        generation: Generation,
        /// Snapshot revision.
        revision: Revision,
    },
    /// A decode/open/seek job completed.
    Completed {
        /// Session that completed.
        session: SessionId,
        /// Command that completed.
        request_id: RequestId,
        /// Generation the work was accepted under.
        generation: Generation,
    },
    /// A job failed. Cancellation is reported here too so adapters
    /// can release buffers; UIs usually suppress it.
    Failed {
        /// Session that failed.
        session: SessionId,
        /// Command that failed, when known.
        request_id: Option<RequestId>,
        /// Generation the work belonged to.
        generation: Generation,
        /// Typed failure.
        error: LibzciError,
    },
    /// Rapidly changing telemetry (position/meters). Coalesced: only
    /// the latest per session is retained when the queue fills.
    Progress {
        /// Session progressing.
        session: SessionId,
        /// Generation the progress belongs to.
        generation: Generation,
        /// Position in frames.
        position_frames: u64,
    },
}

impl Event {
    /// Session this event belongs to.
    pub fn session(&self) -> SessionId {
        match *self {
            Self::StateChanged { session, .. }
            | Self::Completed { session, .. }
            | Self::Failed { session, .. }
            | Self::Progress { session, .. } => session,
        }
    }

    /// Generation this event belongs to.
    pub fn generation(&self) -> Generation {
        match *self {
            Self::StateChanged { generation, .. }
            | Self::Completed { generation, .. }
            | Self::Failed { generation, .. }
            | Self::Progress { generation, .. } => generation,
        }
    }

    /// `true` for coalescible telemetry.
    pub fn is_coalescible(&self) -> bool {
        matches!(self, Self::Progress { .. })
    }
}

/// Bounded observer queue with progress coalescing.
#[derive(Debug)]
pub struct EventQueue {
    queue: VecDeque<Event>,
    capacity: usize,
    /// Number of coalesced (dropped intermediate) progress events.
    pub coalesced: u64,
    /// Number of non-coalescible events dropped on overflow.
    pub dropped: u64,
}

impl EventQueue {
    /// Create with an explicit bound (tests use small bounds to prove
    /// coalescing; production uses hundreds).
    pub fn new(capacity: usize) -> Self {
        Self {
            queue: VecDeque::new(),
            capacity: capacity.max(1),
            coalesced: 0,
            dropped: 0,
        }
    }

    /// Push one event, coalescing progress when full.
    pub fn push(&mut self, event: Event) {
        if self.queue.len() >= self.capacity {
            if event.is_coalescible() {
                // Replace the newest coalescible event for the same
                // session, else drop the incoming one.
                if let Some(pos) = self
                    .queue
                    .iter()
                    .rposition(|e| e.is_coalescible() && e.session() == event.session())
                {
                    self.queue[pos] = event;
                    self.coalesced += 1;
                    return;
                }
                self.coalesced += 1;
                return;
            }
            // Non-coalescible overflow: drop the oldest coalescible
            // event first to protect completions/errors.
            if let Some(pos) = self.queue.iter().position(|e| e.is_coalescible()) {
                self.queue.remove(pos);
                self.coalesced += 1;
            } else {
                self.queue.pop_front();
                self.dropped += 1;
            }
        }
        self.queue.push_back(event);
    }

    /// Drain all queued events in order.
    pub fn drain(&mut self) -> Vec<Event> {
        self.queue.drain(..).collect()
    }

    /// Queued length.
    pub fn len(&self) -> usize {
        self.queue.len()
    }

    /// `true` when empty.
    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::SessionId;

    fn progress(session: SessionId, pos: u64) -> Event {
        Event::Progress {
            session,
            generation: Generation::INITIAL,
            position_frames: pos,
        }
    }

    #[test]
    fn progress_coalesces_under_bound() {
        let session = SessionId::fresh();
        let mut q = EventQueue::new(2);
        q.push(progress(session, 1));
        q.push(progress(session, 2));
        q.push(progress(session, 3));
        assert_eq!(q.len(), 2);
        assert!(q.coalesced >= 1);
        let drained = q.drain();
        assert_eq!(drained.len(), 2);
    }
}
