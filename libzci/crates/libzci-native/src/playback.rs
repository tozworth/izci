//! Native playback pipeline: decode, process, resample, feed.
//!
//! One worker thread per output pulls the core session through the
//! public decode path and prepares bounded stereo PCM at the device rate.
//! The callback consumes fixed-pool blocks and applies the shared master stage.
//!
//! Generation discipline: the worker watches the session generation.
//! Any change (seek/stop/load) requests a consumer-owned generation switch
//! and drops stale preparation. The worker never changes consumer cursors.
//! Pause holds decode and pauses the device stream; buffered audio
//! resumes seamlessly because nothing changed underneath it.

use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

use libzci::{
    AudioProcessor, CancelFlag, ChannelLayout, Generation, LibzciError, OutputPreparation,
    PcmLayout, RateConverter, RequestedState, Result, RunningState, SessionId,
};

use crate::audio::{open_output, DeviceOutput, OutputSpec};
use crate::pcm_transport::{OutputMonitor, PcmProducer};
use crate::runtime::NativeRuntime;

/// Opaque output handle.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct OutputId(pub u64);

static NEXT_OUTPUT: AtomicU64 = AtomicU64::new(1);

/// Volume/mute control shared with the pipeline thread.
struct OutputControls {
    transport: Arc<OutputMonitor>,
    paused: AtomicBool,
    stop: AtomicBool,
}

/// Point-in-time output observation (requested vs running distinct).
#[derive(Clone, Debug)]
pub struct OutputObservation {
    /// Session feeding this output.
    pub session: SessionId,
    /// What was last requested.
    pub requested: RequestedState,
    /// What the device reports.
    pub running: RunningState,
    /// Device rate in Hz.
    pub rate_hz: u32,
    /// Device frames consumed (audible clock).
    pub consumed_frames: u64,
    /// Provider-timeline frames decoded into the pipeline.
    pub decoded_position: u64,
    /// Estimated latency in device frames.
    pub latency_frames: u64,
    /// Ring-empty pops (silence rendered).
    pub hungry_pops: u64,
    /// Ring fill in device frames.
    pub ring_fill_frames: u64,
    /// `true` after decoder EOF fully drained into the ring.
    pub drained: bool,
    /// `true` after drained audio fully played.
    pub finished: bool,
    /// Device label for diagnostics.
    pub device_label: String,
}

pub(crate) struct OutputEntry {
    session: SessionId,
    device: Arc<Mutex<Option<DeviceOutput>>>,
    controls: Arc<OutputControls>,
    drained: Arc<AtomicBool>,
    finished: Arc<AtomicBool>,
    decoded_position: Arc<AtomicU64>,
    thread: Option<std::thread::JoinHandle<()>>,
}

/// Session-chunk decode plus generation access for the pipeline.
/// Implemented here to keep device threading out of `runtime.rs`.
impl NativeRuntime {
    /// Current generation of a session (fence watch).
    pub(crate) fn session_generation(&self, session: SessionId) -> Generation {
        self.sessions
            .lock()
            .unwrap()
            .get(&session)
            .map(|cell| cell.lock().unwrap().generation())
            .unwrap_or(Generation::INITIAL)
    }

    /// Decode one chunk from a session through the public runtime path.
    /// Returns generation, full layout/rate, source origin, frames, EOF together.
    pub(crate) fn decode_session_chunk(
        &self,
        session: SessionId,
        buf: &mut [f32],
        cancel: &CancelFlag,
    ) -> Result<(Generation, PcmLayout, u64, usize, bool)> {
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions
            .get(&session)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown session".into(),
            })?;
        let mut sess = cell.lock().unwrap();
        let (generation, chunk) = sess.decode_for_generation(buf.len(), cancel)?;
        let layout = chunk.layout;
        let n = chunk.frames.len().min(buf.len());
        buf[..n].copy_from_slice(&chunk.frames[..n]);
        let eof = chunk.frame_count() == 0;
        let channels = layout.layout.channels() as usize;
        Ok((
            generation,
            layout,
            chunk.start_frame,
            n / channels.max(1),
            eof,
        ))
    }
}

/// Decode chunk size in samples (stereo interleaved).
const DECODE_SAMPLES: usize = 4096;

impl NativeRuntime {
    /// Start audible output for a loaded session. Returns the output id.
    /// The session should be `Playing` (requested); the observation
    /// reports whether the device is actually running.
    pub fn start_output(
        self: &Arc<Self>,
        session: SessionId,
        spec: &OutputSpec,
        volume: f32,
    ) -> Result<OutputId> {
        let mut device = open_output(spec, 2.0)?;
        let rate_hz = device.rate_hz();
        let producer = device.producer.take().expect("unique output producer");
        let transport = Arc::clone(&device.transport);
        transport.set_volume(volume);
        let device = Arc::new(Mutex::new(Some(device)));
        let controls = Arc::new(OutputControls {
            transport,
            paused: AtomicBool::new(false),
            stop: AtomicBool::new(false),
        });
        let drained = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let decoded_position = Arc::new(AtomicU64::new(0));
        let runtime = Arc::clone(self);
        let thread_controls = Arc::clone(&controls);
        let thread_device = Arc::clone(&device);
        let thread_drained = Arc::clone(&drained);
        let thread_finished = Arc::clone(&finished);
        let thread_position = Arc::clone(&decoded_position);
        let thread = std::thread::Builder::new()
            .name(format!("libzci-output-{session:?}"))
            .spawn(move || {
                let _keep_device = thread_device;
                pipeline_main(
                    &runtime,
                    session,
                    rate_hz,
                    producer,
                    &thread_controls,
                    &thread_drained,
                    &thread_finished,
                    &thread_position,
                );
            })
            .map_err(|e| LibzciError::DeviceUnavailable {
                detail: format!("cannot spawn output thread: {e}"),
            })?;
        let id = OutputId(NEXT_OUTPUT.fetch_add(1, Ordering::Relaxed));
        self.outputs.lock().unwrap().insert(
            id,
            OutputEntry {
                session,
                device,
                controls,
                drained,
                finished,
                decoded_position,
                thread: Some(thread),
            },
        );
        Ok(id)
    }

    /// Observe one output (requested vs running, clock, underruns).
    pub fn output_state(&self, id: OutputId) -> Option<OutputObservation> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs.get(&id)?;
        let guard = entry.device.lock().unwrap();
        let device = guard.as_ref()?;
        let requested = if entry.controls.paused.load(Ordering::Relaxed) {
            RequestedState::Held
        } else {
            RequestedState::Running
        };
        Some(OutputObservation {
            session: entry.session,
            requested,
            running: RunningState::Running,
            rate_hz: device.rate_hz(),
            consumed_frames: device.consumed_frames(),
            decoded_position: entry.decoded_position.load(Ordering::Relaxed),
            latency_frames: device.latency_frames,
            hungry_pops: device.hungry_pops(),
            ring_fill_frames: device.transport.len_frames() as u64,
            drained: entry.drained.load(Ordering::Relaxed),
            finished: entry.finished.load(Ordering::Relaxed),
            device_label: device.device_label.clone(),
        })
    }

    /// Set master volume (smoothed by the callback, independent of read-ahead).
    pub fn set_output_volume(&self, id: OutputId, volume: f32) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs
            .get(&id)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            })?;
        entry.controls.transport.set_volume(volume);
        Ok(())
    }

    /// Set mute on an output (ramps like a gain move).
    pub fn set_output_mute(&self, id: OutputId, mute: bool) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs
            .get(&id)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            })?;
        entry.controls.transport.set_mute(mute);
        Ok(())
    }

    /// Pause an output (holds decode, pauses the device stream).
    pub fn pause_output(&self, id: OutputId) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs
            .get(&id)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            })?;
        entry.controls.paused.store(true, Ordering::Relaxed);
        entry.controls.transport.set_held(true);
        if let Some(device) = entry.device.lock().unwrap().as_ref() {
            device.pause_stream()?;
        }
        Ok(())
    }

    /// Resume a paused output.
    pub fn resume_output(&self, id: OutputId) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs
            .get(&id)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            })?;
        if let Some(device) = entry.device.lock().unwrap().as_ref() {
            device.resume_stream()?;
        }
        entry.controls.paused.store(false, Ordering::Relaxed);
        entry.controls.transport.set_held(false);
        Ok(())
    }

    /// Stop an output: signal the thread, join it, release the device.
    /// Queued stale audio is dropped with the ring (never emitted).
    pub fn stop_output(&self, id: OutputId) -> Result<()> {
        let thread = {
            let mut outputs = self.outputs.lock().unwrap();
            let entry = outputs
                .remove(&id)
                .ok_or_else(|| LibzciError::InvalidArgument {
                    detail: "unknown output".into(),
                })?;
            entry.controls.stop.store(true, Ordering::Relaxed);
            entry.controls.transport.stop();
            entry.thread
        };
        if let Some(thread) = thread {
            let _ = thread.join();
        }
        Ok(())
    }

    /// Dispose control bypasses PCM capacity. Join outside the output-map lock.
    pub(crate) fn stop_session_outputs(&self, session: SessionId) {
        let ids: Vec<_> = self
            .outputs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|(id, entry)| (entry.session == session).then_some(*id))
            .collect();
        for id in ids {
            let _ = self.stop_output(id);
        }
    }

    /// Device-free render of a session through the shared pipeline
    /// (decode → upmix → master → resample) into stereo `f32` frames.
    /// Powers unit tests and `zci-play --render-pcm`; never opens a
    /// device. Returns `(samples_interleaved, device_rate_hz)`.
    pub fn render_to_vec(
        &self,
        session: SessionId,
        to_rate_hz: u32,
        volume: f32,
        max_frames: u64,
        cancel: &CancelFlag,
    ) -> Result<(Vec<f32>, u32)> {
        let mut processor = AudioProcessor::new();
        processor.set_volume(volume);
        // Settle the ramp before rendering (deterministic tests).
        {
            let settle = vec![0.0f32; 512];
            let mut out = vec![0.0f32; 512];
            for _ in 0..8 {
                processor.process_stereo(&settle, &mut out);
            }
            processor.set_volume(volume);
            for _ in 0..8 {
                processor.process_stereo(&settle, &mut out);
            }
        }
        // Matched rates bypass conversion for bit-exact renders; only a
        // real device-rate mismatch goes through the resampler.
        let mut converter: Option<RateConverter> = None;
        let mut input_rate = None;
        let mut rendered = Vec::new();
        let mut decode_buf = vec![0.0f32; DECODE_SAMPLES];
        // Stereo scratch holds the mono→stereo expansion (2x).
        let mut stereo = vec![0.0f32; DECODE_SAMPLES * 2];
        let mut processed = vec![0.0f32; DECODE_SAMPLES * 2];
        let mut frames_done = 0u64;
        loop {
            cancel.check()?;
            if frames_done >= max_frames {
                break;
            }
            let (_, layout, _, frames, eof) =
                self.decode_session_chunk(session, &mut decode_buf, cancel)?;
            if frames == 0 {
                break;
            }
            // Explicit channel mapping to the stereo baseline.
            if input_rate != Some(layout.sample_rate) {
                converter = if to_rate_hz == layout.sample_rate {
                    None
                } else {
                    Some(RateConverter::new(layout.sample_rate, to_rate_hz, 2)?)
                };
                input_rate = Some(layout.sample_rate);
            }
            let stereo_frames: &[f32] = match layout.layout {
                ChannelLayout::Mono => {
                    AudioProcessor::upmix_mono(&decode_buf[..frames], &mut stereo[..frames * 2]);
                    &stereo[..frames * 2]
                }
                ChannelLayout::Stereo => &decode_buf[..frames * 2],
            };
            processor.process_stereo(stereo_frames, &mut processed[..stereo_frames.len()]);
            match converter.as_mut() {
                Some(converter) => {
                    converter.push(&processed[..stereo_frames.len()])?;
                    let mut out = vec![0.0f32; 8192];
                    loop {
                        let n = converter.pop(&mut out);
                        if n == 0 {
                            break;
                        }
                        rendered.extend_from_slice(&out[..n]);
                    }
                }
                None => rendered.extend_from_slice(&processed[..stereo_frames.len()]),
            }
            frames_done += frames as u64;
            if eof {
                break;
            }
        }
        if let Some(converter) = converter.as_mut() {
            converter.flush()?;
            let mut out = vec![0.0f32; 8192];
            loop {
                let n = converter.pop(&mut out);
                if n == 0 {
                    break;
                }
                rendered.extend_from_slice(&out[..n]);
            }
        }
        Ok((rendered, to_rate_hz))
    }
}

/// Bounded worker. Capacity polling happens only here, never in the callback.
#[allow(clippy::too_many_arguments)]
fn pipeline_main(
    runtime: &NativeRuntime,
    session: SessionId,
    rate_hz: u32,
    mut producer: PcmProducer,
    controls: &Arc<OutputControls>,
    drained: &Arc<AtomicBool>,
    finished: &Arc<AtomicBool>,
    decoded_position: &Arc<AtomicU64>,
) {
    let cancel = CancelFlag::default();
    let mut decode_buf = vec![0.0f32; DECODE_SAMPLES];
    let mut preparation: Option<OutputPreparation> = None;
    let mut last_generation = None;
    loop {
        if controls.stop.load(Ordering::Acquire) {
            break;
        }
        // Control is checked even with no PCM credits, held output, or EOF.
        let generation = runtime.session_generation(session);
        if last_generation != Some(generation) {
            controls.transport.request_generation(generation);
            preparation = None;
            last_generation = Some(generation);
            drained.store(false, Ordering::Release);
            finished.store(false, Ordering::Release);
            decoded_position.store(0, Ordering::Relaxed);
        }
        if controls.paused.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(2));
            continue;
        }
        if let Some(prepared) = &mut preparation {
            prepared.pump(|block, samples| producer.write(block, samples));
            if prepared.is_drained() {
                drained.store(true, Ordering::Release);
                finished.store(
                    controls.transport.is_drained()
                        && controls.transport.acknowledged_generation() == generation,
                    Ordering::Release,
                );
            }
            if !prepared.needs_input() {
                std::thread::sleep(std::time::Duration::from_millis(2));
                continue;
            }
        }
        // No decode or further converter input while all pool blocks are owned
        // downstream. A pending suffix above is retained until recycling.
        if !producer.has_credit() {
            std::thread::sleep(std::time::Duration::from_millis(2));
            continue;
        }
        let (decoded_generation, layout, start, frames, eof) =
            match runtime.decode_session_chunk(session, &mut decode_buf, &cancel) {
                Ok(decoded) => decoded,
                Err(_) => break,
            };
        if decoded_generation != generation || runtime.session_generation(session) != generation {
            continue;
        }
        let prepared = match preparation.as_mut() {
            Some(prepared) => prepared,
            None => {
                preparation =
                    match OutputPreparation::new(layout, rate_hz, DECODE_SAMPLES, generation) {
                        Ok(prepared) => Some(prepared),
                        Err(_) => break,
                    };
                preparation.as_mut().unwrap()
            }
        };
        if frames > 0 {
            if prepared
                .accept(
                    start,
                    &decode_buf[..frames * layout.layout.channels() as usize],
                )
                .is_err()
            {
                break;
            }
            decoded_position.store(start + frames as u64, Ordering::Relaxed);
        }
        if eof && prepared.finish().is_err() {
            break;
        }
    }
}
use std::collections::HashMap;

/// Map from output id to entry (owned by the runtime).
pub(crate) type OutputMap = HashMap<OutputId, OutputEntry>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pcm_transport::{pcm_transport, BLOCK_FRAMES};
    use libzci::{provider::FakeFactory, MemSource};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    fn full_worker() -> (
        Arc<NativeRuntime>,
        SessionId,
        Arc<OutputControls>,
        mpsc::Receiver<()>,
        std::thread::JoinHandle<()>,
    ) {
        let runtime = NativeRuntime::new();
        runtime
            .register_provider(Arc::new(FakeFactory::new(1_000_000, PcmLayout::mono48k())))
            .unwrap();
        let session = runtime.create_session();
        let source = runtime.insert_source(Arc::new(MemSource::new(b"FAKE-long".to_vec())));
        runtime
            .load(session, source, None, &CancelFlag::default())
            .unwrap();
        let generation = runtime.session_generation(session);
        let (producer, consumer, transport) = pcm_transport(1, generation);
        let controls = Arc::new(OutputControls {
            transport,
            paused: AtomicBool::new(false),
            stop: AtomicBool::new(false),
        });
        let (done_tx, done_rx) = mpsc::channel();
        let worker_runtime = runtime.clone();
        let worker_controls = controls.clone();
        let position = Arc::new(AtomicU64::new(0));
        let worker_position = position.clone();
        let worker = std::thread::spawn(move || {
            // Retain the consumer without making progress: one full pool slot.
            let _consumer = consumer;
            pipeline_main(
                &worker_runtime,
                session,
                48_000,
                producer,
                &worker_controls,
                &Arc::new(AtomicBool::new(false)),
                &Arc::new(AtomicBool::new(false)),
                &worker_position,
            );
            done_tx.send(()).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(2);
        while controls.transport.len_frames() != BLOCK_FRAMES {
            assert!(Instant::now() < deadline, "worker never filled pool");
            std::thread::yield_now();
        }
        // No file-sized read-ahead: only the one pending decoded block.
        assert!(position.load(Ordering::Relaxed) <= DECODE_SAMPLES as u64);
        (runtime, session, controls, done_rx, worker)
    }

    #[test]
    fn native_worker_stop_bypasses_full_capacity() {
        let (_, _, controls, done, worker) = full_worker();
        controls.stop.store(true, Ordering::Release);
        controls.transport.stop();
        done.recv_timeout(Duration::from_secs(2))
            .expect("capacity blocked stop");
        worker.join().unwrap();
    }

    #[test]
    fn session_dispose_stops_full_output_without_device() {
        let (runtime, session, controls, done, worker) = full_worker();
        let id = OutputId(NEXT_OUTPUT.fetch_add(1, Ordering::Relaxed));
        runtime.outputs.lock().unwrap().insert(
            id,
            OutputEntry {
                session,
                device: Arc::new(Mutex::new(None)),
                controls,
                drained: Arc::new(AtomicBool::new(false)),
                finished: Arc::new(AtomicBool::new(false)),
                decoded_position: Arc::new(AtomicU64::new(0)),
                thread: Some(worker),
            },
        );
        runtime.dispose_session(session);
        done.recv_timeout(Duration::from_secs(2))
            .expect("capacity blocked dispose");
        assert!(runtime.outputs.lock().unwrap().is_empty());
    }
}
