//! Typed consumer commands.
//!
//! Consumers translate input (CLI flags, crude buttons, client
//! messages) into these commands. Parsing only converts arguments;
//! selection, sequencing, and transport policy live in the session.

use crate::ids::{RequestId, SessionId};

/// Target frame rate note: positions are expressed in provider-timeline
/// frames so seeks are exact before any output-rate conversion.
#[derive(Clone, Debug)]
pub enum Command {
    /// Open `source` on the session, replacing any current decoder.
    /// Bumps the generation; in-flight PCM from older generations is
    /// discarded.
    Load {
        /// Command identity for accept/complete matching.
        request_id: RequestId,
        /// Session to load into.
        session: SessionId,
        /// Extension hint (`"opus"`, `"mod"`, ...) when known.
        extension_hint: Option<String>,
    },
    /// Start or resume output. Distinct from output actually running
    /// (see snapshots/events).
    Play {
        /// Command identity.
        request_id: RequestId,
        /// Session to play.
        session: SessionId,
    },
    /// Pause output, retaining position and decoder.
    Pause {
        /// Command identity.
        request_id: RequestId,
        /// Session to pause.
        session: SessionId,
    },
    /// Seek to an absolute frame on the provider timeline.
    /// Bumps the generation and flushes older PCM.
    Seek {
        /// Command identity.
        request_id: RequestId,
        /// Session to seek.
        session: SessionId,
        /// Target frame.
        frame: u64,
    },
    /// Stop output and park at the start without disposing the decoder.
    Stop {
        /// Command identity.
        request_id: RequestId,
        /// Session to stop.
        session: SessionId,
    },
    /// Dispose the session: no further results from it become
    /// authoritative and its buffers are released.
    Dispose {
        /// Command identity.
        request_id: RequestId,
        /// Session to dispose.
        session: SessionId,
    },
}

impl Command {
    /// Session this command targets.
    pub fn session(&self) -> SessionId {
        match *self {
            Self::Load { session, .. }
            | Self::Play { session, .. }
            | Self::Pause { session, .. }
            | Self::Seek { session, .. }
            | Self::Stop { session, .. }
            | Self::Dispose { session, .. } => session,
        }
    }

    /// Request ID for accept/complete matching and duplicate
    /// suppression at transport seams.
    pub fn request_id(&self) -> RequestId {
        match *self {
            Self::Load { request_id, .. }
            | Self::Play { request_id, .. }
            | Self::Pause { request_id, .. }
            | Self::Seek { request_id, .. }
            | Self::Stop { request_id, .. }
            | Self::Dispose { request_id, .. } => request_id,
        }
    }
}

/// Immediate acceptance receipt. Acceptance can precede a completed
/// open/seek; observers learn completion via snapshots/events.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CommandAccept {
    /// Echoed request.
    pub request_id: RequestId,
    /// Target session.
    pub session: SessionId,
    /// Generation the command was accepted under.
    pub generation: crate::ids::Generation,
}
