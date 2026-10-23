//! Device-rate conversion over the pinned maintained resampler.
//!
//! [`RateConverter`] wraps `rubato` FFT sinc resampling (pinned in
//! `Cargo.lock`) behind the engine's staging discipline: bounded
//! decode chunks in, fixed input blocks through the resampler,
//! device-rate frames out of a FIFO. State is explicit (input
//! staging, output FIFO, delay/drain accounting); ratio changes
//! rebuild the converter rather than mutating it mid-stream.

use rubato::{Fft, FixedSync, Resampler};

/// Streaming 1–2 channel float resampler.
pub struct RateConverter {
    inner: Fft<f32>,
    channels: usize,
    from_rate: u32,
    to_rate: u32,
    /// Staged input frames (interleaved) awaiting a full block.
    staging: Vec<f32>,
    /// Converted output frames (interleaved) awaiting pop.
    fifo: Vec<f32>,
    /// Total input frames accepted (pre-delay timeline).
    accepted_frames: u64,
    /// Total output frames popped.
    emitted_frames: u64,
    delay_left: usize,
    flushed: bool,
    output: rubato::audioadapter_buffers::owned::InterleavedOwned<f32>,
}

impl RateConverter {
    /// Maximum accepted source block; callers must drain output before feeding.
    pub const MAX_INPUT_FRAMES: usize = 4096;
    /// Create for `from_rate` → `to_rate` with `channels` (1–2).
    /// A 1:1 ratio still normalizes through the same path (cheap) so
    /// behavior is uniform; callers may bypass when rates match.
    pub fn new(from_rate: u32, to_rate: u32, channels: usize) -> crate::Result<Self> {
        if channels == 0 || channels > 2 {
            return Err(crate::LibzciError::InvalidArgument {
                detail: format!("resampler channels {channels}"),
            });
        }
        if !(8000..=192000).contains(&from_rate) || !(8000..=192000).contains(&to_rate) {
            return Err(crate::LibzciError::InvalidArgument {
                detail: format!("resampler rates {from_rate}->{to_rate}"),
            });
        }
        let chunk = 1024usize;
        let inner = Fft::<f32>::new(
            from_rate as usize,
            to_rate as usize,
            chunk,
            channels,
            FixedSync::Input,
        )
        .map_err(|e| crate::LibzciError::InvalidArgument {
            detail: format!("rubato construction: {e:?}"),
        })?;
        let need = inner.input_frames_max();
        let output_max = inner.output_frames_max();
        let delay = inner.output_delay();
        // One maximum input block plus a staged remainder, and enough zero-pad
        // blocks to release the filter delay at EOF. All storage stays bounded.
        let fifo_frames =
            (Self::MAX_INPUT_FRAMES / need + 3 + delay.div_ceil(output_max)) * output_max;
        let output =
            rubato::audioadapter_buffers::owned::InterleavedOwned::new(0.0, channels, output_max);
        Ok(Self {
            inner,
            channels,
            from_rate,
            to_rate,
            staging: Vec::with_capacity((Self::MAX_INPUT_FRAMES + need) * channels),
            fifo: Vec::with_capacity(fifo_frames * channels),
            accepted_frames: 0,
            emitted_frames: 0,
            delay_left: delay,
            flushed: false,
            output,
        })
    }

    /// Input rate.
    pub fn from_rate(&self) -> u32 {
        self.from_rate
    }

    /// Output (device) rate.
    pub fn to_rate(&self) -> u32 {
        self.to_rate
    }

    /// Output delay in device frames (startup transient).
    pub fn output_delay_frames(&self) -> usize {
        self.inner.output_delay()
    }

    /// Feed a bounded input block after draining the previous output.
    pub fn push(&mut self, samples: &[f32]) -> crate::Result<()> {
        if !samples.len().is_multiple_of(self.channels)
            || samples.len() / self.channels > Self::MAX_INPUT_FRAMES
            || !self.fifo.is_empty()
            || self.flushed
            || samples.iter().any(|s| !s.is_finite())
        {
            return Err(crate::LibzciError::InvalidArgument {
                detail: "invalid or uncredited resampler input".into(),
            });
        }
        self.staging.extend_from_slice(samples);
        self.accepted_frames += samples.len() as u64 / self.channels as u64;
        self.drain_blocks()
    }

    /// Pop up to `out.len()` interleaved output samples.
    /// Returns samples written.
    pub fn pop(&mut self, out: &mut [f32]) -> usize {
        let n = (out.len().min(self.fifo.len()) / self.channels) * self.channels;
        out[..n].copy_from_slice(&self.fifo[..n]);
        self.fifo.drain(..n);
        self.emitted_frames += n as u64 / self.channels as u64;
        n
    }

    /// Buffered output samples awaiting pop.
    pub fn buffered_samples(&self) -> usize {
        self.fifo.len()
    }

    /// Flush EOF exactly once, releasing the delayed final signal even when
    /// input ended on a block boundary. Leading delay and padded surplus are
    /// excluded: total output is ceil(input_frames * output_rate/input_rate).
    pub fn flush(&mut self) -> crate::Result<()> {
        if self.flushed {
            return Ok(());
        }
        let target = (self.accepted_frames as u128 * self.to_rate as u128)
            .div_ceil(self.from_rate as u128) as u64;
        while self.emitted_frames + ((self.fifo.len() / self.channels) as u64) < target {
            let need = self.inner.input_frames_next();
            self.staging.resize(need * self.channels, 0.0);
            self.drain_blocks()?;
        }
        self.fifo
            .truncate((target - self.emitted_frames) as usize * self.channels);
        self.staging.clear();
        self.flushed = true;
        Ok(())
    }

    /// Reset after a seek (discards staging/FIFO/filter state).
    pub fn reset(&mut self) {
        self.inner.reset();
        self.staging.clear();
        self.fifo.clear();
        self.accepted_frames = 0;
        self.emitted_frames = 0;
        self.delay_left = self.inner.output_delay();
        self.flushed = false;
    }

    /// Owned PCM storage, including unused capacity and processing scratch.
    pub fn retained_bytes(&self) -> usize {
        (self.staging.capacity()
            + self.fifo.capacity()
            + self.inner.output_frames_max() * self.channels)
            * size_of::<f32>()
    }

    pub fn retained_frames(&self) -> usize {
        (self.staging.len() + self.fifo.len()) / self.channels + self.inner.output_frames_max()
    }

    fn drain_blocks(&mut self) -> crate::Result<()> {
        use rubato::audioadapter::Adapter;
        use rubato::audioadapter_buffers::direct::InterleavedSlice;
        let need = self.inner.input_frames_next();
        while self.staging.len() / self.channels >= need && need > 0 {
            let valid_out = self.inner.output_frames_next();
            let input =
                InterleavedSlice::new(&self.staging[..need * self.channels], self.channels, need)
                    .map_err(|e| crate::LibzciError::DecoderFailure {
                    detail: format!("rubato input adapter: {e:?}"),
                })?;
            self.inner
                .process_into_buffer(&input, &mut self.output, None)
                .map_err(|e| crate::LibzciError::DecoderFailure {
                    detail: format!("rubato process: {e:?}"),
                })?;
            self.staging.drain(..need * self.channels);
            let skip = self.delay_left.min(valid_out);
            self.delay_left -= skip;
            assert!(self.fifo.len() + (valid_out - skip) * self.channels <= self.fifo.capacity());
            for frame in skip..valid_out {
                for channel in 0..self.channels {
                    self.fifo
                        .push(self.output.read_sample(channel, frame).unwrap());
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_ratio_preserves_tone() {
        let mut conv = RateConverter::new(48_000, 48_000, 1).unwrap();
        let tone: Vec<f32> = (0..4096)
            .map(|i| ((i as f32 / 48_000.0) * 440.0 * 2.0 * std::f32::consts::PI).sin())
            .collect();
        conv.push(&tone).unwrap();
        conv.flush().unwrap();
        let mut out = vec![0.0f32; 8192];
        let n = conv.pop(&mut out);
        assert!(n > 4000, "identity emits ~all frames (got {n} samples)");
        // The converter has already removed its leading delay.
        let body = &out[500..2500];
        let expect = &tone[500..2500];
        let num: f32 = body.iter().zip(expect).map(|(a, b)| a * b).sum();
        let den: f32 = (body.iter().map(|a| a * a).sum::<f32>()
            * expect.iter().map(|b| b * b).sum::<f32>())
        .sqrt();
        assert!(num / den > 0.999, "identity preserves waveform");
    }

    #[test]
    fn downsample_halves_frame_count() {
        let mut conv = RateConverter::new(48_000, 24_000, 2).unwrap();
        let stereo: Vec<f32> = (0..2048)
            .flat_map(|i| {
                let s = ((i as f32 / 48_000.0) * 220.0 * 2.0 * std::f32::consts::PI).sin() * 0.5;
                [s, -s]
            })
            .collect();
        conv.push(&stereo).unwrap();
        conv.flush().unwrap();
        let mut out = vec![0.0f32; 4096];
        let n = conv.pop(&mut out);
        let frames = n / 2;
        // 2048 in → ~1024 out, within block-rounding tolerance.
        assert!(
            (1000..=1050).contains(&frames),
            "downsampled frames {frames}"
        );
        assert!(out[..n].iter().all(|s| s.is_finite()));
    }

    #[test]
    fn rejects_bad_channels() {
        assert!(RateConverter::new(48_000, 48_000, 3).is_err());
    }
}
