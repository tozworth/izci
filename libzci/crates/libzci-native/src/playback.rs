//! Native playback pipeline: decode, process, resample, feed.
//!
//! One worker thread per output pulls the core session through the
//! public decode path, maps channels explicitly, applies the shared
//! master processor, converts to the device rate, and feeds the
//! lock-free device ring. The device callback is the only realtime
//! context and only pops the ring.
//!
//! Generation discipline: the worker watches the session generation.
//! Any change (seek/stop/load) flushes the ring, resets the resampler,
//! and drops staging — old-generation buffers never reach the device.
//! Pause holds decode and pauses the device stream; buffered audio
//! resumes seamlessly because nothing changed underneath it.

use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};

use libzci::{
    AudioProcessor, CancelFlag, ChannelLayout, Generation, LibzciError, RateConverter,
    RequestedState, Result, RunningState, SessionId,
};

use crate::audio::{DeviceOutput, OutputSpec, open_output};
use crate::runtime::NativeRuntime;

/// Opaque output handle.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct OutputId(pub u64);

static NEXT_OUTPUT: AtomicU64 = AtomicU64::new(1);

/// Volume/mute control shared with the pipeline thread.
#[derive(Debug)]
struct OutputControls {
    processor: Mutex<AudioProcessor>,
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
    /// Returns `(channel_layout, frames, eof)`.
    pub(crate) fn decode_session_chunk(
        &self,
        session: SessionId,
        buf: &mut [f32],
        cancel: &CancelFlag,
    ) -> Result<(ChannelLayout, usize, bool)> {
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions.get(&session).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown session".into(),
        })?;
        let mut sess = cell.lock().unwrap();
        let (_generation, chunk) = sess.decode_for_generation(buf.len(), cancel)?;
        let layout = chunk.layout.layout;
        let n = chunk.frames.len().min(buf.len());
        buf[..n].copy_from_slice(&chunk.frames[..n]);
        let eof = chunk.frame_count() == 0;
        let channels = layout.channels() as usize;
        Ok((layout, n / channels.max(1), eof))
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
        let device = open_output(spec, 2.0)?;
        let rate_hz = device.rate_hz();
        let device_label = device.device_label.clone();
        let device = Arc::new(Mutex::new(Some(device)));
        let mut processor = AudioProcessor::new();
        processor.set_volume(volume);
        let controls = Arc::new(OutputControls {
            processor: Mutex::new(processor),
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
                pipeline_main(
                    &runtime,
                    session,
                    rate_hz,
                    &thread_device,
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
        self.outputs
            .lock()
            .unwrap()
            .insert(id, OutputEntry {
                session,
                device,
                controls,
                drained,
                finished,
                decoded_position,
                thread: Some(thread),
            });
        let _ = device_label;
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
            ring_fill_frames: device.ring.len_frames() as u64,
            drained: entry.drained.load(Ordering::Relaxed),
            finished: entry.finished.load(Ordering::Relaxed),
            device_label: device.device_label.clone(),
        })
    }

    /// Set master volume on an output (smoothed ramp in the pipeline).
    pub fn set_output_volume(&self, id: OutputId, volume: f32) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs.get(&id).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown output".into(),
        })?;
        entry.controls.processor.lock().unwrap().set_volume(volume);
        Ok(())
    }

    /// Set mute on an output (ramps like a gain move).
    pub fn set_output_mute(&self, id: OutputId, mute: bool) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs.get(&id).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown output".into(),
        })?;
        entry.controls.processor.lock().unwrap().set_mute(mute);
        Ok(())
    }

    /// Pause an output (holds decode, pauses the device stream).
    pub fn pause_output(&self, id: OutputId) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs.get(&id).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown output".into(),
        })?;
        entry.controls.paused.store(true, Ordering::Relaxed);
        if let Some(device) = entry.device.lock().unwrap().as_ref() {
            device.pause_stream()?;
        }
        Ok(())
    }

    /// Resume a paused output.
    pub fn resume_output(&self, id: OutputId) -> Result<()> {
        let outputs = self.outputs.lock().unwrap();
        let entry = outputs.get(&id).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown output".into(),
        })?;
        if let Some(device) = entry.device.lock().unwrap().as_ref() {
            device.resume_stream()?;
        }
        entry.controls.paused.store(false, Ordering::Relaxed);
        Ok(())
    }

    /// Stop an output: signal the thread, join it, release the device.
    /// Queued stale audio is dropped with the ring (never emitted).
    pub fn stop_output(&self, id: OutputId) -> Result<()> {
        let thread = {
            let mut outputs = self.outputs.lock().unwrap();
            let entry = outputs.remove(&id).ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown output".into(),
            })?;
            entry.controls.stop.store(true, Ordering::Relaxed);
            entry.thread
        };
        if let Some(thread) = thread {
            let _ = thread.join();
        }
        Ok(())
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
        let mut converter = if to_rate_hz == 48_000 {
            None
        } else {
            Some(RateConverter::new(48_000, to_rate_hz, 2)?)
        };
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
            let (layout, frames, eof) = self.decode_session_chunk(session, &mut decode_buf, cancel)?;
            if frames == 0 {
                break;
            }
            // Explicit channel mapping to the stereo baseline.
            let stereo_frames: &[f32] = match layout {
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

/// Pipeline worker: decode → upmix → master → resample → ring.
#[allow(clippy::too_many_arguments)]
fn pipeline_main(
    runtime: &NativeRuntime,
    session: SessionId,
    rate_hz: u32,
    device: &Arc<Mutex<Option<DeviceOutput>>>,
    controls: &Arc<OutputControls>,
    drained: &Arc<AtomicBool>,
    finished: &Arc<AtomicBool>,
    decoded_position: &Arc<AtomicU64>,
) {
    let cancel = CancelFlag::default();
    let mut converter = if rate_hz == 48_000 {
        None
    } else {
        match RateConverter::new(48_000, rate_hz, 2) {
            Ok(c) => Some(c),
            Err(_) => return,
        }
    };
    let mut decode_buf = vec![0.0f32; DECODE_SAMPLES];
    let mut stereo = vec![0.0f32; DECODE_SAMPLES * 2];
    let mut processed = vec![0.0f32; DECODE_SAMPLES * 2];
    let mut feed = vec![0.0f32; DECODE_SAMPLES * 2];
    let mut last_generation: Option<libzci::Generation> = None;
    loop {
        if controls.stop.load(Ordering::Relaxed) {
            break;
        }
        if controls.paused.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(10));
            continue;
        }
        // Generation fence: any session change flushes device-bound
        // buffers and resets conversion state.
        let current_generation = runtime.session_generation(session);
        if last_generation.map(|g| g != current_generation).unwrap_or(false) {
            if let Some(device) = device.lock().unwrap().as_ref() {
                device.ring.clear();
            }
            if let Some(converter) = converter.as_mut() {
                converter.reset();
            }
            last_generation = Some(current_generation);
            continue;
        }
        last_generation = Some(current_generation);
        let decoded = runtime.decode_session_chunk(session, &mut decode_buf, &cancel);
        let (layout, frames, eof) = match decoded {
            Ok(v) => v,
            Err(_) => {
                // Session gone or cancelled: drain out and exit.
                break;
            }
        };
        if frames == 0 {
            if eof {
                // Decoder EOF: flush conversion, mark drained, then wait
                // for the ring to play out before finishing.
                if let Some(converter) = converter.as_mut() {
                    let _ = converter.flush();
                    loop {
                        if controls.stop.load(Ordering::Relaxed) {
                            break;
                        }
                        let mut out = vec![0.0f32; 4096];
                        let m = converter.pop(&mut out);
                        if m > 0 {
                            if let Some(device) = device.lock().unwrap().as_ref() {
                                device.ring.push(&out[..m]);
                            }
                        } else {
                            break;
                        }
                    }
                }
                drained.store(true, Ordering::Relaxed);
                // Wait for play-out, then finish.
                loop {
                    if controls.stop.load(Ordering::Relaxed) {
                        break;
                    }
                    let empty = device
                        .lock()
                        .unwrap()
                        .as_ref()
                        .map(|d| d.ring.is_empty())
                        .unwrap_or(true);
                    if empty {
                        finished.store(true, Ordering::Relaxed);
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            continue;
        }
        let stereo_frames: &[f32] = match layout {
            ChannelLayout::Mono => {
                AudioProcessor::upmix_mono(&decode_buf[..frames], &mut stereo[..frames * 2]);
                &stereo[..frames * 2]
            }
            ChannelLayout::Stereo => &decode_buf[..frames * 2],
        };
        {
            let mut processor = controls.processor.lock().unwrap();
            processor.process_stereo(stereo_frames, &mut processed[..stereo_frames.len()]);
        }
        match converter.as_mut() {
            Some(converter) => {
                if converter.push(&processed[..stereo_frames.len()]).is_err() {
                    break;
                }
                // Move converted output into the ring (bounded per iteration).
                for _ in 0..4 {
                    let m = converter.pop(&mut feed);
                    if m == 0 {
                        break;
                    }
                    if let Some(device) = device.lock().unwrap().as_ref() {
                        device.ring.push(&feed[..m]);
                    }
                }
            }
            None => {
                if let Some(device) = device.lock().unwrap().as_ref() {
                    device.ring.push(&processed[..stereo_frames.len()]);
                }
            }
        }
        decoded_position.fetch_add(frames as u64, Ordering::Relaxed);
    }
}

use std::collections::HashMap;

/// Map from output id to entry (owned by the runtime).
pub(crate) type OutputMap = HashMap<OutputId, OutputEntry>;
