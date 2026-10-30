//! Audible output clock: media position from consumed frames.
//!
//! The core computes media position from the output's consumed-frame
//! count plus the loaded timeline — never from wall-clock or UI
//! timers, which must not claim progress while output is suspended.
//! Requested play state and actually-running output are distinct
//! observations; diagnostics expose both.

/// Requested transport state (what the session asked for).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RequestedState {
    /// Output held (paused/ready/stopped).
    Held,
    /// Output requested (playing).
    Running,
}

/// Actually-running output state (what the device reports).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RunningState {
    /// No stream (never opened, released, or failed).
    Closed,
    /// Stream open, consuming frames.
    Running,
    /// Stream open but suspended (device sleep, interruption).
    Suspended,
    /// Stream failed (see the typed error at the owner).
    Failed,
}

/// A fixed-budget mapping from device submissions to source-media ranges.
/// Underrun silence advances only the device cursor. A hold freezes both cursors.
#[derive(Clone, Copy, Debug)]
struct Span {
    block: crate::OutputBlock,
    device_start: u64,
    consumed: usize,
}
pub struct MediaClock {
    spans: Box<[Option<Span>]>,
    head: usize,
    len: usize,
    cursor: u64,
    position: Option<u64>,
    consumed_frames: u64,
}
impl Default for MediaClock {
    fn default() -> Self {
        Self {
            spans: vec![None; 2048].into_boxed_slice(),
            head: 0,
            len: 0,
            cursor: 0,
            position: None,
            consumed_frames: 0,
        }
    }
}
impl MediaClock {
    pub fn reset(&mut self) {
        self.head = 0;
        self.len = 0;
        self.cursor = 0;
        self.position = None;
        self.consumed_frames = 0;
    }
    pub fn submit(&mut self, block: crate::OutputBlock, callback_offset: u64) -> bool {
        if self.len == self.spans.len() {
            return false;
        }
        let tail = (self.head + self.len) % self.spans.len();
        self.spans[tail] = Some(Span {
            block,
            device_start: self.cursor + callback_offset,
            consumed: 0,
        });
        self.len += 1;
        true
    }
    pub fn advance(&mut self, frames: u64, latency: u64) -> Option<u64> {
        self.cursor += frames;
        if self.cursor < latency {
            return self.position;
        }
        let audible = self.cursor - latency;
        while self.len > 0 {
            let span = self.spans[self.head].unwrap();
            if audible < span.device_start {
                break;
            }
            let count = ((audible - span.device_start).min(span.block.valid_frames as u64)
                as usize)
                .max(span.consumed);
            self.consumed_frames += count.saturating_sub(span.consumed) as u64;
            self.position = Some(span.block.slice(0, count).source_end);
            if count < span.block.valid_frames {
                self.spans[self.head] = Some(Span {
                    consumed: count,
                    ..span
                });
                break;
            }
            self.spans[self.head] = None;
            self.head = (self.head + 1) % self.spans.len();
            self.len -= 1;
        }
        self.position
    }
    pub fn drained(&self) -> bool {
        self.len == 0
    }
    /// Actual media frames that crossed the output latency boundary. Device
    /// underrun silence and decoder read-ahead contribute nothing.
    pub fn consumed_frames(&self) -> u64 {
        self.consumed_frames
    }
}
#[cfg(test)]
mod media_clock_tests {
    use super::*;
    use crate::{Generation, OutputBlock, PcmLayout};
    fn block(generation: Generation, source: u64) -> OutputBlock {
        OutputBlock {
            generation,
            source_start: source,
            source_end: source + 10,
            source_rate: 48_000,
            output_start: 0,
            layout: PcmLayout::stereo48k(),
            valid_frames: 10,
        }
    }
    #[test]
    fn underrun_latency_and_seek_origin_are_separate() {
        let mut clock = MediaClock::default();
        assert_eq!(clock.advance(100, 10), None);
        assert_eq!(clock.consumed_frames(), 0);
        assert!(clock.submit(block(Generation(1), 500), 0));
        assert_eq!(clock.advance(5, 10), None);
        assert_eq!(clock.advance(10, 10), Some(505));
        assert_eq!(clock.consumed_frames(), 5);
        assert!(!clock.drained());
        assert_eq!(clock.advance(5, 10), Some(510));
        assert_eq!(clock.consumed_frames(), 10);
        assert!(clock.drained());
        assert_eq!(clock.advance(100_000, 10), Some(510));
        assert_eq!(clock.consumed_frames(), 10);
        clock.reset();
        clock.submit(block(Generation(2), 2000), 0);
        assert_eq!(clock.advance(10, 0), Some(2010));
        assert_eq!(clock.consumed_frames(), 10);
    }
    #[test]
    fn media_duration_uses_output_frames_not_source_position_or_underrun_time() {
        let mut clock = MediaClock::default();
        let b = crate::OutputBlock {
            generation: Generation(1),
            source_start: 500,
            source_end: 1500,
            source_rate: 96000,
            output_start: 0,
            layout: PcmLayout::stereo48k(),
            valid_frames: 500,
        };
        assert!(clock.submit(b, 7));
        assert_eq!(clock.advance(37, 10), Some(540));
        assert_eq!(clock.consumed_frames(), 20);
        assert_eq!(clock.advance(1000, 10), Some(1500));
        assert_eq!(clock.consumed_frames(), 500);
        assert_eq!(clock.advance(1000, 10), Some(1500));
        assert_eq!(clock.consumed_frames(), 500);
        clock.reset();
        assert_eq!(clock.consumed_frames(), 0);
    }
    #[test]
    fn increasing_latency_freezes_partial_progress_without_replaying_credited_frames() {
        let mut clock = MediaClock::default();
        clock.submit(block(Generation(1), 0), 0);
        assert_eq!(clock.advance(6, 0), Some(6));
        assert_eq!(clock.consumed_frames(), 6);
        for _ in 0..3 {
            assert_eq!(clock.advance(1, 3), Some(6));
            assert_eq!(clock.consumed_frames(), 6);
        }
        assert_eq!(clock.advance(1, 3), Some(7));
        assert_eq!(clock.consumed_frames(), 7);
        assert_eq!(clock.advance(3, 3), Some(10));
        assert_eq!(clock.consumed_frames(), 10);
    }
}
