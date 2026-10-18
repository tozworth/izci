//! Device-independent transport owner. No provider calls, I/O, or waiting here.
use crate::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransportState {
    Idle,
    Loading,
    Ready,
    Playing,
    Ended,
    Failed,
    OutputSuspended,
}

/// Every asynchronous result identifies the instance, operation and validity epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JobTag {
    pub session: SessionId,
    pub instance: RequestId,
    pub operation: RequestId,
    pub generation: Generation,
}
#[derive(Clone, Debug)]
pub enum SessionAction {
    Open {
        tag: JobTag,
        source: SourceId,
        hint: Option<String>,
        options: LoadOptions,
    },
    Seek {
        tag: JobTag,
        time: MediaTime,
    },
    Module {
        tag: JobTag,
        control: ModuleControl,
    },
    Output,
    Close,
}

pub struct Session {
    snapshot: Snapshot,
    instance: RequestId,
    operation: RequestId,
    disposed: bool,
    receipts: std::collections::VecDeque<CommandAccept>,
}
impl Session {
    pub fn new(id: SessionId) -> Self {
        Self {
            snapshot: Snapshot {
                session: id,
                revision: Revision::INITIAL,
                generation: Generation::INITIAL,
                state: TransportState::Idle,
                provider: None,
                position_frames: 0,
                total_frames: None,
                error: None,
                request_id: None,
                layout: None,
                metadata: None,
                volume: 1.0,
                mute: false,
                requested: RequestedState::Held,
                running: RunningState::Closed,
                decoding_eof: false,
                pending_operation: false,
                capabilities: ModuleCapabilities::default(),
            },
            instance: RequestId(0),
            operation: RequestId(0),
            disposed: false,
            receipts: Default::default(),
        }
    }
    pub fn id(&self) -> SessionId {
        self.snapshot.session
    }
    pub fn generation(&self) -> Generation {
        self.snapshot.generation
    }
    pub fn revision(&self) -> Revision {
        self.snapshot.revision
    }
    pub fn state(&self) -> TransportState {
        self.snapshot.state
    }
    pub fn position_frames(&self) -> u64 {
        self.snapshot.position_frames
    }
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.clone()
    }
    pub fn is_current(&self, generation: Generation) -> bool {
        !self.disposed && generation == self.generation()
    }
    pub fn receipt(&self, request: RequestId) -> Option<CommandAccept> {
        self.receipts
            .iter()
            .find(|r| r.request_id == request)
            .copied()
    }
    pub fn tag(&self) -> JobTag {
        JobTag {
            session: self.id(),
            instance: self.instance,
            operation: self.operation,
            generation: self.generation(),
        }
    }
    pub fn accepts(&self, tag: JobTag) -> bool {
        !self.disposed && tag == self.tag()
    }
    fn commit(&mut self) {
        self.snapshot.revision.bump();
    }
    fn invalidate(&mut self, request: RequestId) {
        self.snapshot.generation.bump();
        self.operation = request;
        self.snapshot.decoding_eof = false;
        self.snapshot.pending_operation = true;
    }
    pub fn accept(&mut self, command: &Command) -> Result<(CommandAccept, Vec<SessionAction>)> {
        if self.disposed {
            return Err(LibzciError::Cancelled);
        }
        if command.session() != self.id() {
            return Err(invalid("wrong session"));
        }
        let request = command.request_id();
        if let Some(receipt) = self.receipts.iter().find(|r| r.request_id == request) {
            return Ok((*receipt, Vec::new()));
        }
        let mut actions = vec![SessionAction::Output];
        match command {
            Command::Load {
                source,
                options,
                extension_hint,
                ..
            } => {
                options.start_time.validate()?;
                self.invalidate(request);
                self.instance = request;
                self.snapshot.state = TransportState::Loading;
                self.snapshot.provider = None;
                self.snapshot.layout = None;
                self.snapshot.metadata = None;
                self.snapshot.total_frames = None;
                self.snapshot.position_frames = 0;
                self.snapshot.error = None;
                self.snapshot.requested = RequestedState::Held;
                actions.push(SessionAction::Open {
                    tag: self.tag(),
                    source: *source,
                    hint: extension_hint.clone(),
                    options: options.clone(),
                });
            }
            Command::Seek { time, .. } => {
                time.validate()?;
                if self.instance.0 == 0 {
                    return Err(invalid("seek with no source"));
                }
                if let Some(layout) = self.snapshot.layout {
                    time.frames(layout.sample_rate)?;
                }
                self.invalidate(request);
                self.snapshot.error = None;
                if self.snapshot.state == TransportState::Ended {
                    self.snapshot.state = TransportState::Ready;
                }
                actions.push(SessionAction::Seek {
                    tag: self.tag(),
                    time: *time,
                });
            }
            Command::Stop { .. } => {
                self.invalidate(request);
                self.snapshot.requested = RequestedState::Held;
                self.snapshot.position_frames = 0;
                self.snapshot.error = None;
                self.snapshot.state = if self.instance.0 == 0 {
                    TransportState::Idle
                } else {
                    TransportState::Ready
                };
                if self.instance.0 != 0 {
                    actions.push(SessionAction::Seek {
                        tag: self.tag(),
                        time: MediaTime(0.0),
                    });
                } else {
                    self.snapshot.pending_operation = false;
                }
            }
            Command::Play { .. } => {
                if matches!(
                    self.snapshot.state,
                    TransportState::Idle | TransportState::Failed
                ) {
                    return Err(self
                        .snapshot
                        .error
                        .clone()
                        .unwrap_or_else(|| invalid("play with no playable source")));
                }
                if self.snapshot.state == TransportState::Ended {
                    self.invalidate(request);
                    actions.push(SessionAction::Seek {
                        tag: self.tag(),
                        time: MediaTime(0.0),
                    });
                }
                self.snapshot.requested = RequestedState::Running;
                if self.snapshot.state != TransportState::Loading {
                    self.snapshot.state = TransportState::Playing;
                }
            }
            Command::Pause { .. } => {
                self.snapshot.requested = RequestedState::Held;
                if self.snapshot.state == TransportState::Playing {
                    self.snapshot.state = TransportState::Ready;
                }
            }
            Command::SetVolume { volume, .. } => {
                if !volume.is_finite() || !(0.0..=1.0).contains(volume) {
                    return Err(invalid("volume must be finite in 0..=1"));
                }
                self.snapshot.volume = *volume;
            }
            Command::SetMute { mute, .. } => self.snapshot.mute = *mute,
            Command::Module { control, .. } => {
                if self.snapshot.layout.is_none() {
                    return Err(invalid("module is not loaded"));
                }
                if matches!(control, ModuleControl::ChannelMute { channel, .. } if *channel >= 256)
                {
                    return Err(invalid("module channel exceeds control budget"));
                }
                let caps = self.snapshot.capabilities;
                let supported = match control {
                    ModuleControl::Subsong(_) => caps.subsongs > 0,
                    ModuleControl::Interpolation(_) => caps.interpolation,
                    ModuleControl::ChannelMute { .. } => caps.channel_mute,
                };
                if !supported {
                    return Err(LibzciError::Unsupported {
                        detail: "module control unavailable".into(),
                    });
                }
                self.invalidate(request);
                actions.push(SessionAction::Module {
                    tag: self.tag(),
                    control: *control,
                });
            }
            Command::Dispose { .. } => {
                self.invalidate(request);
                self.disposed = true;
                self.snapshot.requested = RequestedState::Held;
                self.snapshot.running = RunningState::Closed;
                self.snapshot.state = TransportState::Idle;
                self.snapshot.pending_operation = false;
                actions.push(SessionAction::Close);
            }
        }
        self.snapshot.request_id = Some(request);
        self.commit();
        let receipt = CommandAccept {
            session: self.id(),
            request_id: request,
            generation: self.generation(),
        };
        if self.receipts.len() == 128 {
            self.receipts.pop_front();
        }
        self.receipts.push_back(receipt);
        Ok((receipt, actions))
    }
    pub fn opened(
        &mut self,
        tag: JobTag,
        metadata: ProviderMetadata,
        capabilities: ModuleCapabilities,
        position: u64,
    ) -> bool {
        if !self.accepts(tag) {
            return false;
        }
        self.snapshot.provider = Some(metadata.info);
        self.snapshot.layout = Some(metadata.layout);
        self.snapshot.total_frames = metadata.total_frames;
        self.snapshot.capabilities = capabilities;
        self.snapshot.metadata = Some(std::sync::Arc::new(metadata));
        self.landed(tag, position)
    }
    pub fn landed(&mut self, tag: JobTag, position: u64) -> bool {
        if !self.accepts(tag) {
            return false;
        }
        self.snapshot.position_frames = position;
        self.snapshot.pending_operation = false;
        self.snapshot.state = if self.snapshot.requested == RequestedState::Running {
            TransportState::Playing
        } else {
            TransportState::Ready
        };
        self.commit();
        true
    }
    pub fn failed(&mut self, tag: JobTag, error: LibzciError) -> bool {
        if !self.accepts(tag) {
            return false;
        }
        self.snapshot.error = Some(error);
        self.snapshot.state = TransportState::Failed;
        self.snapshot.requested = RequestedState::Held;
        self.snapshot.pending_operation = false;
        self.commit();
        true
    }
    pub fn eof(&mut self, tag: JobTag) {
        if self.accepts(tag) {
            self.snapshot.decoding_eof = true;
            self.commit();
        }
    }
    /// Consumption is on the source timeline, independent of underrun silence.
    pub fn consumed(&mut self, generation: Generation, position: u64, final_consumed: bool) {
        if !self.is_current(generation) || self.snapshot.pending_operation {
            return;
        }
        if self.snapshot.requested == RequestedState::Running {
            self.snapshot.position_frames =
                position.min(self.snapshot.total_frames.unwrap_or(u64::MAX));
            if final_consumed && self.snapshot.decoding_eof {
                self.snapshot.state = TransportState::Ended;
                self.snapshot.requested = RequestedState::Held;
            }
            self.commit();
        }
    }
    pub fn output_state(&mut self, running: RunningState) {
        if self.snapshot.running == running {
            return;
        }
        self.snapshot.running = running;
        if self.snapshot.requested == RequestedState::Running && running == RunningState::Suspended
        {
            self.snapshot.state = TransportState::OutputSuspended;
        } else if self.snapshot.state == TransportState::OutputSuspended
            && running == RunningState::Running
        {
            self.snapshot.state = TransportState::Playing;
        }
        self.commit();
    }
}
fn invalid(detail: &str) -> LibzciError {
    LibzciError::InvalidArgument {
        detail: detail.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn time_conversion_validates_units() {
        assert_eq!(MediaTime(0.5).frames(44_100).unwrap(), 22_050);
        for value in [f64::NAN, f64::INFINITY, -1.0, f64::MAX] {
            assert!(MediaTime(value).frames(48_000).is_err());
        }
    }
    #[test]
    fn stop_and_dispose_reject_late_jobs() {
        let mut s = Session::new(SessionId::fresh());
        s.accept(&Command::Load {
            session: s.id(),
            request_id: RequestId::fresh(),
            source: SourceId::fresh(),
            options: LoadOptions::default(),
            extension_hint: None,
        })
        .unwrap();
        let old = s.tag();
        s.accept(&Command::Stop {
            session: s.id(),
            request_id: RequestId::fresh(),
        })
        .unwrap();
        assert!(!s.landed(old, 999));
        let tag = s.tag();
        s.accept(&Command::Dispose {
            session: s.id(),
            request_id: RequestId::fresh(),
        })
        .unwrap();
        assert!(!s.failed(tag, LibzciError::Cancelled));
    }
}
