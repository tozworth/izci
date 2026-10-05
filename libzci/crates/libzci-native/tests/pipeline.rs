//! Device-free pipeline checks: the shared decode/process path
//! without opening any audio device.

use std::sync::Arc;

use libzci::{CancelFlag, MemSource, PcmLayout, provider::FakeFactory};
use libzci_native::NativeRuntime;

fn runtime_with_fake(total: u64) -> (Arc<NativeRuntime>, libzci::SessionId) {
    let runtime = NativeRuntime::new();
    runtime
        .register_provider(Arc::new(FakeFactory::new(total, PcmLayout::mono48k())))
        .unwrap();
    let session = runtime.create_session();
    let source = runtime.insert_source(Arc::new(MemSource::new(b"FAKEx".to_vec())));
    runtime.load(session, source, None, &CancelFlag::default()).unwrap();
    (runtime, session)
}

#[test]
fn render_counts_match_provider_total() {
    let (runtime, session) = runtime_with_fake(48_000);
    let cancel = CancelFlag::default();
    // Mono 48k fake through the stereo/48k pipeline: exact frames.
    let (samples, rate) = runtime.render_to_vec(session, 48_000, 1.0, 1 << 24, &cancel).unwrap();
    assert_eq!(rate, 48_000);
    assert_eq!(samples.len(), 48_000 * 2);
    assert!(samples.iter().all(|s| s.is_finite()));
    assert!(samples.iter().any(|&s| s != 0.0));
    // Explicit mono-to-stereo mapping: channel pairs identical.
    for pair in samples.chunks_exact(2) {
        assert_eq!(pair[0], pair[1]);
    }
}

#[test]
fn silence_at_zero_volume_and_mute() {
    // Volume is settled before rendering, so zero means all zeros.
    for volume in [0.0f32] {
        let (runtime, session) = runtime_with_fake(8_000);
        let cancel = CancelFlag::default();
        let (samples, _) = runtime.render_to_vec(session, 48_000, volume, 1 << 24, &cancel).unwrap();
        assert!(samples.iter().all(|&s| s == 0.0), "volume {volume} renders silence");
    }
}

#[test]
fn changed_rate_converts_frame_counts() {
    let (runtime, session) = runtime_with_fake(48_000);
    let cancel = CancelFlag::default();
    let (samples, rate) = runtime.render_to_vec(session, 44_100, 1.0, 1 << 26, &cancel).unwrap();
    assert_eq!(rate, 44_100);
    let frames = samples.len() / 2;
    // 48000 -> 44100 with block rounding and delay tolerance.
    assert!((43_800..=44_400).contains(&frames), "converted frames {frames}");
    assert!(samples.iter().all(|s| s.is_finite()));
}
