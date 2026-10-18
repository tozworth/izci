//! Incremental device-free render jobs. At most one decode and one prepared block
//! are retained. The caller owns the sink and can cancel between bounded writes.
use crate::{
    session_jobs::{SessionEntry, DECODE_SAMPLES},
    NativeRuntime,
};
use libzci::*;
use std::sync::Arc;

#[derive(Clone, Copy, Debug)]
pub enum ProcessingMode {
    Raw,
    Master { volume: f32, mute: bool },
}
#[derive(Clone, Debug)]
pub struct RenderOptions {
    pub load: LoadOptions,
    pub output_rate: u32,
    pub processing: ProcessingMode,
}
impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            load: LoadOptions::default(),
            output_rate: 48_000,
            processing: ProcessingMode::Raw,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct RenderProgress {
    pub source_frames: u64,
    pub output_frames: u64,
    pub retained_bytes: usize,
}
#[derive(Clone, Copy, Debug)]
pub struct RenderResult {
    pub output_frames: u64,
    pub rate_hz: u32,
}
pub enum RenderStep {
    Data {
        block: OutputBlock,
        samples: Vec<f32>,
    },
    Pending,
    Complete(RenderResult),
}
pub struct RenderJob {
    runtime: Arc<NativeRuntime>,
    entry: Arc<SessionEntry>,
    session: SessionId,
    cancel: CancelFlag,
    options: RenderOptions,
    preparation: Option<OutputPreparation>,
    progress: RenderProgress,
    complete: bool,
}
impl NativeRuntime {
    pub fn start_render(
        self: &Arc<Self>,
        source: SourceId,
        hint: Option<&str>,
        options: RenderOptions,
        cancel: &CancelFlag,
    ) -> Result<RenderJob> {
        PcmLayout::new(ChannelLayout::Stereo, options.output_rate)?;
        if let ProcessingMode::Master { volume, .. } = options.processing {
            if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
                return Err(LibzciError::InvalidArgument {
                    detail: "render volume must be in 0..=1".into(),
                });
            }
        }
        let session = self.create_session();
        let token = CancelFlag::child_of(cancel);
        if let Err(error) = self.submit(
            &Command::Load {
                session,
                request_id: RequestId::fresh(),
                source,
                options: options.load.clone(),
                extension_hint: hint.map(str::to_owned),
            },
            &token,
        ) {
            self.dispose_session(session);
            return Err(error);
        }
        self.submit(
            &Command::Play {
                session,
                request_id: RequestId::fresh(),
            },
            &token,
        )?;
        Ok(RenderJob {
            runtime: self.clone(),
            entry: self.entry(session)?,
            session,
            cancel: token,
            options,
            preparation: None,
            progress: RenderProgress {
                source_frames: 0,
                output_frames: 0,
                retained_bytes: 0,
            },
            complete: false,
        })
    }
}
impl RenderJob {
    pub fn cancel(&self) {
        self.cancel.cancel();
        self.entry.close();
    }
    pub fn progress(&self) -> RenderProgress {
        self.progress
    }
    pub fn next(&mut self) -> Result<RenderStep> {
        self.cancel.check()?;
        loop {
            if let Some(p) = &mut self.preparation {
                let mut output = None;
                p.pump(|block, samples| {
                    let mut samples = samples.to_vec();
                    if let ProcessingMode::Master { volume, mute } = self.options.processing {
                        // Offline jobs have a fixed master setting, so no startup ramp.
                        AudioProcessor::apply_gain(&mut samples, if mute { 0.0 } else { volume });
                    }
                    output = Some(RenderStep::Data { block, samples });
                    block.valid_frames
                });
                self.progress.retained_bytes = p.retained_bytes() + DECODE_SAMPLES * 4;
                if let Some(RenderStep::Data { block, samples }) = output {
                    self.progress.output_frames += block.valid_frames as u64;
                    self.entry
                        .consumed(block.generation, block.source_end, false);
                    return Ok(RenderStep::Data { block, samples });
                }
                if p.is_drained() {
                    self.complete = true;
                    let s = self.entry.snapshot();
                    self.entry
                        .consumed(s.generation, self.progress.source_frames, true);
                    return Ok(RenderStep::Complete(RenderResult {
                        output_frames: self.progress.output_frames,
                        rate_hz: self.options.output_rate,
                    }));
                }
                if !p.needs_input() {
                    continue;
                }
            }
            let decoded = self.entry.decode(&self.cancel)?;
            if !self
                .entry
                .control
                .lock()
                .unwrap()
                .owner
                .accepts(decoded.tag)
            {
                continue;
            }
            if self.preparation.is_none() {
                self.preparation = Some(OutputPreparation::new(
                    decoded.layout,
                    self.options.output_rate,
                    DECODE_SAMPLES,
                    decoded.tag.generation,
                )?);
            }
            let p = self.preparation.as_mut().unwrap();
            match decoded.status {
                DecodeStatus::Data(_) => {
                    self.progress.source_frames = decoded.start
                        + (decoded.samples.len() / decoded.layout.layout.channels() as usize)
                            as u64;
                    p.accept(decoded.start, &decoded.samples)?;
                }
                DecodeStatus::Pending => return Ok(RenderStep::Pending),
                DecodeStatus::EndOfStream => p.finish()?,
            }
        }
    }
}
impl Drop for RenderJob {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.runtime.dispose_session(self.session);
    }
}
