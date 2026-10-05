//! Bounded lock-free PCM transport between decode jobs and output.
//!
//! One single-producer/single-consumer ring of interleaved stereo `f32`
//! frames. The device callback (or worklet) pops; the decode job
//! pushes. Neither side allocates, blocks on control locks, or touches
//! SQL/files: full/empty are reported, never waited on. Underruns and
//! overruns are counted for diagnostics.

use std::sync::atomic::{AtomicU64, Ordering};

/// Interleaved stereo frame ring (SPSC).
#[derive(Debug)]
pub struct PcmRing {
    buf: Vec<f32>,
    /// Capacity in frames (stereo pairs).
    capacity_frames: usize,
    read: AtomicU64,
    write: AtomicU64,
    /// Pops that found the ring empty.
    pub underruns: AtomicU64,
    /// Pushes that found the ring full (dropped).
    pub overruns: AtomicU64,
}

impl PcmRing {
    /// Create with room for `capacity_frames` stereo frames.
    /// Capacity is at least 1 frame; the buffer is preallocated.
    pub fn new(capacity_frames: usize) -> Self {
        let capacity_frames = capacity_frames.max(1);
        Self {
            buf: vec![0.0; capacity_frames * 2],
            capacity_frames,
            read: AtomicU64::new(0),
            write: AtomicU64::new(0),
            underruns: AtomicU64::new(0),
            overruns: AtomicU64::new(0),
        }
    }

    /// Capacity in stereo frames.
    pub fn capacity_frames(&self) -> usize {
        self.capacity_frames
    }

    /// Readable stereo frames right now.
    pub fn len_frames(&self) -> usize {
        (self.write.load(Ordering::Acquire) - self.read.load(Ordering::Acquire)) as usize
    }

    /// `true` when no frames are readable.
    pub fn is_empty(&self) -> bool {
        self.len_frames() == 0
    }

    /// Writable stereo frames right now.
    pub fn free_frames(&self) -> usize {
        self.capacity_frames - self.len_frames().min(self.capacity_frames)
    }

    /// Push interleaved stereo samples (`samples.len()` must be even).
    /// Returns frames accepted (drops the rest on overflow, counted).
    pub fn push(&self, samples: &[f32]) -> usize {
        debug_assert!(samples.len() % 2 == 0);
        let mut accepted = 0;
        let mut frames = samples.chunks_exact(2);
        // SAFETY: single producer; index math keeps every write inside
        // the preallocated buffer.
        let buf = self.buf.as_ptr() as *mut f32;
        for frame in &mut frames {
            let w = self.write.load(Ordering::Relaxed);
            let r = self.read.load(Ordering::Acquire);
            if w - r >= self.capacity_frames as u64 {
                self.overruns.fetch_add(1, Ordering::Relaxed);
                break;
            }
            let at = (w % self.capacity_frames as u64) as usize * 2;
            unsafe {
                buf.add(at).write(frame[0]);
                buf.add(at + 1).write(frame[1]);
            }
            self.write.store(w + 1, Ordering::Release);
            accepted += 1;
        }
        accepted
    }

    /// Pop up to `out.len() / 2` stereo frames into `out` (interleaved).
    /// Returns samples written; short reads mean underrun (counted).
    /// Callers render silence for the remainder (drain accounting).
    pub fn pop(&self, out: &mut [f32]) -> usize {
        let mut written = 0;
        let buf = self.buf.as_ptr();
        while written + 1 < out.len() {
            let r = self.read.load(Ordering::Relaxed);
            let w = self.write.load(Ordering::Acquire);
            if r >= w {
                self.underruns.fetch_add(1, Ordering::Relaxed);
                break;
            }
            let at = (r % self.capacity_frames as u64) as usize * 2;
            // SAFETY: single consumer; the slot was fully written before
            // `write` advanced (Release/Acquire pair).
            unsafe {
                out[written] = *buf.add(at);
                out[written + 1] = *buf.add(at + 1);
            }
            self.read.store(r + 1, Ordering::Release);
            written += 2;
        }
        written
    }

    /// Drop all buffered frames (pause/seek flush: no stale audio).
    /// Returns dropped frames.
    pub fn clear(&self) -> u64 {
        let w = self.write.load(Ordering::Acquire);
        let r = self.read.load(Ordering::Acquire);
        self.read.store(w, Ordering::Release);
        w - r
    }

    /// Cumulative underruns.
    pub fn underrun_count(&self) -> u64 {
        self.underruns.load(Ordering::Relaxed)
    }

    /// Cumulative overrun frames dropped.
    pub fn overrun_count(&self) -> u64 {
        self.overruns.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_pop_round_trip_with_bounds() {
        let ring = PcmRing::new(8);
        assert_eq!(ring.push(&[1.0, 2.0, 3.0, 4.0]), 2);
        assert_eq!(ring.len_frames(), 2);
        let mut out = [0.0f32; 4];
        assert_eq!(ring.pop(&mut out), 4);
        assert_eq!(out, [1.0, 2.0, 3.0, 4.0]);
        assert!(ring.is_empty());
        // Empty pop underruns (counted) and writes nothing.
        let mut out = [9.0f32; 2];
        assert_eq!(ring.pop(&mut out), 0);
        assert_eq!(ring.underrun_count(), 1);
        assert_eq!(out, [9.0, 9.0]);
    }

    #[test]
    fn overflow_drops_and_counts() {
        let ring = PcmRing::new(2);
        assert_eq!(ring.push(&[0.0; 8]), 2);
        assert_eq!(ring.overrun_count(), 1);
        assert_eq!(ring.free_frames(), 0);
        assert_eq!(ring.clear(), 2);
        assert_eq!(ring.free_frames(), 2);
    }
}
