//! Shared output processing: pre-Raf ReplayGain and post-Raf master gain/mute.
//!
//! Signal ownership (contracts §5):
//!
//! ```text
//! source -> [transition envelope: Phase 5] -> raw program tap
//!                                          -> ReplayGain -> [Raf: M4]
//!                                          -> analysis -> master gain/mute -> output
//! ```
//!
//! [`AudioProcessor`] owns separate normalization and master stages: stereo
//! linked finite anchored ramps, and the raw-program tap before ReplayGain.
//! No tap consumer
//! is attached here. Parameter updates are differential and smoothed
//! from the last rendered value — never stepped.

/// Separate pre-Raf normalization and master gain/mute, with a raw tap.
#[derive(Debug)]
pub struct AudioProcessor {
    replay_gain: GainRamp,
    /// Last rendered effective gain, including mute. Every retarget anchors here.
    rendered_gain: f32,
    /// Gain target for the next blocks.
    target_gain: f32,
    /// Mute target (ramps to/from silence like a gain move).
    target_mute: bool,
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
            rendered_gain: 1.0,
            replay_gain: GainRamp::new(),
            target_gain: 1.0,
            target_mute: false,
            ramp_frames: 240,
            ramp_left: 0,
            ramp_from: 1.0,
            last_raw_peak: 0.0,
        }
    }

    /// Configure the actual output rate before processing. Both gain envelopes
    /// last five milliseconds at this rate, independent of source/decoder rate.
    pub fn set_sample_rate(&mut self, rate: u32) {
        if rate == 0 {
            return;
        }
        let frames = ((rate as u64 * 5) / 1000).max(1) as usize;
        if self.ramp_frames != frames {
            self.ramp_frames = frames;
            self.replay_gain.frames = frames;
            if self.ramp_left > 0 {
                self.ramp_from = self.rendered_gain;
                self.ramp_left = frames;
            }
            self.replay_gain.reanchor();
        }
    }
    /// Effective linear normalization, resolved by shared control policy.
    /// Invalid targets are ignored. This stage precedes Raf and master gain.
    pub fn set_replay_gain(&mut self, gain: f32) {
        if gain.is_finite() && (0.0..=1000.0).contains(&gain) {
            self.replay_gain.target(gain);
        }
    }
    /// Prime a new source before its first audible frame. Reusing the previous
    /// source's normalization would produce an unintended startup boost/cut.
    pub fn reset_replay_gain(&mut self, gain: f32) {
        self.set_replay_gain(gain);
        self.replay_gain.rendered = self.replay_gain.target;
        self.replay_gain.left = 0;
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
            let previous = self.target_effective();
            self.target_gain = clamped;
            self.retarget(previous);
        }
    }

    /// Set mute. Unmuting from silence ramps like a gain move.
    pub fn set_mute(&mut self, mute: bool) {
        if mute != self.target_mute {
            let previous = self.target_effective();
            self.target_mute = mute;
            self.retarget(previous);
        }
    }

    /// Fixed master values for an offline render, without a startup ramp.
    pub fn reset_master(&mut self, volume: f32, mute: bool) {
        self.set_volume(volume);
        self.set_mute(mute);
        self.rendered_gain = self.target_effective();
        self.ramp_left = 0;
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

    fn retarget(&mut self, previous: f32) {
        if (previous - self.target_effective()).abs() > f32::EPSILON {
            self.ramp_from = self.rendered_gain;
            self.ramp_left = self.ramp_frames;
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
        debug_assert!(input.len().is_multiple_of(2));
        let mut peak = 0.0f32;
        for (source, destination) in input
            .as_chunks::<2>()
            .0
            .iter()
            .zip(output.as_chunks_mut::<2>().0)
        {
            peak = peak.max(source[0].abs()).max(source[1].abs());
            let mut gain = self.target_effective();
            if self.ramp_left > 0 {
                let done = (self.ramp_frames - self.ramp_left + 1) as f32 / self.ramp_frames as f32;
                gain = self.ramp_from + (self.target_effective() - self.ramp_from) * done;
                self.ramp_left -= 1;
                if self.ramp_left == 0 {
                    gain = self.target_effective();
                }
            }
            self.rendered_gain = gain;
            let normalization = self.replay_gain.next();
            // Finite providers can exceed unity. Preserve headroom rather than
            // clipping to full scale; saturate only floating-point overflow.
            destination[0] = (source[0] * normalization).clamp(f32::MIN, f32::MAX) * gain;
            destination[1] = (source[1] * normalization).clamp(f32::MIN, f32::MAX) * gain;
        }
        self.last_raw_peak = peak;
    }

    /// Same shared master stage over callback-owned storage, without scratch
    /// allocation. Each stereo frame advances one shared gain envelope.
    pub fn process_stereo_in_place(&mut self, samples: &mut [f32]) {
        let mut peak = 0.0f32;
        for frame in samples.as_chunks_mut::<2>().0 {
            let input = [frame[0], frame[1]];
            peak = peak.max(input[0].abs()).max(input[1].abs());
            self.process_stereo(&input, frame);
        }
        self.last_raw_peak = peak;
    }

    /// Apply a prepared gain schedule at exact source-frame boundaries inside
    /// this output block. Split processing only where a gain changes, retaining
    /// finite anchored ramps across pieces and avoiding per-sample searches.
    /// `points` is validated before publication; `prime` marks a new source.
    pub fn process_source_block(
        &mut self,
        samples: &mut [f32],
        block: crate::OutputBlock,
        points: &[crate::GainPoint],
        prime: bool,
    ) {
        debug_assert_eq!(samples.len(), block.valid_frames * 2);
        if samples.is_empty() {
            return;
        }
        self.set_sample_rate(block.layout.sample_rate);
        let mut index = points.partition_point(|p| p.source_frame <= block.source_position(0));
        let mut gain = if index == 0 {
            1.0
        } else {
            points[index - 1].linear
        };
        if prime {
            self.reset_replay_gain(gain);
        }
        let mut at = 0;
        let mut peak = 0.0_f32;
        while at < block.valid_frames {
            while points
                .get(index)
                .is_some_and(|p| p.source_frame <= block.source_position(at))
            {
                gain = points[index].linear;
                index += 1;
            }
            let mut end = block.valid_frames;
            if let Some(next) = points.get(index) {
                if next.source_frame <= block.source_position(end - 1) {
                    let mut lo = at;
                    let mut hi = end;
                    while lo < hi {
                        let mid = lo + (hi - lo) / 2;
                        if block.source_position(mid) < next.source_frame {
                            lo = mid + 1;
                        } else {
                            hi = mid;
                        }
                    }
                    end = lo;
                }
            }
            self.set_replay_gain(gain);
            self.process_stereo_in_place(&mut samples[at * 2..end * 2]);
            peak = peak.max(self.last_raw_peak);
            at = end;
        }
        self.last_raw_peak = peak;
    }

    /// Fixed master setting for an offline render (no startup ramp).
    pub fn apply_gain(samples: &mut [f32], gain: f32) {
        debug_assert!(gain.is_finite());
        for sample in samples {
            *sample = (*sample * gain).clamp(f32::MIN, f32::MAX);
        }
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

#[derive(Debug)]
struct GainRamp {
    rendered: f32,
    target: f32,
    from: f32,
    frames: usize,
    left: usize,
}
impl GainRamp {
    fn new() -> Self {
        Self {
            rendered: 1.0,
            target: 1.0,
            from: 1.0,
            frames: 240,
            left: 0,
        }
    }
    fn reanchor(&mut self) {
        if self.left > 0 {
            self.from = self.rendered;
            self.left = self.frames;
        }
    }
    fn target(&mut self, target: f32) {
        if target != self.target {
            self.target = target;
            self.from = self.rendered;
            self.left = self.frames;
        }
    }
    fn next(&mut self) -> f32 {
        if self.left > 0 {
            let done = (self.frames - self.left + 1) as f32 / self.frames as f32;
            self.rendered = self.from + (self.target - self.from) * done;
            self.left -= 1;
        }
        if self.left == 0 {
            self.rendered = self.target;
        }
        self.rendered
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
    fn source_gain_boundaries_follow_rational_frames_and_not_processing_chunk_size() {
        use crate::{GainPoint, GainSchedule, Generation, OutputBlock, PcmLayout};
        let points = [
            GainPoint {
                source_frame: 0,
                linear: 0.25,
            },
            GainPoint {
                source_frame: 147,
                linear: 0.5,
            },
            GainPoint {
                source_frame: 294,
                linear: 2.0,
            },
        ];
        GainSchedule::validate(&points).unwrap();
        let block = OutputBlock {
            generation: Generation(1),
            source_start: 0,
            source_end: 441,
            source_rate: 44100,
            output_start: 0,
            layout: PcmLayout::stereo48k(),
            valid_frames: 480,
        };
        let mut whole = AudioProcessor::new();
        let mut out = [1.0; 960];
        whole.process_source_block(&mut out, block, &points, true);
        assert_eq!(&out[..320], &[0.25; 320]);
        assert!((out[320] - (0.25 + 0.25 / 240.0)).abs() < 1e-7);
        assert!(out.as_chunks::<2>().0.iter().all(|v| v[0] == v[1]));
        assert_eq!(whole.last_raw_peak(), 1.0);
        let mut split = AudioProcessor::new();
        let mut fragmented = [1.0; 960];
        let mut at = 0;
        for size in [13, 147, 7, 159, 1, 153] {
            split.process_source_block(
                &mut fragmented[at * 2..(at + size) * 2],
                block.slice(at, size),
                &points,
                at == 0,
            );
            at += size;
        }
        assert_eq!(at, 480);
        assert_eq!(out, fragmented);
        let mut seek = AudioProcessor::new();
        let mut after_seek = [1.0; 64];
        seek.process_source_block(&mut after_seek, block.slice(400, 32), &points, true);
        assert_eq!(after_seek, [2.0; 64]);
    }

    #[test]
    fn independent_normalization_keeps_raw_peak_headroom_and_actual_rate_ramps() {
        for rate in [44100, 48000, 96000] {
            let mut p = AudioProcessor::new();
            p.set_sample_rate(rate);
            p.set_replay_gain(0.5);
            let frames = (rate as usize * 5) / 1000;
            let mut output = vec![0.0; frames * 2];
            p.process_stereo(&vec![2.0; frames * 2], &mut output);
            assert!(output[0] > 1.9);
            assert_eq!(output[output.len() - 1], 1.0);
            assert_eq!(p.last_raw_peak(), 2.0);
            assert!(output.as_chunks::<2>().0.iter().all(|v| v[0] == v[1]));
            p.set_replay_gain(2.0);
            let mut first = [0.0; 2];
            p.process_stereo(&[2.0; 2], &mut first);
            assert!((first[0] - 1.0).abs() < 0.02);
            p.reset_replay_gain(0.25);
            p.process_stereo(&[2.0; 2], &mut first);
            assert_eq!(first, [0.5; 2]);
            p.reset_replay_gain(1000.0);
            p.process_stereo(&[f32::MAX; 2], &mut first);
            assert!(first.into_iter().all(f32::is_finite));
            p.set_replay_gain(f32::NAN);
            p.set_replay_gain(f32::INFINITY);
            p.set_replay_gain(-1.0);
            p.process_stereo(&[1.0; 2], &mut first);
            assert_eq!(first, [1000.0; 2]);
        }
    }

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

    #[test]
    fn in_place_renderer_preserves_shared_gain_and_mute_ramps() {
        let mut reference = AudioProcessor::new();
        let mut renderer = AudioProcessor::new();
        let input: Vec<f32> = (0..1024).map(|n| (n % 17) as f32 / 16.0 - 0.5).collect();
        for (volume, mute) in [(0.4, false), (0.4, true), (0.8, false)] {
            reference.set_volume(volume);
            renderer.set_volume(volume);
            reference.set_mute(mute);
            renderer.set_mute(mute);
            let mut expected = vec![0.0; input.len()];
            reference.process_stereo(&input, &mut expected);
            let mut output = input.clone();
            renderer.process_stereo_in_place(&mut output);
            assert_eq!(output, expected);
            assert_eq!(renderer.last_raw_peak(), reference.last_raw_peak());
        }
    }
    #[test]
    fn envelope_is_stereo_linked_and_measured_in_frames() {
        let mut processor = AudioProcessor::new();
        processor.set_volume(0.);
        let mut output = vec![0.; 480];
        processor.process_stereo(&vec![1.; 480], &mut output);
        for frame in output.as_chunks::<2>().0 {
            assert_eq!(
                frame[0], frame[1],
                "master ramp must preserve stereo balance"
            );
        }
        assert!(output[476] > 0.);
        assert_eq!(
            &output[478..],
            &[0., 0.],
            "5 ms at 48 kHz is 240 stereo frames"
        );
    }
    #[test]
    fn interrupted_volume_and_mute_ramps_anchor_to_the_last_rendered_frame() {
        let mut processor = AudioProcessor::new();
        processor.set_volume(0.);
        let mut initial = [0.; 120];
        processor.process_stereo(&[1.; 120], &mut initial);
        let mut last = initial[118];
        assert!((last - 0.75).abs() < 1e-6);
        for (volume, mute) in [
            (0.5, false),
            (0.5, true),
            (0.9, true),
            (0.9, false),
            (f32::NAN, false),
        ] {
            processor.set_volume(volume);
            processor.set_mute(mute);
            let mut output = [0.; 40];
            processor.process_stereo(&[1.; 40], &mut output);
            assert!(
                (output[0] - last).abs() < 0.005,
                "retarget must not step back to a previous envelope origin"
            );
            for frame in output.as_chunks::<2>().0 {
                assert_eq!(frame[0], frame[1]);
                assert!(frame[0].is_finite() && (0.0..=1.).contains(&frame[0]));
            }
            last = output[38];
        }
    }
}
