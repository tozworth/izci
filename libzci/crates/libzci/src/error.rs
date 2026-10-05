//! Typed errors.
//!
//! Each failure mode is a distinct variant so callers — and later the
//! crude UIs — can distinguish grant-required, unavailable/deleted,
//! corrupt, unsupported, and cancelled results instead of collapsing
//! them into one "unsupported" or "failed" bucket.

use std::fmt;

/// All fallible core/adapter operations report one of these.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum LibzciError {
    /// Source exists but the caller currently lacks permission.
    /// Startup scans must surface this without prompting; an explicit
    /// open/regrant gesture may retry the same command.
    AccessRequired { detail: String },
    /// Source was deleted or is otherwise unavailable.
    Unavailable { detail: String },
    /// No registered provider claims the (possibly sniffed) content.
    /// The extension is only a hint; this means bounded verification
    /// also declined.
    Unsupported { detail: String },
    /// A provider claimed the content but its bytes are damaged.
    Corrupt { detail: String },
    /// The operation was cancelled (caller token, seek supersede, or
    /// session disposal) before completion.
    Cancelled,
    /// Decoder accepted the source then failed during read/seek.
    DecoderFailure { detail: String },
    /// No usable output device (native) or AudioContext (browser).
    DeviceUnavailable { detail: String },
    /// Caller supplied an out-of-range argument.
    InvalidArgument { detail: String },
    /// Internal resource budget exhausted (too many open instances,
    /// oversized buffer request, queue full).
    ResourceExhausted { detail: String },
}

impl LibzciError {
    /// Short stable kind label for diagnostics/telemetry grouping.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::AccessRequired { .. } => "access-required",
            Self::Unavailable { .. } => "unavailable",
            Self::Unsupported { .. } => "unsupported",
            Self::Corrupt { .. } => "corrupt",
            Self::Cancelled => "cancelled",
            Self::DecoderFailure { .. } => "decoder-failure",
            Self::DeviceUnavailable { .. } => "device-unavailable",
            Self::InvalidArgument { .. } => "invalid-argument",
            Self::ResourceExhausted { .. } => "resource-exhausted",
        }
    }

    /// `true` for cancellation, which callers usually suppress rather
    /// than display as a failure.
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

impl fmt::Display for LibzciError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AccessRequired { detail } => write!(f, "access required: {detail}"),
            Self::Unavailable { detail } => write!(f, "unavailable: {detail}"),
            Self::Unsupported { detail } => write!(f, "unsupported: {detail}"),
            Self::Corrupt { detail } => write!(f, "corrupt: {detail}"),
            Self::Cancelled => write!(f, "cancelled"),
            Self::DecoderFailure { detail } => write!(f, "decoder failure: {detail}"),
            Self::DeviceUnavailable { detail } => write!(f, "device unavailable: {detail}"),
            Self::InvalidArgument { detail } => write!(f, "invalid argument: {detail}"),
            Self::ResourceExhausted { detail } => {
                write!(f, "resource exhausted: {detail}")
            }
        }
    }
}

impl std::error::Error for LibzciError {}

/// Convenience alias used across the workspace.
pub type Result<T> = std::result::Result<T, LibzciError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_kinds_do_not_collapse() {
        let variants = [
            LibzciError::AccessRequired {
                detail: "grant".into(),
            },
            LibzciError::Unavailable {
                detail: "gone".into(),
            },
            LibzciError::Unsupported {
                detail: "nope".into(),
            },
            LibzciError::Corrupt {
                detail: "bad".into(),
            },
            LibzciError::Cancelled,
        ];
        let kinds: Vec<_> = variants.iter().map(|e| e.kind()).collect();
        let mut sorted = kinds.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), variants.len());
    }
}
