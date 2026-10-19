//! Typed consumer commands.
//!
//! Consumers translate input (CLI flags, crude buttons, client
//! messages) into these commands. Parsing only converts arguments;
//! selection, sequencing, and transport policy live in the session.

use crate::ids::{RequestId, SessionId, SourceId};

/// Public commands use seconds; core converts them on the provider timeline.
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
        source: SourceId,
        options: LoadOptions,
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
    /// Seek to absolute media time in seconds.
    /// Bumps the generation and flushes older PCM.
    Seek {
        /// Command identity.
        request_id: RequestId,
        /// Session to seek.
        session: SessionId,
        /// Target time in seconds.
        time: MediaTime,
    },
    /// Stop output and park at the start without disposing the decoder.
    Stop {
        /// Command identity.
        request_id: RequestId,
        /// Session to stop.
        session: SessionId,
    },
    SetVolume {
        request_id: RequestId,
        session: SessionId,
        volume: f32,
    },
    SetMute {
        request_id: RequestId,
        session: SessionId,
        mute: bool,
    },
    Module {
        request_id: RequestId,
        session: SessionId,
        control: ModuleControl,
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
            | Self::Dispose { session, .. }
            | Self::SetVolume { session, .. }
            | Self::SetMute { session, .. }
            | Self::Module { session, .. } => session,
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
            | Self::Dispose { request_id, .. }
            | Self::SetVolume { request_id, .. }
            | Self::SetMute { request_id, .. }
            | Self::Module { request_id, .. } => request_id,
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

/// Public media time, in seconds. Validation occurs at command acceptance.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct MediaTime(pub f64);
impl MediaTime {
    pub fn frames(self, rate: u32) -> crate::Result<u64> {
        self.validate()?;
        if rate == 0 || self.0 * rate as f64 >= u64::MAX as f64 {
            return Err(crate::LibzciError::InvalidArgument {
                detail: "media time exceeds timeline".into(),
            });
        }
        Ok((self.0 * rate as f64).round() as u64)
    }
    pub fn from_frames(frames: u64, rate: u32) -> Self {
        Self(frames as f64 / rate.max(1) as f64)
    }
    pub fn validate(self) -> crate::Result<()> {
        if self.0.is_finite() && self.0 >= 0.0 {
            Ok(())
        } else {
            Err(crate::LibzciError::InvalidArgument {
                detail: "time must be finite and nonnegative seconds".into(),
            })
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct LoadOptions {
    pub start_time: MediaTime,
    pub subsong: Option<u32>,
}
#[derive(Clone, Copy, Debug)]
pub enum ModuleControl {
    Subsong(u32),
    Interpolation(u32),
    Ramping(i32),
    Speed(f64),
    Pitch(f64),
    LoopLimit(u32),
    ChannelMute { channel: u32, mute: bool },
}
impl ModuleControl {
    /// Validate before changing a generation or scheduling work.
    pub fn validate(self, caps: crate::ModuleCapabilities) -> crate::Result<()> {
        let valid = match self {
            Self::Subsong(n) => n < caps.subsongs,
            Self::Interpolation(n) => matches!(n, 1 | 2 | 4 | 8),
            Self::Ramping(n) => (-1..=10).contains(&n),
            Self::Speed(n) | Self::Pitch(n) => n.is_finite() && (0.25..=4.0).contains(&n),
            Self::LoopLimit(n) => n <= 16,
            Self::ChannelMute { channel, .. } => channel < caps.channels.min(256),
        };
        if !valid {
            return Err(crate::LibzciError::InvalidArgument {
                detail: "module parameter out of range".into(),
            });
        }
        let supported = match self {
            Self::Subsong(_) => caps.subsongs > 0,
            Self::Interpolation(_) => caps.interpolation,
            Self::Ramping(_) => caps.ramping,
            Self::Speed(_) => caps.speed,
            Self::Pitch(_) => caps.pitch,
            Self::LoopLimit(_) => caps.loop_limit,
            Self::ChannelMute { .. } => caps.channel_mute,
        };
        if supported {
            Ok(())
        } else {
            Err(crate::LibzciError::Unsupported {
                detail: "module control unavailable from this provider".into(),
            })
        }
    }
    pub fn same_parameter(self, other: Self) -> bool {
        match (self, other) {
            (Self::ChannelMute { channel: a, .. }, Self::ChannelMute { channel: b, .. }) => a == b,
            _ => std::mem::discriminant(&self) == std::mem::discriminant(&other),
        }
    }
}
