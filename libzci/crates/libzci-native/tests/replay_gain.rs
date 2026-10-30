//! Real reference-provider samples, no device or full-media production sink.
use libzci::*;
use libzci_native::{render::*, NativeRuntime};
use std::sync::Arc;
fn render(bytes: Vec<u8>, processing: ProcessingMode) -> Vec<f32> {
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
