//! Public API integration: real codecs, independent jobs and control generations.
use libzci::*;
use libzci_native::{render::*, *};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
fn runtime() -> Arc<NativeRuntime> {
    let r = NativeRuntime::new();
    r.register_provider(Arc::new(libzci_codecs::OpusFactory::default()))
        .unwrap();
    r.register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
        .unwrap();
    r.register_provider(Arc::new(libzci_codecs::OpenmptFactory::default()))
        .unwrap();
    r.register_provider(Arc::new(libzci_codecs::HivelyFactory::default()))
        .unwrap();
    r
}
fn source(r: &NativeRuntime, name: &str) -> SourceId {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/m1")
        .join(name);
    r.insert_source(Arc::new(NativeFileSource::open(&p).unwrap()))
}
fn load(r: &NativeRuntime, s: SessionId, source: SourceId, hint: &str) -> Snapshot {
    r.submit(
        &Command::Load {
            session: s,
            source,
            request_id: RequestId::fresh(),
            extension_hint: Some(hint.into()),
            options: LoadOptions::default(),
        },
        &CancelFlag::default(),
    )
    .unwrap();
    r.wait_ready(s, &CancelFlag::default()).unwrap()
}
fn render(r: &Arc<NativeRuntime>, source: SourceId, hint: &str, start: f64) -> Vec<f32> {
    let mut job = r
        .start_render(
            source,
            Some(hint),
            RenderOptions {
                load: LoadOptions {
                    start_time: MediaTime(start),
                    ..Default::default()
                },
                ..Default::default()
            },
            &CancelFlag::default(),
        )
        .unwrap();
    let mut all = Vec::new();
    loop {
        match job.next().unwrap() {
            RenderStep::Data { samples, .. } => all.extend(samples),
            RenderStep::Pending => (),
            RenderStep::Complete(n) => {
                assert_eq!(all.len() as u64, n.output_frames * 2);
                break;
            }
        }
        assert!(job.progress().retained_bytes < 256 * 1024);
        assert!(all.len() < 2_000_000);
    }
    all
}
#[test]
fn audible_formats_public_seek_eof_probe_and_instance_isolation() {
    let r = runtime();
    let session = r.create_session();
    let cancel = CancelFlag::default();
    for ext in ["mod", "xm", "s3m", "it", "mo3", "ahx", "hvl"] {
        let source = source(&r, &format!("tone.{ext}"));
        let opened = load(&r, session, source, ext);
        assert!(opened
            .module
            .as_ref()
            .is_some_and(|m| m.rows > 0 && !m.cells.is_empty()));
        assert!(opened
            .metadata
            .as_ref()
            .unwrap()
            .comments
            .iter()
            .any(|(k, v)| k == "title" && v.contains("M1")));
        let job = r.start_probe(source, Some(ext), false, &cancel).unwrap();
        let full = render(&r, source, ext, 0.);
        assert!(full.iter().any(|s| s.abs() > 0.05), "{ext} silent");
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(i) = job.poll() {
                assert_eq!(i.unwrap().metadata.total_frames, opened.total_frames);
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert_eq!(
            r.snapshot(session).unwrap().generation,
            opened.generation,
            "probe/render changed playback"
        );
        for t in [0.0, 0.373, opened.total_frames.unwrap() as f64 / 48000.0] {
            r.submit(
                &Command::Seek {
                    session,
                    request_id: RequestId::fresh(),
                    time: MediaTime(t),
                },
                &cancel,
            )
            .unwrap();
            let landed = r.wait_ready(session, &cancel).unwrap();
            assert!(landed.position_frames <= opened.total_frames.unwrap());
            let tail = render(&r, source, ext, t);
            assert!(tail.len() <= full.len());
            if ext == "ahx" || ext == "hvl" {
                assert_eq!(
                    tail,
                    &full[(t * 48000.).round() as usize * 2..],
                    "{ext} exact seek suffix"
                );
            }
        }
        for control in [
            ModuleControl::Interpolation(2),
            ModuleControl::ChannelMute {
                channel: 0,
                mute: true,
            },
            ModuleControl::Subsong(0),
        ] {
            r.submit(
                &Command::Module {
                    session,
                    request_id: RequestId::fresh(),
                    control,
                },
                &cancel,
            )
            .unwrap();
            r.wait_ready(session, &cancel).unwrap();
        }
        let s = r.snapshot(session).unwrap();
        let invalid = r
            .submit(
                &Command::Module {
                    session,
                    request_id: RequestId::fresh(),
                    control: ModuleControl::Subsong(9999),
                },
                &cancel,
            )
            .unwrap_err();
        assert_eq!(invalid.kind(), "invalid-argument");
        assert_eq!(r.snapshot(session).unwrap().generation, s.generation);
        if s.capabilities.speed {
            for control in [
                ModuleControl::Ramping(4),
                ModuleControl::Speed(1.5),
                ModuleControl::Pitch(0.75),
                ModuleControl::LoopLimit(1),
            ] {
                r.submit(
                    &Command::Module {
                        session,
                        request_id: RequestId::fresh(),
                        control,
                    },
                    &cancel,
                )
                .unwrap();
                r.wait_ready(session, &cancel).unwrap();
            }
        }
        r.release_source(source);
    }
    r.dispose_session(session);
}
#[test]
fn unknown_verification_policy_is_separate_from_playback_and_cancel_is_typed() {
    let r = runtime();
    let src = source(&r, "tone.mod");
    let cancel = CancelFlag::default();
    let p = r.start_probe(src, Some("unknown"), false, &cancel).unwrap();
    loop {
        if let Some(result) = p.poll() {
            assert_eq!(result.unwrap_err().kind(), "unsupported");
            break;
        }
        std::thread::yield_now();
    }
    let p = r.start_probe(src, Some("unknown"), true, &cancel).unwrap();
    loop {
        if let Some(result) = p.poll() {
            assert_eq!(result.unwrap().metadata.info.id, ProviderId::OPENMPT);
            break;
        }
        std::thread::yield_now();
    }
    let mut render = r
        .start_render(src, Some("mod"), RenderOptions::default(), &cancel)
        .unwrap();
    render.cancel();
    assert_eq!(render.next().err().unwrap(), LibzciError::Cancelled);
    assert_eq!(
        r.start_probe(SourceId(0), None, true, &cancel)
            .err()
            .unwrap()
            .kind(),
        "unavailable"
    );
}
