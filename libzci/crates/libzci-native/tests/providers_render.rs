//! Real-provider device-free renders: Opus/MOD fixtures through the
//! shared pipeline with exact audible counts.

use std::sync::Arc;

use libzci::{CancelFlag, MemSource};
use libzci_codecs::{HivelyFactory, OpenmptFactory, OpusFactory};
use libzci_native::NativeRuntime;

fn fixture(rel: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/verification-fixtures/v1")
        .join(rel);
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("missing fixture {} — run `node fixtures/generate.mjs` first", path.display()))
}

fn load_bytes(runtime: &Arc<NativeRuntime>, bytes: Vec<u8>, hint: Option<&str>) -> libzci::SessionId {
    let session = runtime.create_session();
    let source = runtime.insert_source(Arc::new(MemSource::new(bytes)));
    runtime.load(session, source, hint, &CancelFlag::default()).unwrap();
    session
}

#[test]
fn opus_renders_exact_audible_total() {
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpusFactory::default())).unwrap();
    let session = load_bytes(&runtime, fixture("media/audio/tone.opus"), Some("opus"));
    let cancel = CancelFlag::default();
    let (samples, rate) = runtime.render_to_vec(session, 48_000, 1.0, 1 << 24, &cancel).unwrap();
    assert_eq!(rate, 48_000);
    // Mono source upmixed: exactly 12000 stereo frames.
    assert_eq!(samples.len(), 12_000 * 2);
    assert!(samples.iter().all(|s| s.is_finite()));
    assert!(samples.iter().any(|&s| s != 0.0));
    for pair in samples.chunks_exact(2) {
        assert_eq!(pair[0], pair[1]);
    }
}

#[test]
fn mod_renders_exact_audible_total() {
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpenmptFactory::default())).unwrap();
    let session = load_bytes(&runtime, fixture("media/modules/tone.mod"), Some("mod"));
    let cancel = CancelFlag::default();
    let (samples, _) = runtime.render_to_vec(session, 48_000, 1.0, 1 << 26, &cancel).unwrap();
    assert_eq!(samples.len(), 368_640 * 2);
    assert!(samples.iter().all(|s| s.is_finite()));
    assert!(samples.iter().any(|&s| s != 0.0));
}

#[test]
fn opus_renders_converted_rate() {
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpusFactory::default())).unwrap();
    let session = load_bytes(&runtime, fixture("media/audio/tone.opus"), Some("opus"));
    let cancel = CancelFlag::default();
    let (samples, rate) = runtime.render_to_vec(session, 44_100, 1.0, 1 << 24, &cancel).unwrap();
    assert_eq!(rate, 44_100);
    let frames = samples.len() / 2;
    assert!((10_800..=11_300).contains(&frames), "converted frames {frames}");
}

#[test]
fn hively_lifecycle_renders_to_eof() {
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(HivelyFactory::default())).unwrap();
    // Blank AHX bytes: same construction as the codec tests.
    let header_length = 14usize;
    let names_offset = header_length + 8;
    let mut module = vec![0u8; names_offset + 5];
    module[..3].copy_from_slice(b"THX");
    module[3] = 1;
    module[4] = (names_offset >> 8) as u8;
    module[5] = (names_offset & 0xff) as u8;
    module[6] = 0x80;
    module[7] = 1;
    module[10] = 1;
    module[names_offset..names_offset + 4].copy_from_slice(b"End\0");
    let session = load_bytes(&runtime, module, Some("ahx"));
    let cancel = CancelFlag::default();
    let (samples, _) = runtime.render_to_vec(session, 48_000, 1.0, 1 << 26, &cancel).unwrap();
    assert!(!samples.is_empty());
    assert!(samples.iter().all(|s| s.is_finite()));
}
