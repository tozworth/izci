//! Device-rate conversion over the pinned maintained resampler.
//!
//! [`RateConverter`] wraps `rubato` FFT sinc resampling (pinned in
//! `Cargo.lock`) behind the engine's staging discipline: arbitrary
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
}

impl RateConverter {
    /// Create for `from_rate` → `to_rate` with `channels` (1–2).
    /// A 1:1 ratio still normalizes through the same path (cheap) so
    /// behavior is uniform; callers may bypass when rates match.
    pub fn new(from_rate: u32, to_rate: u32, channels: usize) -> crate::Result<Self> {
        if channels == 0 || channels > 2 {
            return Err(crate::LibzciError::InvalidArgument {
                detail: format!("resampler channels {channels}"),
            });
        }
        if from_rate < 8000 || from_rate > 192000 || to_rate < 8000 || to_rate > 192000 {
            return Err(crate::LibzciError::InvalidArgument {
                detail: format!("resampler rates {from_rate}->{to_rate}"),
            });
        }
        let chunk = 1024usize;
        let inner = Fft::<f32>::new(from_rate as usize, to_rate as usize, chunk, channels, FixedSync::Input)
            .map_err(|e| crate::LibzciError::InvalidArgument {
                detail: format!("rubato construction: {e:?}"),
            })?;
        Ok(Self {
            inner,
            channels,
            from_rate,
            to_rate,
            staging: Vec::new(),
            fifo: Vec::new(),
            accepted_frames: 0,
            emitted_frames: 0,
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

    /// Feed interleaved input frames (any length).
    pub fn push(&mut self, samples: &[f32]) -> crate::Result<()> {
        if samples.len() % self.channels != 0 {
            return Err(crate::LibzciError::InvalidArgument {
                detail: "resampler input not a multiple of channel count".into(),
            });
        }
        self.staging.extend_from_slice(samples);
        self.accepted_frames += samples.len() as u64 / self.channels as u64;
        self.drain_blocks()
    }

    /// Pop up to `out.len()` interleaved output samples.
    /// Returns samples written.
    pub fn pop(&mut self, out: &mut [f32]) -> usize {
        let n = out.len().min(self.fifo.len());
        out[..n].copy_from_slice(&self.fifo[..n]);
        self.fifo.drain(..n);
        self.emitted_frames += n as u64 / self.channels as u64;
        n
    }

    /// Buffered output samples awaiting pop.
    pub fn buffered_samples(&self) -> usize {
        self.fifo.len()
    }

    /// Flush at EOF: pad a staged tail to one full block and process
    /// it once. The FFT sinc delay appears as a leading transient
    /// (see `output_delay_frames`), not a trailing tail, so no extra
    /// zero blocks are needed. Empty staging processes nothing.
    pub fn flush(&mut self) -> crate::Result<()> {
        let need = self.inner.input_frames_next();
        let staged_frames = self.staging.len() / self.channels;
        if staged_frames == 0 {
            return Ok(());
        }
        let pad_frames = need.saturating_sub(staged_frames);
        self.staging.extend(std::iter::repeat(0.0).take(pad_frames * self.channels));
        self.drain_blocks()
    }

    /// Reset after a seek (discards staging/FIFO/filter state).
    pub fn reset(&mut self) {
        self.inner.reset();
        self.staging.clear();
        self.fifo.clear();
    }

    fn drain_blocks(&mut self) -> crate::Result<()> {
        use rubato::audioadapter_buffers::direct::InterleavedSlice;
        use rubato::audioadapter_buffers::owned::InterleavedOwned;
        let need = self.inner.input_frames_next();
        while self.staging.len() / self.channels >= need && need > 0 {
            let valid_out = self.inner.output_frames_next();
            let input = InterleavedSlice::new(&self.staging[..need * self.channels], self.channels, need)
                .map_err(|e| crate::LibzciError::DecoderFailure {
                    detail: format!("rubato input adapter: {e:?}"),
                })?;
            let mut output = InterleavedOwned::new(0.0f32, self.channels, self.inner.output_frames_max());
            self.inner
                .process_into_buffer(&input, &mut output, None)
                .map_err(|e| crate::LibzciError::DecoderFailure {
                    detail: format!("rubato process: {e:?}"),
                })?;
            self.staging.drain(..need * self.channels);
            let mut data = output.take_data();
            data.truncate(valid_out * self.channels);
            self.fifo.extend_from_slice(&data);
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
        let tone: Vec<f32> = (0..4096).map(|i| ((i as f32 / 48_000.0) * 440.0 * 2.0 * std::f32::consts::PI).sin()).collect();
        conv.push(&tone).unwrap();
        conv.flush().unwrap();
        let mut out = vec![0.0f32; 8192];
        let n = conv.pop(&mut out);
        assert!(n > 4000, "identity emits ~all frames (got {n} samples)");
        // Compensate the resampler's leading delay before comparing.
        let delay = conv.output_delay_frames();
        let body = &out[delay + 500..delay + 2500];
        let expect = &tone[500..2500];
        let num: f32 = body.iter().zip(expect).map(|(a, b)| a * b).sum();
        let den: f32 = (body.iter().map(|a| a * a).sum::<f32>() * expect.iter().map(|b| b * b).sum::<f32>()).sqrt();
        assert!(num / den > 0.999, "identity preserves waveform");
    }

    #[test]
    fn downsample_halves_frame_count() {
        let mut conv = RateConverter::new(48_000, 24_000, 2).unwrap();
        let stereo: Vec<f32> = (0..2048).flat_map(|i| {
            let s = ((i as f32 / 48_000.0) * 220.0 * 2.0 * std::f32::consts::PI).sin() * 0.5;
            [s, -s]
        }).collect();
        conv.push(&stereo).unwrap();
        conv.flush().unwrap();
        let mut out = vec![0.0f32; 4096];
        let n = conv.pop(&mut out);
        let frames = n / 2;
        // 2048 in → ~1024 out, within block-rounding tolerance.
        assert!((1000..=1050).contains(&frames), "downsampled frames {frames}");
        assert!(out[..n].iter().all(|s| s.is_finite()));
    }

    #[test]
    fn rejects_bad_channels() {
        assert!(RateConverter::new(48_000, 48_000, 3).is_err());
    }
}
