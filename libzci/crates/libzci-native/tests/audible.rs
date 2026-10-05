//! Audible output smoke: real device consumption when present,
//! typed unavailability otherwise. Plays the short Opus fixture at low
//! volume; asserts consumed frames advance, pause halts consumption,
//! and EOF drains to finished.

use std::sync::Arc;
use std::time::{Duration, Instant};

use libzci::{CancelFlag, Command, MemSource, RequestId};
use libzci_codecs::OpusFactory;
use libzci_native::{NativeRuntime, OutputSpec};

fn fixture(rel: &str) -> Vec<u8> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/verification-fixtures/v1")
        .join(rel);
    std::fs::read(&path)
        .unwrap_or_else(|_| panic!("missing fixture {} — run `node fixtures/generate.mjs` first", path.display()))
}

#[test]
fn audible_play_pause_eof() {
    let runtime = NativeRuntime::new();
    runtime.register_provider(Arc::new(OpusFactory::default())).unwrap();
    let session = runtime.create_session();
    let source = runtime.insert_source(Arc::new(MemSource::new(fixture("media/audio/tone.opus"))));
    let cancel = CancelFlag::default();
    runtime.load(session, source, Some("opus"), &cancel).unwrap();
    runtime
        .submit(
            &Command::Play { request_id: RequestId::fresh(), session },
            &cancel,
        )
        .unwrap();

    let id = match runtime.start_output(session, &OutputSpec::default(), 0.15) {
        Ok(id) => id,
        Err(e) => {
            assert_eq!(e.kind(), "device-unavailable");
            eprintln!("audible smoke skipped (no device): {e}");
            return;
        }
    };

    // Wait for real consumption.
    let start = Instant::now();
    loop {
        let state = runtime.output_state(id).expect("output alive");
        if state.consumed_frames > 1_000 || start.elapsed() > Duration::from_secs(10) {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let before_pause = runtime.output_state(id).unwrap().consumed_frames;
    assert!(before_pause > 0, "device consumed audible frames");

    // Pause halts consumption.
    runtime.pause_output(id).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    let during_pause = runtime.output_state(id).unwrap().consumed_frames;
    assert_eq!(before_pause, during_pause, "paused device holds its clock");

    // Resume drains to EOF and finishes.
    runtime.resume_output(id).unwrap();
    let start = Instant::now();
    let finished = loop {
        let state = runtime.output_state(id).unwrap();
        if state.finished || start.elapsed() > Duration::from_secs(15) {
            break state.finished;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let final_state = runtime.output_state(id).unwrap();
    eprintln!(
        "audible smoke: device={} rate={} consumed={} hungry={} drained={} finished={}",
        final_state.device_label,
        final_state.rate_hz,
        final_state.consumed_frames,
        final_state.hungry_pops,
        final_state.drained,
        final_state.finished
    );
    runtime.stop_output(id).unwrap();
    assert!(finished, "short fixture drains to finished");
    assert!(final_state.consumed_frames >= 12_000, "consumed covers the audible total");
}
