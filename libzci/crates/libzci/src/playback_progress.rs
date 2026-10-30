//! Output observations carry two separate clocks: source position for seeking
//! and actual consumed media duration for continuous-play accounting.
use crate::{ChannelLayout, LibzciError, PcmLayout, Result};
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlaybackProgress {
    pub position_frames: u64,
    pub consumed_frames: u64,
    pub output_rate: u32,
    /// Adapter-observed UTC time, never used to advance playback or qualify a
    /// play. It timestamps the already consumed threshold crossing only.
    pub observed_at_ms: u64,
}
impl PlaybackProgress {
    pub fn validate(&self) -> Result<()> {
        PcmLayout::new(ChannelLayout::Stereo, self.output_rate)?;
        if self.observed_at_ms > crate::catalog::MAX_ID {
            return Err(LibzciError::InvalidArgument {
                detail: "invalid playback observation timestamp".into(),
            });
        }
        Ok(())
    }
}
