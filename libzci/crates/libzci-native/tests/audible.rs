//! Hardware verification is explicit: absence/failure is a failing check.
use libzci::*;
use libzci_codecs::OpusFactory;
use libzci_native::{NativeFileSource, NativeRuntime, OutputSpec};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
fn wait(rt: &NativeRuntime, s: SessionId, condition: impl Fn(&Snapshot) -> bool) -> Snapshot {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snap = rt.snapshot(s).unwrap();
        assert!(snap.error.is_none(), "{:?}", snap.error);
        if condition(&snap) {
            return snap;
        }
        assert!(Instant::now() < deadline, "device deadline: {snap:?}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
#[ignore = "requires authorized hardware output"]
fn audible_api_play_pause_seek_stop_resume_and_final_drain() {
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(OpusFactory::default()))
        .unwrap();
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.local/libzci/media/r3/long.opus");
    let source = rt.insert_source(Arc::new(NativeFileSource::open(&path).unwrap()));
    let session = rt.create_session();
    let cancel = CancelFlag::default();
    rt.load(session, source, Some("opus"), &cancel).unwrap();
    let submit = |c: Command| rt.submit(&c, &cancel).unwrap();
    submit(Command::SetVolume {
        session,
        request_id: RequestId::fresh(),
        volume: 0.0,
    });
    let output = rt
        .start_output(session, &OutputSpec::default())
        .expect("hardware output required");
    submit(Command::Play {
        session,
        request_id: RequestId::fresh(),
    });
    wait(&rt, session, |s| s.position_frames > 4800);
    submit(Command::Pause {
        session,
        request_id: RequestId::fresh(),
    });
    let paused = rt.snapshot(session).unwrap().position_frames;
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(rt.snapshot(session).unwrap().position_frames, paused);
    submit(Command::Seek {
        session,
        request_id: RequestId::fresh(),
        time: MediaTime(10.0),
    });
    assert_eq!(
        rt.wait_ready(session, &cancel).unwrap().position_frames,
        480_000
    );
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(rt.snapshot(session).unwrap().position_frames, 480_000);
    submit(Command::Play {
        session,
        request_id: RequestId::fresh(),
    });
    wait(&rt, session, |s| s.position_frames > 484_800);
    submit(Command::SetMute {
        session,
        request_id: RequestId::fresh(),
        mute: true,
    });
    submit(Command::SetMute {
        session,
        request_id: RequestId::fresh(),
        mute: false,
    });
    submit(Command::Stop {
        session,
        request_id: RequestId::fresh(),
    });
    assert_eq!(rt.wait_ready(session, &cancel).unwrap().position_frames, 0);
    submit(Command::Seek {
        session,
        request_id: RequestId::fresh(),
        time: MediaTime(29.0),
    });
    rt.wait_ready(session, &cancel).unwrap();
    submit(Command::Play {
        session,
        request_id: RequestId::fresh(),
    });
    let ended = wait(&rt, session, |s| s.state == TransportState::Ended);
    assert_eq!(ended.position_frames, 1_440_006);
    let state = rt.output_state(output).unwrap();
    assert!(state.finished);
    assert!(state.drained);
    eprintln!(
        "hardware {state:?}; final media frame {}",
        ended.position_frames
    );
    rt.dispose_session(session);
    assert!(rt.output_state(output).is_none());
}
