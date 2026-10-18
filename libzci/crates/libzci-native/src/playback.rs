//! Native output is a mechanism driven by the session's requested transport.
use crate::{
    audio::{open_output, DeviceOutput, OutputSpec, OutputStats},
    pcm_transport::{OutputMonitor, PcmProducer},
    runtime::NativeRuntime,
    session_jobs::{SessionEntry, DECODE_SAMPLES},
};
use libzci::*;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct OutputId(pub u64);
static NEXT_OUTPUT: AtomicU64 = AtomicU64::new(1);
#[derive(Clone, Debug)]
pub struct OutputObservation {
    pub session: SessionId,
    pub requested: RequestedState,
    pub running: RunningState,
    pub rate_hz: u32,
    pub consumed_frames: u64,
    pub decoded_position: u64,
    pub latency_frames: u64,
    pub hungry_pops: u64,
    pub ring_fill_frames: u64,
    pub drained: bool,
    pub finished: bool,
    pub device_label: String,
}
pub(crate) struct OutputEntry {
    session: SessionId,
    device: DeviceOutput,
    stop: CancelFlag,
    drained: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    position: Arc<AtomicU64>,
    thread: Option<std::thread::JoinHandle<()>>,
}
pub(crate) type OutputMap = HashMap<OutputId, OutputEntry>;
impl Drop for OutputEntry {
    fn drop(&mut self) {
        self.stop.cancel();
        self.device.transport.stop();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
impl NativeRuntime {
    /// Attach a device. All transport and master controls use submit().
    pub fn start_output(&self, session: SessionId, spec: &OutputSpec) -> Result<OutputId> {
        let entry = self.entry(session)?;
        {
            let mut c = entry.control.lock().unwrap();
            if c.output_reserved {
                return Err(LibzciError::InvalidArgument {
                    detail: "session already has an output".into(),
                });
            }
            // Reserve the single output before opening a device outside this lock.
            c.output_reserved = true;
        }
        let mut device = match open_output(spec, 0.25) {
            Ok(device) => device,
            Err(e) => {
                let mut c = entry.control.lock().unwrap();
                c.output = None;
                c.output_reserved = false;
                let tag = c.owner.tag();
                c.owner.failed(tag, e.clone());
                return Err(e);
            }
        };
        let producer = device.producer.take().unwrap();
        let transport = device.transport.clone();
        {
            let mut c = entry.control.lock().unwrap();
            if c.closed {
                return Err(LibzciError::Cancelled);
            }
            let s = c.owner.snapshot();
            transport.request_generation(s.generation);
            transport.set_held(true);
            transport.set_volume(s.volume);
            transport.set_mute(s.mute);
            c.output = Some(transport.clone());
            c.owner.output_state(RunningState::Running);
        }
        let stop = CancelFlag::default();
        let token = stop.clone();
        let drained = Arc::new(AtomicBool::new(false));
        let thread_drained = drained.clone();
        let finished = Arc::new(AtomicBool::new(false));
        let thread_finished = finished.clone();
        let position = Arc::new(AtomicU64::new(0));
        let thread_position = position.clone();
        let stats = device.stats.clone();
        let rate = device.rate_hz();
        let thread = std::thread::Builder::new()
            .name(format!("libzci-output-{}", session.0))
            .spawn(move || {
                let result = pipeline_main(
                    &entry,
                    rate,
                    producer,
                    &transport,
                    &token,
                    &thread_drained,
                    &thread_finished,
                    &thread_position,
                    Some(&stats),
                );
                if let Err(error) = result {
                    if !token.is_cancelled() {
                        let mut c = entry.control.lock().unwrap();
                        let tag = c.owner.tag();
                        c.owner.failed(tag, error);
                        c.owner.output_state(RunningState::Failed);
                        transport.set_held(true);
                    }
                }
            })
            .map_err(|e| LibzciError::DeviceUnavailable {
                detail: format!("output worker: {e}"),
            })?;
        let id = OutputId(NEXT_OUTPUT.fetch_add(1, Ordering::Relaxed));
        self.outputs.lock().unwrap().insert(
            id,
            OutputEntry {
                session,
                device,
                stop,
                drained,
                finished,
                position,
                thread: Some(thread),
            },
        );
        Ok(id)
    }
    pub fn output_state(&self, id: OutputId) -> Option<OutputObservation> {
        let outputs = self.outputs.lock().unwrap();
        let e = outputs.get(&id)?;
        let s = self.entry(e.session).ok()?.snapshot();
        Some(OutputObservation {
            session: e.session,
            requested: s.requested,
            running: s.running,
            rate_hz: e.device.rate_hz(),
            consumed_frames: e.device.consumed_frames(),
            decoded_position: e.position.load(Ordering::Relaxed),
            latency_frames: e.device.stats.latency_frames.load(Ordering::Relaxed),
            hungry_pops: e.device.hungry_pops(),
            ring_fill_frames: e.device.transport.len_frames() as u64,
            drained: e.drained.load(Ordering::Acquire),
            finished: e.finished.load(Ordering::Acquire),
            device_label: e.device.device_label.clone(),
        })
    }
    pub fn stop_output(&self, id: OutputId) -> Result<()> {
        let entry = self.outputs.lock().unwrap().remove(&id).ok_or_else(|| {
            LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            }
        })?;
        if let Ok(session) = self.entry(entry.session) {
            let mut c = session.control.lock().unwrap();
            c.output = None;
            c.output_reserved = false;
            c.owner.output_state(RunningState::Closed);
        }
        drop(entry);
        Ok(())
    }
    pub(crate) fn stop_session_outputs(&self, session: SessionId) {
        let ids: Vec<_> = self
            .outputs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, e)| (e.session == session).then_some(*id))
            .collect();
        for id in ids {
            let _ = self.stop_output(id);
        }
    }
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn pipeline_main(
    entry: &Arc<SessionEntry>,
    rate: u32,
    mut producer: PcmProducer,
    transport: &Arc<OutputMonitor>,
    cancel: &CancelFlag,
    drained: &AtomicBool,
    finished: &AtomicBool,
    position: &AtomicU64,
    stats: Option<&OutputStats>,
) -> Result<()> {
    let mut preparation: Option<OutputPreparation> = None;
    let mut last_generation = None;
    loop {
        cancel.check()?;
        if stats.is_some_and(|s| s.failed.load(Ordering::Acquire)) || transport.timing_failed() {
            return Err(LibzciError::DeviceUnavailable {
                detail: "audio device failed or exceeded the bounded timing budget".into(),
            });
        }
        let snap = entry.snapshot();
        if let Some(error) = snap.error {
            return Err(error);
        }
        if entry.control.lock().unwrap().closed {
            return Ok(());
        }
        let generation = snap.generation;
        if last_generation != Some(generation) {
            preparation = None;
            last_generation = Some(generation);
            drained.store(false, Ordering::Release);
            finished.store(false, Ordering::Release);
            position.store(snap.position_frames, Ordering::Relaxed);
        }
        let held = snap.requested == RequestedState::Held
            || snap.pending_operation
            || snap.running == RunningState::Suspended;

        if let Some((gen, media)) = transport.media_position() {
            entry.consumed(gen, media, false);
        }
        if held {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }
        if let Some(p) = &mut preparation {
            let progress = p.pump(|block, samples| producer.write(block, samples));
            if p.is_drained() {
                drained.store(true, Ordering::Release);
                if let Some((ack, media)) = transport.completed_position() {
                    if ack == generation {
                        entry.consumed(generation, media.unwrap_or(snap.position_frames), true);
                        finished.store(true, Ordering::Release);
                    }
                }
            }
            if !p.needs_input() {
                if progress == 0 {
                    std::thread::sleep(Duration::from_millis(2));
                }
                continue;
            }
        }
        if !producer.has_credit() {
            std::thread::sleep(Duration::from_millis(2));
            continue;
        }
        let decoded = entry.decode(cancel)?;
        if decoded.tag.generation != generation
            || !entry.control.lock().unwrap().owner.accepts(decoded.tag)
        {
            continue;
        }
        if preparation.is_none() {
            preparation = Some(OutputPreparation::new(
                decoded.layout,
                rate,
                DECODE_SAMPLES,
                generation,
            )?);
        }
        let p = preparation.as_mut().unwrap();
        match decoded.status {
            DecodeStatus::Data(_) => {
                p.accept(decoded.start, &decoded.samples)?;
                position.store(
                    decoded.start
                        + (decoded.samples.len() / decoded.layout.layout.channels() as usize)
                            as u64,
                    Ordering::Relaxed,
                );
            }
            DecodeStatus::Pending => std::thread::sleep(Duration::from_millis(2)),
            DecodeStatus::EndOfStream => p.finish()?,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcm_transport::pcm_transport;
    use crate::render::*;
    use std::sync::atomic::Ordering;
    use std::time::{Duration, Instant};
    fn until(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while !condition() {
            assert!(Instant::now() < deadline, "transport did not progress");
            std::thread::yield_now();
        }
    }
    fn command(rt: &NativeRuntime, c: Command) {
        rt.submit(&c, &CancelFlag::default()).unwrap();
    }
    #[test]
    fn api_alone_pauses_seeks_stops_and_disposes_a_full_output() {
        let rt = NativeRuntime::new();
        rt.register_provider(Arc::new(provider::FakeFactory::new(
            100_003,
            PcmLayout::mono48k(),
        )))
        .unwrap();
        let session = rt.create_session();
        let source = rt.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
        rt.load(session, source, None, &CancelFlag::default())
            .unwrap();
        let entry = rt.entry(session).unwrap();
        let weak_entry = Arc::downgrade(&entry);
        let (producer, mut consumer, monitor) = pcm_transport(2, entry.snapshot().generation);
        {
            let mut c = entry.control.lock().unwrap();
            c.output = Some(monitor.clone());
            c.refresh_output();
        }
        let cancel = CancelFlag::default();
        let token = cancel.clone();
        let worker_entry = entry.clone();
        let output = monitor.clone();
        let worker = std::thread::spawn(move || {
            pipeline_main(
                &worker_entry,
                48_000,
                producer,
                &output,
                &token,
                &AtomicBool::new(false),
                &AtomicBool::new(false),
                &AtomicU64::new(0),
                None,
            )
        });
        command(
            &rt,
            Command::Play {
                session,
                request_id: RequestId::fresh(),
            },
        );
        until(|| monitor.len_frames() == 512);
        assert_eq!(rt.snapshot(session).unwrap().position_frames, 0); // read-ahead is not audible.
        command(
            &rt,
            Command::Pause {
                session,
                request_id: RequestId::fresh(),
            },
        );
        let mut out = [0.0; 32];
        assert_eq!(consumer.render(&mut out), 0);
        assert_eq!(rt.snapshot(session).unwrap().position_frames, 0);
        command(
            &rt,
            Command::Play {
                session,
                request_id: RequestId::fresh(),
            },
        );
        assert_eq!(consumer.render(&mut out), 16);
        until(|| rt.snapshot(session).unwrap().position_frames == 16);
        // Seek after decode but before consumption. Every old queued block is stale.
        command(
            &rt,
            Command::Seek {
                session,
                request_id: RequestId::fresh(),
                time: MediaTime(1.0),
            },
        );
        consumer.render(&mut out); // acknowledges/discards old output even while seek is pending.
        rt.wait_ready(session, &CancelFlag::default()).unwrap();
        until(|| consumer.render(&mut out) > 0);
        let expected = (48_000f32 / 48_000.0 * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.5;
        assert_eq!(out[0], expected);
        command(
            &rt,
            Command::Stop {
                session,
                request_id: RequestId::fresh(),
            },
        );
        assert_eq!(consumer.render(&mut out), 0);
        assert_eq!(rt.snapshot(session).unwrap().position_frames, 0);
        rt.dispose_session(session);
        cancel.cancel();
        let _ = worker.join().unwrap();
        drop(entry);
        until(|| weak_entry.upgrade().is_none());
    }
    #[test]
    fn production_worker_preserves_long_output_and_tails_through_tiny_pool() {
        for rate in [48_000, 44_100, 96_000] {
            let rt = NativeRuntime::new();
            rt.register_provider(Arc::new(provider::FakeFactory::new(
                50_003,
                PcmLayout::mono48k(),
            )))
            .unwrap();
            let source = rt.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
            let mut reference = rt
                .start_render(
                    source,
                    None,
                    RenderOptions {
                        output_rate: rate,
                        ..Default::default()
                    },
                    &CancelFlag::default(),
                )
                .unwrap();
            let mut expected = Vec::new();
            loop {
                match reference.next().unwrap() {
                    RenderStep::Data { samples, .. } => expected.extend(samples),
                    RenderStep::Pending => (),
                    RenderStep::Complete(_) => break,
                }
            }
            let session = rt.create_session();
            rt.load(session, source, None, &CancelFlag::default())
                .unwrap();
            let entry = rt.entry(session).unwrap();
            let (producer, mut consumer, monitor) = pcm_transport(2, entry.snapshot().generation);
            {
                let mut c = entry.control.lock().unwrap();
                c.output = Some(monitor.clone());
                c.refresh_output();
            }
            let token = CancelFlag::default();
            let cancel = token.clone();
            let e = entry.clone();
            let m = monitor.clone();
            let finished = Arc::new(AtomicBool::new(false));
            let f = finished.clone();
            let worker = std::thread::spawn(move || {
                pipeline_main(
                    &e,
                    rate,
                    producer,
                    &m,
                    &cancel,
                    &AtomicBool::new(false),
                    &f,
                    &AtomicU64::new(0),
                    None,
                )
            });
            command(
                &rt,
                Command::Play {
                    session,
                    request_id: RequestId::fresh(),
                },
            );
            let mut actual = Vec::new();
            let mut scratch = [0.0; 386];
            let mut tick = 0;
            until(|| {
                let n = [0, 1, 7, 193, 0, 11][tick % 6];
                tick += 1;
                let got = consumer.render(&mut scratch[..n * 2]);
                actual.extend_from_slice(&scratch[..got * 2]);
                finished.load(Ordering::Acquire)
            });
            assert_eq!(actual, expected, "worker lost PCM at {rate}");
            assert_eq!(entry.snapshot().state, TransportState::Ended);
            assert_eq!(entry.snapshot().position_frames, 50_003);
            token.cancel();
            let _ = worker.join().unwrap();
        }
    }
}
