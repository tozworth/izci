//! Real pool/queue endpoints and shared preparation, with a test-only slow sink.
use libzci::{Generation, OutputBlock, OutputPreparation, PcmLayout};
use libzci_native::pcm_transport::{pcm_transport, BLOCK_FRAMES};
use std::sync::{Arc, Barrier};

fn block(generation: u64, start: u64, frames: usize) -> OutputBlock {
    OutputBlock {
        generation: Generation(generation),
        source_start: start,
        source_end: start + frames as u64,
        source_rate: 48_000,
        output_start: start,
        layout: PcmLayout::stereo48k(),
        valid_frames: frames,
    }
}

fn marked(start: usize, frames: usize) -> Vec<f32> {
    (start..start + frames)
        .flat_map(|i| [i as f32 + 1.0, -(i as f32) - 1.0])
        .collect()
}

#[test]
fn tiny_fixed_pool_preserves_long_source_and_converted_tail() {
    for rate in [48_000, 44_100, 96_000] {
        let (mut tx, mut rx, monitor) = pcm_transport(2, Generation(4));
        let mut prepare =
            OutputPreparation::new(PcmLayout::stereo48k(), rate, 257, Generation(4)).unwrap();
        let memory = prepare.retained_bytes() + monitor.retained_bytes();
        let source = marked(0, 30_013); // >58 times the pool capacity.
        let mut expected =
            OutputPreparation::new(PcmLayout::stereo48k(), rate, 257, Generation(4)).unwrap();
        let mut reference = Vec::new();
        let mut input = 0;
        let mut rendered = Vec::new();
        let mut scratch = [0.0; 193 * 2];
        let schedule = [0, 1, 0, 17, 193, 0, 3];
        let mut done = false;
        for tick in 0..200_000 {
            // The test source obeys the same downstream decode credit rule.
            if prepare.needs_input() && tx.has_credit() {
                if input == source.len() {
                    prepare.finish().unwrap();
                    expected.finish().unwrap();
                } else {
                    let end = (input + 257 * 2).min(source.len());
                    prepare
                        .accept(input as u64 / 2, &source[input..end])
                        .unwrap();
                    expected
                        .accept(input as u64 / 2, &source[input..end])
                        .unwrap();
                    input = end;
                }
                // Unrestricted comparison uses identical preparation chunks.
                while expected.pump(|_, samples| {
                    reference.extend_from_slice(samples);
                    samples.len() / 2
                }) > 0
                {}
            }
            prepare.pump(|descriptor, samples| tx.write(descriptor, samples));
            assert!(monitor.len_frames() <= 2 * BLOCK_FRAMES);
            assert_eq!(prepare.retained_bytes() + monitor.retained_bytes(), memory);
            let count = schedule[tick % schedule.len()];
            let got = rx.render(&mut scratch[..count * 2]);
            rendered.extend_from_slice(&scratch[..got * 2]);
            assert!(scratch[got * 2..count * 2].iter().all(|s| *s == 0.0));
            if prepare.is_drained() && monitor.is_drained() {
                done = true;
                break;
            }
        }
        assert!(done, "failed to drain {rate}");
        assert_eq!(rendered, reference);
        assert_eq!(
            rendered.len() / 2,
            (30_013u64 * rate as u64).div_ceil(48_000) as usize
        );
        if rate == 48_000 {
            assert_eq!(rendered, source);
        }
    }
}

#[test]
fn concurrent_producer_consumer_preserve_every_marked_sample() {
    let (mut tx, mut rx, monitor) = pcm_transport(3, Generation(1));
    let producer = std::thread::spawn(move || {
        let mut start = 0;
        for n in 0..20_000 {
            let frames = 1 + n % BLOCK_FRAMES;
            // Integer marker is constant inside each block and identifies order.
            let samples = vec![n as f32 + 1.0; frames * 2];
            while tx.write(block(1, start as u64, frames), &samples) == 0 {
                std::thread::yield_now();
            }
            start += frames;
        }
    });
    let mut scratch = [0.0; 97 * 2];
    let mut expected_block = 0;
    let mut offset = 0;
    while expected_block < 20_000 {
        let got = rx.render(&mut scratch);
        for frame in scratch[..got * 2].chunks_exact(2) {
            assert_eq!(frame, [expected_block as f32 + 1.0; 2]);
            offset += 1;
            if offset == 1 + expected_block % BLOCK_FRAMES {
                expected_block += 1;
                offset = 0;
            }
        }
        assert!(monitor.len_frames() <= 3 * BLOCK_FRAMES);
        if got == 0 {
            std::thread::yield_now();
        }
    }
    producer.join().unwrap();
    assert!(monitor.is_drained());
}

#[test]
fn full_pool_generation_switch_recycles_stale_partial_block_while_held() {
    let (mut tx, mut rx, monitor) = pcm_transport(2, Generation(1));
    assert_eq!(tx.write(block(1, 0, 8), &[1.0; 16]), 8);
    assert_eq!(tx.write(block(1, 8, 8), &[1.0; 16]), 8);
    let mut out = [0.0; 6];
    assert_eq!(rx.render(&mut out), 3);
    assert!(!tx.has_credit());
    monitor.set_held(true);
    monitor.request_generation(Generation(2));
    assert_eq!(rx.render(&mut out), 0);
    assert_eq!(monitor.acknowledged_generation(), Generation(2));
    assert!(monitor.is_drained());
    assert!(tx.has_credit());
    assert_eq!(tx.write(block(1, 0, 1), &[1.0; 2]), 0);
    assert_eq!(tx.write(block(2, 90, 1), &[2.0; 2]), 1);
    assert_eq!(rx.render(&mut out), 0);
    assert_eq!(monitor.len_frames(), 1);
    monitor.set_held(false);
    assert_eq!(rx.render(&mut out), 1);
    assert_eq!(out, [2.0, 2.0, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn blocked_capacity_shutdown_does_not_need_consumer_progress() {
    let (mut tx, _rx, monitor) = pcm_transport(1, Generation(1));
    assert_eq!(tx.write(block(1, 0, 1), &[1.0; 2]), 1);
    let barrier = Arc::new(Barrier::new(2));
    let worker_barrier = barrier.clone();
    let worker_monitor = monitor.clone();
    let worker = std::thread::spawn(move || {
        assert!(!tx.has_credit());
        worker_barrier.wait();
        while !worker_monitor.is_stopped() {
            assert_eq!(tx.write(block(1, 1, 1), &[2.0; 2]), 0);
            std::thread::yield_now();
        }
    });
    barrier.wait();
    monitor.stop();
    worker.join().unwrap();
    assert!(monitor.is_stopped());
}

#[test]
fn concurrent_generation_requests_acknowledge_without_mixing_epochs() {
    let (mut tx, mut rx, monitor) = pcm_transport(2, Generation(0));
    let control = monitor.clone();
    let producer = std::thread::spawn(move || {
        for generation in 1..=2_000 {
            control.request_generation(Generation(generation));
            while tx.write(block(generation, 0, 64), &[generation as f32; 128]) == 0 {
                std::thread::yield_now();
            }
            while control.acknowledged_generation() != Generation(generation) {
                std::thread::yield_now();
            }
        }
        control.stop();
    });
    let mut out = [0.0; 38];
    let mut last = 0.0;
    while !monitor.is_stopped() {
        let got = rx.render(&mut out);
        for pair in out[..got * 2].chunks_exact(2) {
            assert_eq!(pair[0], pair[1]);
            assert!(pair[0] >= last);
            last = pair[0];
        }
        std::thread::yield_now();
    }
    producer.join().unwrap();
    rx.render(&mut out);
    assert!(monitor.is_drained());
}
