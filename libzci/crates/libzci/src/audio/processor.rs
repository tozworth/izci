//! Shared output processing: channel mapping plus master gain/mute.
//!
//! Signal ownership (contracts §5), current slice in Phase 2.1:
//!
//! ```text
//! source -> [transition envelope: Phase 5] -> raw program tap
//!                                          -> [ReplayGain: later] -> [Raf: Phase 5]
//!                                          -> analysis -> master gain/mute -> output
//! ```
//!
//! [`AudioProcessor`] owns the master stage today: mono-to-stereo
//! mapping, finite anchored gain/mute ramps, and the raw-program tap
//! point before any future ReplayGain/Raf processing. No tap consumer
//! is attached here. Parameter updates are differential and smoothed
//! from the last rendered value — never stepped.

/// Master gain/mute stage with ramp smoothing and a raw tap.
#[derive(Debug)]
pub struct AudioProcessor {
    /// Currently rendered gain (linear, finite, anchored).
    current_gain: f32,
    /// Gain target for the next blocks.
    target_gain: f32,
    /// Mute target (ramps to/from silence like a gain move).
    target_mute: bool,
    /// Currently rendered mute.
    current_mute: bool,
    /// Ramp length in frames for gain/mute moves.
    ramp_frames: usize,
    /// Frames remaining in the active ramp.
    ramp_left: usize,
    /// Gain at ramp start (anchor).
    ramp_from: f32,
    /// Last rendered block's raw (pre-master) peak for diagnostics.
    last_raw_peak: f32,
}

impl AudioProcessor {
    /// Create at unity gain, unmuted, with a 5 ms ramp at 48 kHz.
    pub fn new() -> Self {
        Self {
            current_gain: 1.0,
            target_gain: 1.0,
            target_mute: false,
            current_mute: false,
            ramp_frames: 240,
            ramp_left: 0,
            ramp_from: 1.0,
            last_raw_peak: 0.0,
        }
    }

    /// Set the master volume (linear 0..=1, clamped, finite).
    /// Out-of-range or non-finite input is clamped, never stored raw.
    pub fn set_volume(&mut self, volume: f32) {
        let clamped = if volume.is_finite() {
            volume.clamp(0.0, 1.0)
        } else {
            self.target_gain
        };
        if (clamped - self.target_gain).abs() > f32::EPSILON {
            self.target_gain = clamped;
            self.ramp_from = self.effective_gain();
            self.ramp_left = self.ramp_frames;
        }
    }

    /// Set mute. Unmuting from silence ramps like a gain move.
    pub fn set_mute(&mut self, mute: bool) {
        if mute != self.target_mute {
            self.target_mute = mute;
            self.ramp_from = self.effective_gain();
            self.ramp_left = self.ramp_frames;
        }
    }

    /// Current volume target (0..=1).
    pub fn volume(&self) -> f32 {
        self.target_gain
    }

    /// Current mute target.
    pub fn muted(&self) -> bool {
        self.target_mute
    }

    /// Last rendered raw peak (pre-master tap observation).
    pub fn last_raw_peak(&self) -> f32 {
        self.last_raw_peak
    }

    fn effective_gain(&self) -> f32 {
        if self.current_mute {
            0.0
        } else {
            self.current_gain
        }
    }

    fn target_effective(&self) -> f32 {
        if self.target_mute {
            0.0
        } else {
            self.target_gain
        }
    }

    /// Process interleaved stereo `input` into `output` (same length).
    /// Maps mono sources to stereo first (explicit upmix), observes
    /// the raw tap peak, then applies the smoothed master gain/mute.
    pub fn process_stereo(&mut self, input: &[f32], output: &mut [f32]) {
        debug_assert_eq!(input.len(), output.len());
        debug_assert!(input.len() % 2 == 0);
        let mut peak = 0.0f32;
        for (index, sample) in input.iter().enumerate() {
            peak = peak.max(sample.abs());
            let mut gain = self.target_effective();
            if self.ramp_left > 0 {
                let done = (self.ramp_frames - self.ramp_left) as f32 / self.ramp_frames as f32;
                gain = self.ramp_from + (self.target_effective() - self.ramp_from) * done;
                self.ramp_left -= 1;
                if self.ramp_left == 0 {
                    self.current_gain = self.target_gain;
                    self.current_mute = self.target_mute;
                    gain = self.target_effective();
                }
            }
            output[index] = sample * gain;
        }
        self.last_raw_peak = peak;
    }

    /// Same shared master stage over callback-owned storage, without scratch
    /// allocation. Preserve the existing gain/mute ramp semantics.
    pub fn process_stereo_in_place(&mut self, samples: &mut [f32]) {
        let mut peak = 0.0f32;
        for frame in samples.chunks_exact_mut(2) {
            let input = [frame[0], frame[1]];
            peak = peak.max(input[0].abs()).max(input[1].abs());
            self.process_stereo(&input, frame);
        }
        self.last_raw_peak = peak;
    }

    /// Explicit mono-to-stereo upmix (`out` gets `L,R = m,m`).
    pub fn upmix_mono(input: &[f32], out: &mut [f32]) {
        debug_assert_eq!(out.len(), input.len() * 2);
        for (i, sample) in input.iter().enumerate() {
            out[i * 2] = *sample;
            out[i * 2 + 1] = *sample;
        }
    }
}

impl Default for AudioProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unity_passthrough_and_peak_tap() {
        let mut proc = AudioProcessor::new();
        let input = vec![0.5f32, -0.25, 0.0, 1.0];
        let mut output = vec![0.0f32; 4];
        proc.process_stereo(&input, &mut output);
        assert_eq!(output, input);
        assert_eq!(proc.last_raw_peak(), 1.0);
    }

    #[test]
    fn mute_ramps_without_steps() {
        let mut proc = AudioProcessor::new();
        proc.set_mute(true);
        let input = vec![1.0f32; 2048];
        let mut output = vec![0.0f32; 2048];
        proc.process_stereo(&input, &mut output);
        // Monotonic decay to silence, ending silent.
        for pair in output.windows(2) {
            assert!(pair[1].abs() <= pair[0].abs() + 1e-6);
        }
        assert!(output[output.len() - 2..].iter().all(|&s| s == 0.0));
        assert!(proc.muted());
    }

    #[test]
    fn volume_moves_are_smoothed() {
        let mut proc = AudioProcessor::new();
        proc.set_volume(0.0);
        let input = vec![1.0f32; 2048];
        let mut output = vec![0.0f32; 2048];
        proc.process_stereo(&input, &mut output);
        assert!(output[0] > 0.9, "starts near unity");
        assert_eq!(output[output.len() - 1], 0.0);
        // No full-scale step anywhere.
        for pair in output.windows(2) {
            assert!((pair[0] - pair[1]).abs() < 0.05);
        }
    }

    #[test]
    fn upmix_duplicates_mono() {
        let mut out = vec![0.0f32; 6];
        AudioProcessor::upmix_mono(&[0.5, -0.5, 0.25], &mut out);
        assert_eq!(out, vec![0.5, 0.5, -0.5, -0.5, 0.25, 0.25]);
    }
}
