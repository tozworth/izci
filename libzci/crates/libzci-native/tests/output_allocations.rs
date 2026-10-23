//! Track this test thread's allocator traffic, including rubato's private FFT
//! plans/workspace. Source and sink use stack buffers; neither grows with time.
use libzci::{Generation, OutputBlock, OutputPreparation, PcmLayout};
use libzci_native::pcm_transport::pcm_transport;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

#[derive(Clone, Copy, Debug, Default)]
struct Metrics {
    live: isize,
    peak: usize,
    allocations: usize,
    deallocations: usize,
}
thread_local! {
    static TRACK: Cell<bool> = const { Cell::new(false) };
    static METRICS: Cell<Metrics> = Cell::new(Metrics::default());
}

struct MeasuredAllocator;
fn account(bytes: isize, allocation: bool) {
    if TRACK.try_with(Cell::get).unwrap_or(false) {
        let _ = METRICS.try_with(|cell| {
            let mut m = cell.get();
            m.live += bytes;
            m.peak = m.peak.max(m.live.max(0) as usize);
            if allocation {
                m.allocations += 1;
            } else {
                m.deallocations += 1;
            }
            cell.set(m);
        });
    }
}
unsafe impl GlobalAlloc for MeasuredAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let result = unsafe { System.alloc(layout) };
        if !result.is_null() {
            account(layout.size() as isize, true);
        }
        result
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let result = unsafe { System.alloc_zeroed(layout) };
        if !result.is_null() {
            account(layout.size() as isize, true);
        }
        result
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        account(-(layout.size() as isize), false);
        unsafe { System.dealloc(pointer, layout) };
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        let result = unsafe { System.realloc(pointer, layout, size) };
        if !result.is_null() {
            account(size as isize - layout.size() as isize, true);
        }
        result
    }
}
#[global_allocator]
static ALLOCATOR: MeasuredAllocator = MeasuredAllocator;

struct Measurement;
impl Measurement {
    fn start() -> Self {
        METRICS.with(|m| m.set(Metrics::default()));
        TRACK.with(|t| t.set(true));
        Self
    }
}
impl Drop for Measurement {
    fn drop(&mut self) {
        TRACK.with(|t| t.set(false));
    }
}

fn measure_pipeline(frames: usize, rate: u32) -> Metrics {
    let measurement = Measurement::start();
    let (mut tx, mut rx, monitor) = pcm_transport(2, Generation(1));
    let mut prepare =
        OutputPreparation::new(PcmLayout::stereo48k(), rate, 257, Generation(1)).unwrap();
    let mut input = [0.0; 257 * 2];
    let mut output = [0.0; 97 * 2];
    let mut position = 0;
    let mut emitted = 0;
    for tick in 0..1_000_000 {
        if prepare.needs_input() && tx.has_credit() {
            if position == frames {
                prepare.finish().unwrap();
            } else {
                let count = (frames - position).min(257);
                for (offset, frame) in input[..count * 2]
                    .as_chunks_mut::<2>()
                    .0
                    .iter_mut()
                    .enumerate()
                {
                    frame.fill(((position + offset) % 16384) as f32);
                }
                prepare
                    .accept(position as u64, &input[..count * 2])
                    .unwrap();
                position += count;
            }
        }
        prepare.pump(|block, samples| tx.write(block, samples));
        let size = [0, 1, 97, 0, 13][tick % 5];
        emitted += rx.render(&mut output[..size * 2]);
        if prepare.is_drained() && monitor.is_drained() {
            break;
        }
    }
    assert!(prepare.is_drained() && monitor.is_drained());
    assert_eq!(
        emitted,
        (frames as u64 * rate as u64).div_ceil(48_000) as usize
    );
    // Drop while measuring to detect leaks in the retained pipeline allocation.
    drop(prepare);
    drop(tx);
    drop(rx);
    drop(monitor);
    let metrics = METRICS.with(Cell::get);
    drop(measurement);
    assert_eq!(metrics.live, 0);
    metrics
}

#[test]
fn allocation_high_water_is_independent_of_source_duration() {
    for rate in [48_000, 44_100, 96_000] {
        let short = measure_pipeline(10_003, rate);
        let long = measure_pipeline(100_003, rate);
        assert_eq!(
            long.peak, short.peak,
            "{rate}: duration-dependent retained heap"
        );
        assert_eq!(
            long.allocations, short.allocations,
            "{rate}: streaming allocation"
        );
        eprintln!("{rate} Hz: peak heap {} bytes, {} total setup allocations; same for 10,003 and 100,003 frames",
            long.peak, long.allocations);
    }
}

#[test]
fn callback_render_reset_and_recycling_never_allocate_or_deallocate() {
    let (mut tx, mut rx, control) = pcm_transport(2, Generation(1));
    let block = OutputBlock {
        generation: Generation(1),
        source_start: 0,
        source_end: 256,
        source_rate: 48_000,
        output_start: 0,
        layout: PcmLayout::stereo48k(),
        valid_frames: 256,
    };
    tx.write(block, &[1.0; 512]);
    tx.write(block, &[1.0; 512]);
    let mut out = [0.0; 22];
    let measurement = Measurement::start();
    rx.render(&mut out); // Partial active block.
    control.set_volume(0.3);
    rx.render(&mut out); // Shared smoothing.
    control.request_generation(Generation(2));
    rx.render(&mut out); // Recycle stale active + ready indices.
    rx.render(&mut out); // Underrun.
    control.stop();
    rx.render(&mut out); // Stopped control path.
    let metrics = METRICS.with(Cell::get);
    drop(measurement);
    assert_eq!(metrics.allocations, 0);
    assert_eq!(metrics.deallocations, 0);
}
