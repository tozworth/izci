//! Bounded, device-independent PCM preparation. A short sink write never loses
//! its suffix. Callers request another decode only when `needs_input()` is true.

use crate::{
    AudioProcessor, ChannelLayout, Generation, LibzciError, PcmLayout, RateConverter, Result,
};

/// Descriptor shared by native blocks and future browser pool messages.
/// Source ranges use source-rate frames; output ranges use device-rate frames.
/// Resampled ranges are rational timeline mappings, not decoder read-ahead.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OutputBlock {
    pub generation: Generation,
    pub source_start: u64,
    pub source_end: u64,
    pub source_rate: u32,
    pub output_start: u64,
    pub layout: PcmLayout,
    pub valid_frames: usize,
}

impl OutputBlock {
    /// Describe a frame-aligned suffix/prefix without losing its timeline origin.
    pub fn slice(self, offset: usize, frames: usize) -> Self {
        assert!(offset + frames <= self.valid_frames);
        let source_at = |n: u64| {
            ((n as u128 * self.source_rate as u128) / self.layout.sample_rate as u128) as u64
        };
        let base = source_at(self.output_start);
        Self {
            source_start: (self.source_start + source_at(self.output_start + offset as u64) - base)
                .min(self.source_end),
            source_end: (self.source_start
                + source_at(self.output_start + offset as u64 + frames as u64)
                - base)
                .min(self.source_end),
            output_start: self.output_start + offset as u64,
            valid_frames: frames,
            ..self
        }
    }
}

/// One decoded block plus bounded conversion staging/FIFO and one pending block.
/// Constructor allocations are independent of track length. This type owns no
/// decoder and no output queue, so those budgets remain explicit in the adapter.
pub struct OutputPreparation {
    input: PcmLayout,
    output: PcmLayout,
    generation: Generation,
    max_input_frames: usize,
    stereo: Vec<f32>,
    pending: Vec<f32>,
    pending_len: usize,
    offset: usize,
    converter: Option<RateConverter>,
    source_origin: Option<u64>,
    source_end: u64,
    output_frames: u64,
    eof: bool,
}

impl OutputPreparation {
    pub fn new(
        input: PcmLayout,
        output_rate: u32,
        max_input_frames: usize,
        generation: Generation,
    ) -> Result<Self> {
        PcmLayout::new(input.layout, input.sample_rate)?;
        let output = PcmLayout::new(ChannelLayout::Stereo, output_rate)?;
        if max_input_frames == 0 || max_input_frames > RateConverter::MAX_INPUT_FRAMES {
            return Err(LibzciError::InvalidArgument {
                detail: "output input budget out of range".into(),
            });
        }
        let converter = if input.sample_rate == output_rate {
            None
        } else {
            Some(RateConverter::new(input.sample_rate, output_rate, 2)?)
        };
        Ok(Self {
            input,
            output,
            generation,
            max_input_frames,
            stereo: vec![0.0; max_input_frames * 2],
            pending: vec![0.0; max_input_frames * 2],
            pending_len: 0,
            offset: 0,
            converter,
            source_origin: None,
            source_end: 0,
            output_frames: 0,
            eof: false,
        })
    }

    pub fn needs_input(&self) -> bool {
        !self.eof
            && self.offset == self.pending_len
            && self
                .converter
                .as_ref()
                .is_none_or(|c| c.buffered_samples() == 0)
    }

    /// Reject oversized/nonfinite/noncontiguous blocks before changing state.
    pub fn accept(&mut self, source_start: u64, samples: &[f32]) -> Result<()> {
        let channels = self.input.layout.channels() as usize;
        let frames = samples.len() / channels;
        if !self.needs_input()
            || frames == 0
            || frames > self.max_input_frames
            || !samples.len().is_multiple_of(channels)
            || samples.iter().any(|s| !s.is_finite())
            || self.source_origin.is_some() && source_start != self.source_end
        {
            return Err(LibzciError::InvalidArgument {
                detail: "invalid or uncredited output input".into(),
            });
        }
        self.source_origin.get_or_insert(source_start);
        self.source_end = source_start + frames as u64;
        match self.input.layout {
            ChannelLayout::Mono => {
                AudioProcessor::upmix_mono(samples, &mut self.stereo[..frames * 2])
            }
            ChannelLayout::Stereo => self.stereo[..frames * 2].copy_from_slice(samples),
        }
        if let Some(converter) = &mut self.converter {
            converter.push(&self.stereo[..frames * 2])?;
        } else {
            self.pending[..frames * 2].copy_from_slice(&self.stereo[..frames * 2]);
            self.pending_len = frames * 2;
            self.offset = 0;
        }
        Ok(())
    }

    /// Source EOF is accepted after the last decoded block has been submitted.
    /// Conversion drains once, retaining its entire tail under sink backpressure.
    pub fn finish(&mut self) -> Result<()> {
        if !self.eof {
            if let Some(converter) = &mut self.converter {
                converter.flush()?;
            }
            self.eof = true;
        }
        Ok(())
    }

    /// Offer one bounded pending span. Sink returns accepted *frames*, including
    /// zero. The unaccepted suffix stays here until a later call.
    pub fn pump(&mut self, mut sink: impl FnMut(OutputBlock, &[f32]) -> usize) -> usize {
        if self.offset == self.pending_len {
            self.offset = 0;
            self.pending_len = self
                .converter
                .as_mut()
                .map_or(0, |c| c.pop(&mut self.pending));
        }
        let frames = (self.pending_len - self.offset) / 2;
        if frames == 0 {
            return 0;
        }
        let origin = self.source_origin.unwrap_or(0);
        let source_at = |n: u64| {
            origin
                + ((n as u128 * self.input.sample_rate as u128) / self.output.sample_rate as u128)
                    as u64
        };
        let block = OutputBlock {
            generation: self.generation,
            source_start: source_at(self.output_frames).min(self.source_end),
            source_end: source_at(self.output_frames + frames as u64).min(self.source_end),
            source_rate: self.input.sample_rate,
            output_start: self.output_frames,
            layout: self.output,
            valid_frames: frames,
        };
        let accepted = sink(block, &self.pending[self.offset..self.pending_len]);
        assert!(accepted <= frames, "sink exceeded offered frame count");
        self.offset += accepted * 2;
        self.output_frames += accepted as u64;
        accepted
    }

    /// Prepared EOF, distinct from the sink's final consumption acknowledgment.
    pub fn is_drained(&self) -> bool {
        self.eof
            && self.offset == self.pending_len
            && self
                .converter
                .as_ref()
                .is_none_or(|c| c.buffered_samples() == 0)
    }

    /// Retained sample-storage bytes (including empty reserved staging/tails).
    /// Excludes rubato's private fixed FFT plans/workspace. Allocator tests measure
    /// the complete pipeline heap separately, including those private buffers.
    pub fn retained_bytes(&self) -> usize {
        (self.stereo.capacity() + self.pending.capacity()) * size_of::<f32>()
            + self.converter.as_ref().map_or(0, |c| c.retained_bytes())
    }

    /// Occupied PCM frame slots plus fixed stereo scratch. This is a storage
    /// count across input/output rates, not a duration on either timeline.
    pub fn retained_frames(&self) -> usize {
        self.max_input_frames
            + (self.pending_len - self.offset) / 2
            + self.converter.as_ref().map_or(0, |c| c.retained_frames())
    }
}
