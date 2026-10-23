//! Deterministic job/transport race checks, with held work off the control path.
use libzci::*;
use libzci_native::NativeRuntime;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Arc, Mutex,
};
use std::time::{Duration, Instant};

struct Gate {
    entered: mpsc::Sender<()>,
    release: Mutex<mpsc::Receiver<()>>,
}
impl Gate {
    fn hold(&self) {
        self.entered.send(()).unwrap();
        self.release.lock().unwrap().recv().unwrap();
    }
}
fn gate() -> (Arc<Gate>, mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (et, er) = mpsc::channel();
    let (rt, rr) = mpsc::channel();
    (
        Arc::new(Gate {
            entered: et,
            release: Mutex::new(rr),
        }),
        er,
        rt,
    )
}
struct Factory {
    open: Option<Arc<Gate>>,
    decode: Option<Arc<Gate>>,
    seek: Option<Arc<Gate>>,
    pending: Arc<AtomicBool>,
}
struct Decoder {
    inner: Box<dyn DecoderInstance>,
    gate: Option<Arc<Gate>>,
    seek: Option<Arc<Gate>>,
    pending: Arc<AtomicBool>,
}
impl ProviderFactory for Factory {
    fn info(&self) -> ProviderInfo {
        provider::FakeFactory::new(1, PcmLayout::mono48k()).info()
    }
    fn probe(&self, _: &ProbeInput<'_>) -> ProbeScore {
        ProbeScore::Magic
    }
    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        let mut byte = [0];
        source.read_at(0, &mut byte, cancel)?;
        let gated = byte[0] == b'A';
        if gated {
            if let Some(g) = &self.open {
                g.hold();
            }
        }
        cancel.check()?;
        Ok(Box::new(Decoder {
            inner: provider::FakeFactory::new(100_003, PcmLayout::mono48k())
                .open(source, cancel)?,
            gate: if gated { self.decode.clone() } else { None },
            seek: if gated { self.seek.clone() } else { None },
            pending: self.pending.clone(),
        }))
    }
}
impl DecoderInstance for Decoder {
    fn capabilities(&self) -> ModuleCapabilities {
        ModuleCapabilities {
            subsongs: 2,
            interpolation: true,
            channel_mute: true,
            channels: 4,
            ..Default::default()
        }
    }
    fn module_control(&mut self, control: ModuleControl, cancel: &CancelFlag) -> Result<()> {
        cancel.check()?;
        match control {
            ModuleControl::Subsong(n) if n < 2 => {
                self.inner.seek_to_frame(0, cancel)?;
            }
            ModuleControl::Interpolation(n) if [1, 2, 4].contains(&n) => (),
            ModuleControl::ChannelMute { channel, .. } if channel < 4 => (),
            _ => {
                return Err(LibzciError::InvalidArgument {
                    detail: "unsupported fake module parameter".into(),
                })
            }
        }
        Ok(())
    }
    fn info(&self) -> ProviderInfo {
        self.inner.info()
    }
    fn layout(&self) -> PcmLayout {
        self.inner.layout()
    }
    fn total_frames(&self) -> Option<u64> {
        self.inner.total_frames()
    }
    fn position_frames(&self) -> u64 {
        self.inner.position_frames()
    }
    fn metadata(&self) -> ProviderMetadata {
        self.inner.metadata()
    }
    fn decode(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<DecodeStatus> {
        if self.pending.load(Ordering::Acquire) {
            return Ok(DecodeStatus::Pending);
        }
        match self.decode_into(out, cancel)? {
            0 => Ok(DecodeStatus::EndOfStream),
            n => Ok(DecodeStatus::Data(n)),
        }
    }
    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        if let Some(g) = self.gate.take() {
            g.hold();
        }
        self.inner.decode_into(out, cancel)
    }
    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        if frame > 0 {
            if let Some(g) = self.seek.take() {
                g.hold();
            }
        }
        self.inner.seek_to_frame(frame, cancel)
    }
}
fn load(rt: &NativeRuntime, s: SessionId, source: SourceId) {
    rt.submit(
        &Command::Load {
            session: s,
            request_id: RequestId::fresh(),
            source,
            options: LoadOptions::default(),
            extension_hint: None,
        },
        &CancelFlag::default(),
    )
    .unwrap();
}
fn seek(rt: &NativeRuntime, s: SessionId, seconds: f64) {
    rt.submit(
        &Command::Seek {
            session: s,
            request_id: RequestId::fresh(),
            time: MediaTime(seconds),
        },
        &CancelFlag::default(),
    )
    .unwrap();
}
#[test]
fn held_open_accepts_stop_new_load_and_dispose_without_global_lock() {
    let (g, entered, release) = gate();
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(Factory {
        open: Some(g),
        decode: None,
        seek: None,
        pending: Default::default(),
    }))
    .unwrap();
    let a = rt.create_session();
    let b = rt.create_session();
    let sa = rt.insert_source(Arc::new(MemSource::new(b"A".to_vec())));
    let sb = rt.insert_source(Arc::new(MemSource::new(b"B".to_vec())));
    load(&rt, a, sa);
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    load(&rt, b, sb);
    rt.wait_ready(b, &CancelFlag::default()).unwrap();
    let before = Instant::now();
    seek(&rt, a, 0.1);
    seek(&rt, a, 0.2);
    rt.submit(
        &Command::Stop {
            session: a,
            request_id: RequestId::fresh(),
        },
        &CancelFlag::default(),
    )
    .unwrap();
    load(&rt, a, sb);
    rt.dispose_session(a);
    assert!(before.elapsed() < Duration::from_millis(100));
    assert!(rt.snapshot(a).is_err());
    release.send(()).unwrap();
    rt.dispose_session(b);
}
#[test]
fn held_seek_cannot_commit_after_rapid_seek_and_new_load() {
    let (g, entered, release) = gate();
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(Factory {
        open: None,
        decode: None,
        seek: Some(g),
        pending: Default::default(),
    }))
    .unwrap();
    let a = rt.create_session();
    let sa = rt.insert_source(Arc::new(MemSource::new(b"A".to_vec())));
    let sb = rt.insert_source(Arc::new(MemSource::new(b"B".to_vec())));
    load(&rt, a, sa);
    rt.wait_ready(a, &CancelFlag::default()).unwrap();
    seek(&rt, a, 0.1);
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    seek(&rt, a, 0.2);
    load(&rt, a, sb);
    release.send(()).unwrap();
    let s = rt.wait_ready(a, &CancelFlag::default()).unwrap();
    assert_eq!(s.position_frames, 0);
    assert_eq!(s.error, None);
}
#[test]
fn held_decode_cancels_render_promptly_and_drops_late_pcm() {
    let (g, entered, release) = gate();
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(Factory {
        open: None,
        decode: Some(g),
        seek: None,
        pending: Default::default(),
    }))
    .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"A".to_vec())));
    let cancel = CancelFlag::default();
    let mut job = rt
        .start_render(source, None, Default::default(), &cancel)
        .unwrap();
    let (done_tx, done_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let r = job.next_step();
        drop(job);
        done_tx
            .send(matches!(r, Err(LibzciError::Cancelled)))
            .unwrap();
    });
    entered.recv_timeout(Duration::from_secs(2)).unwrap();
    cancel.cancel();
    assert!(done_rx.recv_timeout(Duration::from_millis(100)).unwrap());
    handle.join().unwrap();
    release.send(()).unwrap();
}
#[test]
fn starvation_is_pending_then_data_and_final_completion() {
    let pending = Arc::new(AtomicBool::new(true));
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(Factory {
        open: None,
        decode: None,
        seek: None,
        pending: pending.clone(),
    }))
    .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"B".to_vec())));
    let mut job = rt
        .start_render(source, None, Default::default(), &CancelFlag::default())
        .unwrap();
    assert!(matches!(
        job.next_step().unwrap(),
        libzci_native::render::RenderStep::Pending
    ));
    assert_eq!(job.progress().output_frames, 0);
    pending.store(false, Ordering::Release);
    let mut frames = 0;
    loop {
        match job.next_step().unwrap() {
            libzci_native::render::RenderStep::Data { block, .. } => frames += block.valid_frames,
            libzci_native::render::RenderStep::Pending => (),
            libzci_native::render::RenderStep::Complete(_) => break,
        }
    }
    assert_eq!(frames, 100_003);
}
#[test]
fn duplicate_old_load_does_not_cancel_a_new_timeline_even_after_source_release() {
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(libzci::provider::FakeFactory::new(
        100003,
        PcmLayout::mono48k(),
    )))
    .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
    let session = rt.create_session();
    let load = Command::Load {
        session,
        request_id: RequestId::fresh(),
        source,
        extension_hint: None,
        options: LoadOptions::default(),
    };
    let first = rt.submit(&load, &CancelFlag::default()).unwrap().0;
    rt.wait_ready(session, &CancelFlag::default()).unwrap();
    seek(&rt, session, 1.0);
    let later = rt.wait_ready(session, &CancelFlag::default()).unwrap();
    rt.release_source(source);
    assert_eq!(rt.submit(&load, &CancelFlag::default()).unwrap().0, first);
    let after = rt.snapshot(session).unwrap();
    assert_eq!(after.generation, later.generation);
    assert_eq!(after.position_frames, 48000);
    assert!(after.error.is_none());
}
#[test]
fn public_load_options_module_capabilities_and_controls() {
    let rt = NativeRuntime::new();
    rt.register_provider(Arc::new(Factory {
        open: None,
        decode: None,
        seek: None,
        pending: Default::default(),
    }))
    .unwrap();
    let source = rt.insert_source(Arc::new(MemSource::new(b"B".to_vec())));
    let session = rt.create_session();
    let cancel = CancelFlag::default();
    rt.submit(
        &Command::Load {
            session,
            request_id: RequestId::fresh(),
            source,
            extension_hint: None,
            options: LoadOptions {
                subsong: Some(1),
                start_time: MediaTime(0.5),
            },
        },
        &cancel,
    )
    .unwrap();
    let s = rt.wait_ready(session, &cancel).unwrap();
    assert_eq!(s.position_frames, 24000);
    assert_eq!(s.capabilities.subsongs, 2);
    for control in [
        ModuleControl::Subsong(0),
        ModuleControl::Interpolation(4),
        ModuleControl::ChannelMute {
            channel: 1,
            mute: true,
        },
    ] {
        rt.submit(
            &Command::Module {
                session,
                request_id: RequestId::fresh(),
                control,
            },
            &cancel,
        )
        .unwrap();
        rt.wait_ready(session, &cancel).unwrap();
    }
    assert_eq!(rt.snapshot(session).unwrap().position_frames, 0);
    let error = rt
        .submit(
            &Command::Module {
                session,
                request_id: RequestId::fresh(),
                control: ModuleControl::Interpolation(99),
            },
            &cancel,
        )
        .unwrap_err();
    assert!(matches!(error, LibzciError::InvalidArgument { .. }));
    assert!(rt.snapshot(session).unwrap().error.is_none());
}
#[test]
fn bounded_event_overflow_is_visible_and_recovers_with_snapshot() {
    let rt = NativeRuntime::new();
    let session = rt.create_session();
    for _ in 0..200 {
        rt.submit(
            &Command::SetVolume {
                session,
                request_id: RequestId::fresh(),
                volume: 0.5,
            },
            &CancelFlag::default(),
        )
        .unwrap();
    }
    let batch = rt.events(session).unwrap();
    assert!(batch.events.len() <= 128);
    assert!(batch.dropped > 0);
    assert_eq!(batch.snapshot.volume, 0.5);
    assert_eq!(
        batch.snapshot.revision,
        rt.snapshot(session).unwrap().revision
    );
    let next = rt.events(session).unwrap();
    assert_eq!(next.dropped, 0);
    assert!(next.events.is_empty());
}
