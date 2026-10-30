//! Real reference-provider samples, no device or full-media production sink.
use libzci::*;
use libzci_native::{render::*, NativeRuntime};
use std::sync::Arc;
fn render(bytes: Vec<u8>, processing: ProcessingMode) -> Vec<f32> {
    render_from(bytes, processing, 0.0)
}
fn render_from(bytes: Vec<u8>, processing: ProcessingMode, start: f64) -> Vec<f32> {
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(libzci_codecs::OpusFactory::default()))
        .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(bytes)));
    let mut job = rt
        .start_render(
            source,
            Some("opus"),
            RenderOptions {
                processing,
                load: LoadOptions {
                    start_time: MediaTime(start),
                    subsong: None,
                },
                ..Default::default()
            },
            &CancelFlag::default(),
        )
        .unwrap();
    let mut output = vec![];
    loop {
        match job.next_step().unwrap() {
            RenderStep::Data { samples, .. } => output.extend(samples),
            RenderStep::Pending => {}
            RenderStep::Complete(_) => return output,
        }
    }
}
fn fix_crc(bytes: &mut [u8]) {
    let n = bytes[26] as usize;
    let len = 27 + n + bytes[27..27 + n].iter().map(|b| *b as usize).sum::<usize>();
    bytes[22..26].fill(0);
    let crc = ogg_crc(&bytes[..len], &[], 22);
    bytes[22..26].copy_from_slice(&crc.to_le_bytes());
}
#[test]
fn processed_chain_uses_each_link_tags_at_exact_audible_boundaries_and_seek_origin() {
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.local/libzci/media/r3");
    let mut chain = std::fs::read(root.join("mono.opus")).unwrap();
    let mut second = std::fs::read(root.join("stereo.opus")).unwrap();
    let tag = b"R128_TRACK_GAIN=256";
    let at = second.windows(tag.len()).position(|w| w == tag).unwrap();
    second[at + tag.len() - 3..at + tag.len()].copy_from_slice(b"512");
    let mut at = 0;
    while at < second.len() {
        second[at + 14..at + 18].copy_from_slice(&42_u32.to_le_bytes());
        fix_crc(&mut second[at..]);
        let n = second[at + 26] as usize;
        at += 27
            + n
            + second[at + 27..at + 27 + n]
                .iter()
                .map(|n| *n as usize)
                .sum::<usize>();
    }
    chain.extend(second);
    let instance = libzci_codecs::OpusInstance::open(
        Arc::new(MemSource::new(chain.clone())),
        libzci_codecs::OpusLimits::default(),
        &CancelFlag::default(),
    )
    .unwrap();
    let metadata = instance.metadata();
    assert_eq!(metadata.normalization_points.len(), 2);
    assert_eq!(metadata.normalization_points[1].source_frame, 12006);
    let settings = ReplayGainSettings {
        mode: ReplayGainMode::Track,
        ..Default::default()
    };
    let program = metadata.normalization_program(settings).unwrap();
    assert_eq!(program[0].normalization.gain_db, 6.0);
    assert_eq!(program[1].normalization.gain_db, 7.0);
    assert_eq!(
        catalog::Metadata::from_provider(&metadata, "chain.opus")
            .replay_gain
            .r128_track_gain_q8,
        Some(256)
    );
    let raw = render(chain.clone(), ProcessingMode::Raw);
    let mode = ProcessingMode::Processed {
        replay_gain: settings,
        volume: 0.5,
        mute: false,
    };
    let processed = render(chain.clone(), mode);
    assert_eq!(processed.len(), raw.len());
    let (a, b) = (10.0_f32.powf(6.0 / 20.0), 10.0_f32.powf(7.0 / 20.0));
    for (frame, (input, output)) in raw
        .as_chunks::<2>()
        .0
        .iter()
        .zip(processed.as_chunks::<2>().0)
        .enumerate()
    {
        let gain = if frame < 12006 {
            a
        } else if frame < 12246 {
            a + (b - a) * (frame - 12006 + 1) as f32 / 240.0
        } else {
            b
        };
        for channel in 0..2 {
            assert!(
                (output[channel] - input[channel] * gain * 0.5).abs() < 2e-6,
                "frame {frame}"
            );
        }
    }
    let raw_seek = render_from(chain.clone(), ProcessingMode::Raw, 0.5);
    let processed_seek = render_from(chain, mode, 0.5);
    assert!(raw_seek
        .iter()
        .zip(processed_seek)
        .all(|(a, v)| (a * b * 0.5 - v).abs() < 2e-6));
}
#[test]
fn reference_header_gain_and_optional_r128_are_applied_once_with_raw_master_separation() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/r3/stereo.opus");
    let mut bytes =
        std::fs::read(&path).unwrap_or_else(|_| panic!("generate R3 fixture: {}", path.display()));
    let raw = render(bytes.clone(), ProcessingMode::Raw);
    let at = bytes.windows(8).position(|w| w == b"OpusHead").unwrap();
    bytes[at + 16..at + 18].copy_from_slice(&(-6i16 * 256).to_le_bytes());
    fix_crc(&mut bytes);
    let reduced = render(bytes.clone(), ProcessingMode::Raw);
    assert!(raw
        .iter()
        .zip(&reduced)
        .all(|(a, b)| (a * 10.0_f32.powf(-6.0 / 20.0) - b).abs() < 1e-6));
    // R3 includes R128_TRACK_GAIN=256 and a conflicting ReplayGain tag. At
    // -18 LUFS the optional change is +1+5 dB, exactly cancelling this header.
    let normalized = render(
        bytes.clone(),
        ProcessingMode::Processed {
            replay_gain: ReplayGainSettings {
                mode: ReplayGainMode::Track,
                ..Default::default()
            },
            volume: 1.0,
            mute: false,
        },
    );
    assert_eq!(normalized.len(), raw.len());
    assert!(normalized
        .iter()
        .zip(&raw)
        .all(|(a, b)| (a - b).abs() < 2e-6));
    let half = render(
        bytes.clone(),
        ProcessingMode::Processed {
            replay_gain: ReplayGainSettings {
                mode: ReplayGainMode::Track,
                ..Default::default()
            },
            volume: 0.5,
            mute: false,
        },
    );
    assert!(half
        .iter()
        .zip(&raw)
        .all(|(a, b)| (a - b * 0.5).abs() < 2e-6));
    let muted = render(
        bytes.clone(),
        ProcessingMode::Processed {
            replay_gain: ReplayGainSettings {
                mode: ReplayGainMode::Track,
                ..Default::default()
            },
            volume: 1.0,
            mute: true,
        },
    );
    assert!(muted.iter().all(|v| *v == 0.0));
    assert_eq!(render(bytes, ProcessingMode::Raw), reduced);
}

#[test]
fn callback_primes_new_generations_and_retargets_normalization_without_stereo_or_clock_changes() {
    use libzci_native::pcm_transport::*;
    let (mut tx, mut rx, monitor) = pcm_transport(4, Generation(1));
    let block = |generation, start| OutputBlock {
        generation,
        source_start: start,
        source_end: start + 256,
        source_rate: 48000,
        output_start: start,
        layout: PcmLayout::stereo48k(),
        valid_frames: 256,
    };
    monitor.set_replay_gain(0.5);
    assert_eq!(tx.write(block(Generation(1), 0), &[1.0; 512]), 256);
    let mut output = [0.0; 256];
    assert_eq!(rx.render(&mut output), 128);
    assert_eq!(output, [0.5; 256]);
    monitor.set_replay_gain(2.0);
    rx.render(&mut output);
    assert!(output[0] > 0.5 && output[0] < 0.51);
    let last = output[254];
    monitor.set_replay_gain(0.25);
    assert_eq!(tx.write(block(Generation(1), 256), &[1.0; 512]), 256);
    rx.render(&mut output);
    assert!((last - output[0]).abs() < 0.01);
    assert!(output.as_chunks::<2>().0.iter().all(|v| v[0] == v[1]));
    assert_eq!(monitor.media_position(), Some((Generation(1), 384)));
    monitor.request_generation(Generation(2));
    monitor.set_replay_gain(0.125);
    assert_eq!(tx.write(block(Generation(2), 0), &[1.0; 512]), 256);
    rx.render(&mut output);
    assert_eq!(output, [0.125; 256]);
}
