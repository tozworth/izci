//! Synchronous driver for the existing browser proof facade. This executes the
//! shared control machine; R4 replaces its PCM collector with worklet consumption.
use libzci::*;
use std::{collections::HashMap, sync::Arc};
pub(crate) struct WebSession {
    owner: Session,
    decoder: Option<Box<dyn DecoderInstance>>,
}
impl WebSession {
    pub fn new(id: SessionId) -> Self {
        Self {
            owner: Session::new(id),
            decoder: None,
        }
    }
    pub fn snapshot(&self) -> Snapshot {
        self.owner.snapshot()
    }
    pub fn generation(&self) -> Generation {
        self.owner.generation()
    }
    pub fn is_current(&self, g: Generation) -> bool {
        self.owner.is_current(g)
    }
    pub fn position_frames(&self) -> u64 {
        self.owner.position_frames()
    }
    pub fn load_source(
        &mut self,
        request_id: RequestId,
        source: Arc<dyn RuntimeSource>,
        hint: Option<&str>,
        registry: &ProviderRegistry,
        cancel: &CancelFlag,
    ) -> Result<Vec<Event>> {
        let id = source.id();
        let command = Command::Load {
            session: self.owner.id(),
            request_id,
            source: id,
            extension_hint: hint.map(str::to_owned),
            options: LoadOptions::default(),
        };
        let mut sources = HashMap::new();
        sources.insert(id, source);
        Ok(self.apply(&command, registry, &sources, cancel)?.1)
    }
    pub fn apply(
        &mut self,
        command: &Command,
        registry: &ProviderRegistry,
        sources: &HashMap<SourceId, Arc<dyn RuntimeSource>>,
        cancel: &CancelFlag,
    ) -> Result<(CommandAccept, Vec<Event>)> {
        let (receipt, actions) = self.owner.accept(command)?;
        for action in actions {
            match action {
                SessionAction::Open {
                    tag,
                    source,
                    hint,
                    options,
                } => {
                    let (_, mut decoder) =
                        registry.open_best(sources[&source].clone(), hint.as_deref(), cancel)?;
                    if let Some(n) = options.subsong {
                        decoder.module_control(ModuleControl::Subsong(n), cancel)?;
                    }
                    if options.start_time.0 > 0.0 {
                        decoder.seek_to_frame(
                            options.start_time.frames(decoder.layout().sample_rate)?,
                            cancel,
                        )?;
                    }
                    self.owner.opened(
                        tag,
                        decoder.metadata(),
                        decoder.capabilities(),
                        decoder.position_frames(),
                    );
                    self.decoder = Some(decoder);
                }
                SessionAction::Seek { tag, time } => {
                    if let Some(d) = &mut self.decoder {
                        let p = d.seek_to_frame(time.frames(d.layout().sample_rate)?, cancel)?;
                        self.owner.landed(tag, p);
                    }
                }
                SessionAction::Module { tag, control } => {
                    if let Some(d) = &mut self.decoder {
                        d.module_control(control, cancel)?;
                        self.owner
                            .opened(tag, d.metadata(), d.capabilities(), d.position_frames());
                    }
                }
                SessionAction::Close => self.decoder = None,
                SessionAction::Output => (),
            }
        }
        Ok((
            receipt,
            vec![Event::Completed {
                session: receipt.session,
                request_id: receipt.request_id,
                generation: receipt.generation,
            }],
        ))
    }
    pub fn decode_for_generation(
        &mut self,
        max: usize,
        cancel: &CancelFlag,
    ) -> Result<(Generation, PcmChunk)> {
        let d = self.decoder.as_mut().ok_or(LibzciError::Cancelled)?;
        let layout = d.layout();
        let start_frame = d.position_frames();
        let mut frames = vec![0.0; max.min(4096)];
        match d.decode(&mut frames, cancel)? {
            DecodeStatus::Data(n) => frames.truncate(n),
            DecodeStatus::Pending => frames.clear(),
            DecodeStatus::EndOfStream => {
                frames.clear();
                self.owner.eof(self.owner.tag());
            }
        }
        let generation = self.owner.generation();
        // The pre-R4 proof has no output. Do not label decoder read-ahead audible.
        Ok((
            generation,
            PcmChunk {
                layout,
                start_frame,
                frames,
            },
        ))
    }
}
