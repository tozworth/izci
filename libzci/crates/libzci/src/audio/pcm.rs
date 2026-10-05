//! Float PCM transport types.
//!
//! All providers normalize to interleaved `f32` PCM with an explicit
//! channel layout and sample rate. Container trims and mandatory
//! header gains are applied exactly once by the provider and declared
//! in its metadata, so later ReplayGain/Raf stages never double-apply
//! them.

use crate::error::{LibzciError, Result};

/// Channel layout of a PCM buffer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ChannelLayout {
    /// One channel; output stages upmix to stereo.
    Mono,
    /// Two interleaved channels (L, R, L, R, ...).
    Stereo,
}

impl ChannelLayout {
    /// Number of interleaved channels.
    pub fn channels(self) -> u16 {
        match self {
            Self::Mono => 1,
            Self::Stereo => 2,
        }
    }
}

/// Sample rate plus channel layout for a PCM stream.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct PcmLayout {
    /// Channel arrangement.
    pub layout: ChannelLayout,
    /// Samples per second per channel (8000..=192000).
    pub sample_rate: u32,
}

impl PcmLayout {
    /// Validate and construct a layout.
    pub fn new(layout: ChannelLayout, sample_rate: u32) -> Result<Self> {
        if !(8000..=192000).contains(&sample_rate) {
            return Err(LibzciError::InvalidArgument {
                detail: format!("sample rate out of range: {sample_rate}"),
            });
        }
        Ok(Self {
            layout,
            sample_rate,
        })
    }

    /// Mono convenience at 48 kHz (fixture baseline).
    pub fn mono48k() -> Self {
        Self {
            layout: ChannelLayout::Mono,
            sample_rate: 48_000,
        }
    }

    /// Stereo convenience at 48 kHz (output baseline).
    pub fn stereo48k() -> Self {
        Self {
            layout: ChannelLayout::Stereo,
            sample_rate: 48_000,
        }
    }
}

/// One bounded decoded PCM chunk.
///
/// `frames` holds `frame_count * channels` interleaved finite `f32`
/// samples. `start_frame` is the provider-timeline offset of the first
/// frame, letting the session discard stale generations after a seek.
#[derive(Clone, Debug)]
pub struct PcmChunk {
    /// Layout of `frames`.
    pub layout: PcmLayout,
    /// First frame index on the provider timeline.
    pub start_frame: u64,
    /// Interleaved finite samples.
    pub frames: Vec<f32>,
}

impl PcmChunk {
    /// Empty chunk at the given timeline position.
    pub fn empty(layout: PcmLayout, start_frame: u64) -> Self {
        Self {
            layout,
            start_frame,
            frames: Vec::new(),
        }
    }

    /// Number of frames (per channel).
    pub fn frame_count(&self) -> usize {
        let ch = self.layout.layout.channels() as usize;
        if ch == 0 {
            0
        } else {
            self.frames.len() / ch
        }
    }

    /// Duration in seconds at the chunk layout rate.
    pub fn duration_secs(&self) -> f64 {
        self.frame_count() as f64 / self.layout.sample_rate as f64
    }

    /// Verify interleaving is exact and every sample is finite.
    /// Providers must guarantee this; sessions debug-assert it before
    /// publishing PCM to any observer.
    pub fn validate(&self) -> Result<()> {
        let ch = self.layout.layout.channels() as usize;
        if self.frames.len() % ch != 0 {
            return Err(LibzciError::DecoderFailure {
                detail: "pcm length not a multiple of channel count".into(),
            });
        }
        if self.frames.iter().any(|s| !s.is_finite()) {
            return Err(LibzciError::DecoderFailure {
                detail: "non-finite pcm sample".into(),
            });
        }
        Ok(())
    }

    /// `true` when every sample is finite (cheap pre-check for tests).
    pub fn all_finite(&self) -> bool {
        self.frames.iter().all(|s| s.is_finite())
    }

    /// `true` when at least one sample is nonzero (audibility hint;
    /// silence is valid PCM, so callers must not treat empty as error).
    pub fn has_nonzero(&self) -> bool {
        self.frames.iter().any(|&s| s != 0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_bad_sample_rate() {
        assert!(PcmLayout::new(ChannelLayout::Stereo, 7999).is_err());
        assert!(PcmLayout::new(ChannelLayout::Stereo, 48_000).is_ok());
    }

    #[test]
    fn validates_finiteness_and_interleave() {
        let layout = PcmLayout::stereo48k();
        let ok = PcmChunk {
            layout,
            start_frame: 0,
            frames: vec![0.0, 0.5, -0.5, 0.25],
        };
        assert!(ok.validate().is_ok());
        let bad = PcmChunk {
            layout,
            start_frame: 0,
            frames: vec![0.0, f32::NAN],
        };
        assert!(bad.validate().is_err());
        let odd = PcmChunk {
            layout,
            start_frame: 0,
            frames: vec![0.1, 0.2, 0.3],
        };
        assert!(odd.validate().is_err());
    }
}
