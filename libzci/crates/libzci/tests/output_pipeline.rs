//! Deterministic loss/backpressure checks: no codecs, device, files, or sleeps.
use libzci::{Generation, OutputBlock, OutputPreparation, PcmLayout, RateConverter};

fn marked(frames: usize) -> Vec<f32> {
    (0..frames)
        .flat_map(|n| [n as f32 + 1.0, -(n as f32) - 1.0])
        .collect()
}

fn run(source: &[f32], from: u32, to: u32, schedule: &[usize]) -> (Vec<f32>, usize) {
    let mut preparation = OutputPreparation::new(
        PcmLayout::new(libzci::ChannelLayout::Stereo, from).unwrap(),
        to,
        257,
        Generation(7),
    )
    .unwrap();
    let bytes = preparation.retained_bytes();
    let mut high_water = 0;
    let mut input = 0;
    let mut output = Vec::new();
    let mut last_end = 0;
    for tick in 0..1_000_000 {
        if preparation.needs_input() {
            if input == source.len() {
                preparation.finish().unwrap();
            } else {
                let end = (input + 257 * 2).min(source.len());
                preparation
                    .accept((input / 2) as u64, &source[input..end])
                    .unwrap();
                input = end;
            }
        }
        let capacity = schedule[tick % schedule.len()];
        preparation.pump(|block, samples| {
            assert_eq!(block.generation, Generation(7));
            assert_eq!(block.source_rate, from);
            assert_eq!(block.layout.sample_rate, to);
            assert_eq!(block.output_start, (output.len() / 2) as u64);
            assert!(block.source_start >= last_end);
            assert!(block.source_end <= (source.len() / 2) as u64);
            let count = capacity.min(block.valid_frames);
            let accepted = block.slice(0, count);
            last_end = accepted.source_end;
            output.extend_from_slice(&samples[..count * 2]);
            count
        });
        high_water = high_water.max(preparation.retained_frames());
        assert_eq!(
            preparation.retained_bytes(),
            bytes,
            "storage grew with source length"
        );
        if preparation.is_drained() {
            return (output, high_water);
        }
    }
    panic!("pipeline made no progress");
}

#[test]
fn long_marked_signal_survives_zero_partial_and_full_writes_exactly() {
    let source = marked(50_003); // More than 190 times the preparation block.
    let (slow, high) = run(&source, 48_000, 48_000, &[0, 0, 1, 7, 0, 3, 19]);
    assert_eq!(slow, source);
    assert!(high <= 514);
}

#[test]
fn converted_output_and_tail_match_unrestricted_sink_at_multiple_ratios() {
    for (from, to) in [
        (48_000, 44_100),
        (44_100, 48_000),
        (8_000, 192_000),
        (192_000, 8_000),
    ] {
        for frames in [16_384, 20_003] {
            // Full blocks and a short final tail.
            let source = marked(frames);
            let (expected, high_fast) = run(&source, from, to, &[usize::MAX]);
            let (slow, high_slow) = run(&source, from, to, &[0, 1, 17, 0, 63, 2, 257]);
            assert_eq!(slow, expected, "{from}->{to}, {frames} frames");
            assert_eq!(
                slow.len() / 2,
                (frames as u64 * to as u64).div_ceil(from as u64) as usize
            );
            assert!(slow.iter().all(|x| x.is_finite()));
            assert!(high_slow <= high_fast + 257);
        }
    }
}

#[test]
fn converter_releases_tail_once_and_reset_clears_timeline_counters() {
    for frames in [0, 1, 1024, 4096] {
        let mut converter = RateConverter::new(48_000, 24_000, 2).unwrap();
        let mut source = vec![0.0; frames * 2];
        if frames > 0 {
            source[(frames - 1) * 2] = 1.0;
        }
        converter.push(&source).unwrap();
        converter.flush().unwrap();
        let mut output = vec![0.0; 8192];
        let count = converter.pop(&mut output);
        assert_eq!(count, frames.div_ceil(2) * 2);
        if frames > 0 {
            assert!(
                output[..count].iter().any(|s| s.abs() > 0.01),
                "lost final impulse"
            );
        }
        converter.flush().unwrap();
        assert_eq!(converter.pop(&mut output), 0);
        converter.reset();
        converter.push(&[1.0, 1.0]).unwrap();
        converter.flush().unwrap();
        assert_eq!(converter.pop(&mut output), 2);
    }
}

#[test]
fn refuses_uncredited_oversized_and_nonfinite_source_blocks() {
    let mut p = OutputPreparation::new(PcmLayout::mono48k(), 48_000, 8, Generation(1)).unwrap();
    assert!(p.accept(0, &[0.0; 9]).is_err());
    assert!(p.accept(0, &[f32::NAN]).is_err());
    p.accept(12, &[1.0; 8]).unwrap();
    assert!(p.accept(20, &[1.0]).is_err());
    p.finish().unwrap(); // EOF while a matched-rate suffix is still pending.
    assert!(!p.is_drained());
    let mut got = Vec::new();
    while !p.is_drained() {
        p.pump(|_, samples| {
            got.extend_from_slice(&samples[..2]);
            1
        });
    }
    assert_eq!(got, [1.0; 16]);
    assert!(p.accept(20, &[1.0]).is_err());
}

#[test]
fn descriptors_preserve_seek_origin_and_partial_frame_ranges() {
    let block = OutputBlock {
        generation: Generation(2),
        source_start: 900,
        source_end: 910,
        source_rate: 48_000,
        output_start: 0,
        layout: PcmLayout::stereo48k(),
        valid_frames: 10,
    };
    let suffix = block.slice(3, 7);
    assert_eq!(
        (
            suffix.source_start,
            suffix.source_end,
            suffix.output_start,
            suffix.valid_frames
        ),
        (903, 910, 3, 7)
    );
}
