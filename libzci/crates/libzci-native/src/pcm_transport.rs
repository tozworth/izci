//! Native SPSC transport: ready/recycle queues carry fixed-pool indices only.
//! A slot is owned by exactly one endpoint/queue. No cloneable producer, no
//! shared mutable Vec, and no producer-side read-cursor reset.

use libzci::{AudioProcessor, Generation, OutputBlock};
use rtrb::{Consumer, Producer, RingBuffer};
use std::cell::UnsafeCell;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering},
    Arc,
};

pub const BLOCK_FRAMES: usize = 256;

struct Slot {
    samples: [f32; BLOCK_FRAMES * 2],
    block: OutputBlock,
}

struct Pool {
    slots: Box<[UnsafeCell<Slot>]>,
}

// SAFETY: slot indices start exactly once in recycle. Only PcmProducer writes
// a slot, after acquiring its index; publication via rtrb transfers ownership to
// PcmConsumer. Only that consumer reads it until recycling. Neither endpoint is
// Clone, accesses require &mut self, no reference escapes a call, and an index is
// never duplicated. rtrb's release/acquire handoff orders the storage accesses.
unsafe impl Sync for Pool {}

/// Control and observations never wait for PCM capacity. This handle cannot
/// access pool samples or either queue cursor.
pub struct OutputMonitor {
    requested: AtomicU64,
    acknowledged: AtomicU64,
    held: AtomicBool,
    stopped: AtomicBool,
    volume: AtomicU32,
    mute: AtomicBool,
    queued_frames: AtomicUsize,
    render_epoch: AtomicU64,
    media_position: AtomicU64,
    media_generation: AtomicU64,
    media_valid: AtomicBool,
    clock_drained: AtomicBool,
    timing_overflow: AtomicBool,
    pool: Arc<Pool>,
}

impl OutputMonitor {
    pub fn request_generation(&self, generation: Generation) {
        self.requested.store(generation.0, Ordering::Release);
    }
    pub fn generation(&self) -> Generation {
        Generation(self.requested.load(Ordering::Acquire))
    }
    pub fn acknowledged_generation(&self) -> Generation {
        Generation(self.acknowledged.load(Ordering::Acquire))
    }
    pub fn set_held(&self, held: bool) {
        self.held.store(held, Ordering::Release);
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
    pub fn set_volume(&self, volume: f32) {
        if volume.is_finite() {
            self.volume
                .store(volume.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        }
    }
    pub fn set_mute(&self, mute: bool) {
        self.mute.store(mute, Ordering::Relaxed);
    }
    pub fn len_frames(&self) -> usize {
        self.queued_frames.load(Ordering::Acquire)
    }
    /// Zero queued media observed across a completed callback boundary.
    pub fn is_drained(&self) -> bool {
        let epoch = self.render_epoch.load(Ordering::Acquire);
        epoch.is_multiple_of(2)
            && self.len_frames() == 0
            && self.clock_drained.load(Ordering::Acquire)
            && self.render_epoch.load(Ordering::Acquire) == epoch
    }
    /// A coherent callback observation; no source progress during underruns.
    pub fn media_position(&self) -> Option<(Generation, u64)> {
        let epoch = self.render_epoch.load(Ordering::Acquire);
        if !epoch.is_multiple_of(2) || !self.media_valid.load(Ordering::Acquire) {
            return None;
        }
        let value = (
            Generation(self.media_generation.load(Ordering::Relaxed)),
            self.media_position.load(Ordering::Relaxed),
        );
        (self.render_epoch.load(Ordering::Acquire) == epoch).then_some(value)
    }
    /// Completion and position must come from the same callback boundary.
    /// A separate empty-queue query followed by a position query can race the
    /// next callback and finalize with an older snapshot.
    pub fn completed_position(&self) -> Option<(Generation, Option<u64>)> {
        let epoch = self.render_epoch.load(Ordering::Acquire);
        if !epoch.is_multiple_of(2)
            || self.len_frames() != 0
            || !self.clock_drained.load(Ordering::Acquire)
        {
            return None;
        }
        let generation = self.acknowledged_generation();
        let position = if self.media_valid.load(Ordering::Acquire)
            && self.media_generation.load(Ordering::Relaxed) == generation.0
        {
            Some(self.media_position.load(Ordering::Relaxed))
        } else {
            None
        };
        (self.render_epoch.load(Ordering::Acquire) == epoch).then_some((generation, position))
    }
    pub fn timing_failed(&self) -> bool {
        self.timing_overflow.load(Ordering::Acquire)
    }
    pub fn capacity_frames(&self) -> usize {
        self.pool.slots.len() * BLOCK_FRAMES
    }
    /// Fixed PCM/descriptor and queue-element storage (excludes Arc/queue headers).
    pub fn retained_bytes(&self) -> usize {
        self.pool.slots.len() * (size_of::<Slot>() + 2 * size_of::<usize>())
    }
}

pub struct PcmProducer {
    ready: Producer<usize>,
    recycle: Consumer<usize>,
    monitor: Arc<OutputMonitor>,
}

pub struct PcmConsumer {
    ready: Consumer<usize>,
    recycle: Producer<usize>,
    monitor: Arc<OutputMonitor>,
    active: Option<usize>,
    offset: usize,
    processor: AudioProcessor,
    clock: libzci::audio::clock::MediaClock,
    clock_generation: Generation,
    latency: u64,
}

/// Preallocate before starting output. The returned endpoints have unique queue
/// ownership. Pool storage remains alive through the separate owner monitor.
pub fn pcm_transport(
    blocks: usize,
    generation: Generation,
) -> (PcmProducer, PcmConsumer, Arc<OutputMonitor>) {
    assert!(blocks > 0);
    let (ready_tx, ready_rx) = RingBuffer::new(blocks);
    let (mut recycle_tx, recycle_rx) = RingBuffer::new(blocks);
    let descriptor = OutputBlock {
        generation,
        source_start: 0,
        source_end: 0,
        source_rate: 48_000,
        output_start: 0,
        layout: libzci::PcmLayout::stereo48k(),
        valid_frames: 0,
    };
    let pool = Arc::new(Pool {
        slots: (0..blocks)
            .map(|index| {
                recycle_tx.push(index).unwrap();
                UnsafeCell::new(Slot {
                    samples: [0.0; BLOCK_FRAMES * 2],
                    block: descriptor,
                })
            })
            .collect(),
    });
    let monitor = Arc::new(OutputMonitor {
        requested: AtomicU64::new(generation.0),
        acknowledged: AtomicU64::new(generation.0),
        held: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
        volume: AtomicU32::new(1.0f32.to_bits()),
        mute: AtomicBool::new(false),
        queued_frames: AtomicUsize::new(0),
        render_epoch: AtomicU64::new(0),
        media_position: AtomicU64::new(0),
        media_generation: AtomicU64::new(generation.0),
        media_valid: AtomicBool::new(false),
        clock_drained: AtomicBool::new(true),
        timing_overflow: AtomicBool::new(false),
        pool,
    });
    (
        PcmProducer {
            ready: ready_tx,
            recycle: recycle_rx,
            monitor: monitor.clone(),
        },
        PcmConsumer {
            ready: ready_rx,
            recycle: recycle_tx,
            monitor: monitor.clone(),
            active: None,
            offset: 0,
            processor: AudioProcessor::new(),
            clock: Default::default(),
            clock_generation: generation,
            latency: 0,
        },
        monitor,
    )
}

impl PcmProducer {
    /// A credit reserves one fixed pool slot, even for a partial block.
    pub fn has_credit(&mut self) -> bool {
        !self.recycle.is_empty() && !self.monitor.is_stopped()
    }

    /// Copy a bounded prefix; the caller retains any suffix. A stale block is
    /// rejected even if reset happened after preparation but before publication.
    pub fn write(&mut self, block: OutputBlock, samples: &[f32]) -> usize {
        if self.monitor.is_stopped()
            || block.generation != self.monitor.generation()
            || block.valid_frames == 0
        {
            return 0;
        }
        assert_eq!(block.layout.layout, libzci::ChannelLayout::Stereo);
        assert_eq!(samples.len(), block.valid_frames * 2);
        assert!(samples.iter().all(|s| s.is_finite()));
        let Ok(index) = self.recycle.pop() else {
            return 0;
        };
        let frames = block.valid_frames.min(BLOCK_FRAMES);
        // SAFETY: acquiring recycle index gives this endpoint unique slot access.
        let slot = unsafe { &mut *self.monitor.pool.slots[index].get() };
        slot.samples[..frames * 2].copy_from_slice(&samples[..frames * 2]);
        slot.block = block.slice(0, frames);
        self.monitor
            .queued_frames
            .fetch_add(frames, Ordering::Release);
        // With N pool slots, owning this index proves ready has at most N-1.
        self.ready.push(index).expect("pool index conservation");
        frames
    }
}

impl PcmConsumer {
    fn release_active(&mut self) {
        if let Some(index) = self.active.take() {
            // SAFETY: active is consumer-owned until the recycle publication.
            let frames = unsafe { (*self.monitor.pool.slots[index].get()).block.valid_frames };
            self.monitor
                .queued_frames
                .fetch_sub(frames - self.offset, Ordering::Release);
            self.offset = 0;
            self.recycle.push(index).expect("pool index conservation");
        }
    }

    fn select_current(&mut self, generation: Generation) -> bool {
        // At most the pool size stale blocks can be outstanding.
        for _ in 0..=self.monitor.pool.slots.len() {
            if self.active.is_none() {
                self.active = self.ready.pop().ok();
                self.offset = 0;
            }
            let Some(index) = self.active else {
                return false;
            };
            // SAFETY: the popped index is exclusively consumer-owned.
            let block = unsafe { (*self.monitor.pool.slots[index].get()).block };
            // A control switch can race a callback between blocks. Preserve a
            // newly published current block for the final boundary check instead
            // of discarding it using this callback's obsolete local generation.
            if self.monitor.generation() != generation && !self.monitor.is_stopped() {
                return false;
            }
            if block.generation == generation && !self.monitor.is_stopped() {
                return true;
            }
            self.release_active();
        }
        false
    }

    /// Render media and underrun silence. Returns valid media frames, independent
    /// of callback/device frame count. No allocation, waits, or control locks.
    pub fn render(&mut self, out: &mut [f32]) -> usize {
        self.render_boundary(out, || {})
    }

    pub fn render_with_latency(&mut self, out: &mut [f32], latency: u64) -> usize {
        self.latency = latency;
        self.render(out)
    }
    fn render_boundary(&mut self, out: &mut [f32], boundary: impl FnOnce()) -> usize {
        self.monitor.render_epoch.fetch_add(1, Ordering::AcqRel);
        out.fill(0.0);
        let generation = self.monitor.generation();
        if self.clock_generation != generation {
            self.clock.reset();
            self.clock_generation = generation;
            self.monitor.media_valid.store(false, Ordering::Release);
        }
        let mut frames = 0;
        self.select_current(generation);
        self.monitor
            .acknowledged
            .store(generation.0, Ordering::Release);
        if !self.monitor.held.load(Ordering::Acquire) && !self.monitor.is_stopped() {
            while frames < out.len() / 2
                && self.monitor.generation() == generation
                && self.select_current(generation)
            {
                let index = self.active.unwrap();
                // SAFETY: producer cannot regain this index until release_active.
                let slot = unsafe { &*self.monitor.pool.slots[index].get() };
                let count = (out.len() / 2 - frames).min(slot.block.valid_frames - self.offset);
                out[frames * 2..(frames + count) * 2]
                    .copy_from_slice(&slot.samples[self.offset * 2..(self.offset + count) * 2]);
                if !self
                    .clock
                    .submit(slot.block.slice(self.offset, count), frames as u64)
                {
                    self.monitor.timing_overflow.store(true, Ordering::Release);
                }
                self.offset += count;
                frames += count;
                self.monitor
                    .queued_frames
                    .fetch_sub(count, Ordering::Release);
                if self.offset == slot.block.valid_frames {
                    self.release_active();
                }
            }
        }
        boundary();
        // Reset arriving during a pop invalidates this entire submission. Audio
        // already handed to the OS before a request cannot be recalled.
        let current = self.monitor.generation();
        if current != generation || self.monitor.is_stopped() {
            out.fill(0.0);
            self.clock.reset();
            self.clock_generation = current;
            self.monitor.media_valid.store(false, Ordering::Release);
            self.monitor.clock_drained.store(true, Ordering::Release);
            self.select_current(current);
            self.monitor
                .acknowledged
                .store(current.0, Ordering::Release);
            self.monitor.render_epoch.fetch_add(1, Ordering::Release);
            return 0;
        }
        if !self.monitor.held.load(Ordering::Acquire) {
            if let Some(position) = self.clock.advance((out.len() / 2) as u64, self.latency) {
                self.monitor
                    .media_position
                    .store(position, Ordering::Relaxed);
                self.monitor
                    .media_generation
                    .store(generation.0, Ordering::Relaxed);
                self.monitor.media_valid.store(true, Ordering::Release);
            }
        }
        self.monitor
            .clock_drained
            .store(self.clock.drained(), Ordering::Release);
        self.processor
            .set_volume(f32::from_bits(self.monitor.volume.load(Ordering::Relaxed)));
        self.processor
            .set_mute(self.monitor.mute.load(Ordering::Relaxed));
        self.processor
            .process_stereo_in_place(&mut out[..frames * 2]);
        self.monitor.render_epoch.fetch_add(1, Ordering::Release);
        frames
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generation_change_during_pop_rejects_copied_samples() {
        let (mut tx, mut rx, control) = pcm_transport(2, Generation(1));
        let block = OutputBlock {
            generation: Generation(1),
            source_start: 0,
            source_end: 8,
            source_rate: 48_000,
            output_start: 0,
            layout: libzci::PcmLayout::stereo48k(),
            valid_frames: 8,
        };
        assert_eq!(tx.write(block, &[1.0; 16]), 8);
        let mut out = [9.0; 4];
        assert_eq!(
            rx.render_boundary(&mut out, || control.request_generation(Generation(2))),
            0
        );
        assert_eq!(out, [0.0; 4]);
        assert_eq!(control.acknowledged_generation(), Generation(2));
        assert_eq!(control.len_frames(), 0);
        assert_eq!(tx.write(block, &[1.0; 16]), 0);
        assert!(tx.has_credit());
    }

    #[test]
    fn obsolete_callback_generation_cannot_recycle_new_media() {
        let (mut tx, mut rx, control) = pcm_transport(1, Generation(1));
        control.request_generation(Generation(2));
        let block = OutputBlock {
            generation: Generation(2),
            source_start: 0,
            source_end: 1,
            source_rate: 48_000,
            output_start: 0,
            layout: libzci::PcmLayout::stereo48k(),
            valid_frames: 1,
        };
        assert_eq!(tx.write(block, &[2.0; 2]), 1);
        assert!(!rx.select_current(Generation(1)));
        let mut out = [0.0; 2];
        assert_eq!(rx.render(&mut out), 1);
        assert_eq!(out, [2.0; 2]);
    }

    #[test]
    fn completion_waits_for_callback_submission_boundary() {
        let (mut tx, mut rx, control) = pcm_transport(1, Generation(1));
        let block = OutputBlock {
            generation: Generation(1),
            source_start: 0,
            source_end: 1,
            source_rate: 48_000,
            output_start: 0,
            layout: libzci::PcmLayout::stereo48k(),
            valid_frames: 1,
        };
        tx.write(block, &[1.0; 2]);
        rx.render_boundary(&mut [0.0; 2], || {
            assert_eq!(control.len_frames(), 0);
            assert!(!control.is_drained());
        });
        assert!(control.is_drained());
    }
}
