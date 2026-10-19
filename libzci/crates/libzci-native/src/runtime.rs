//! Runtime assembly and prompt command acceptance; decoders live on job workers.
use crate::session_jobs::{Plan, SessionEntry};
use libzci::*;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Default)]
pub struct NativeRuntime {
    registry: Mutex<ProviderRegistry>,
    sources: Mutex<HashMap<SourceId, Arc<dyn RuntimeSource>>>,
    pub(crate) sessions: Mutex<HashMap<SessionId, Arc<SessionEntry>>>,
    pub(crate) outputs: Mutex<crate::playback::OutputMap>,
}
impl NativeRuntime {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn register_provider(&self, factory: Arc<dyn ProviderFactory>) -> Result<()> {
        self.registry.lock().unwrap().register(factory)
    }
    pub fn provider_ids(&self) -> Vec<ProviderId> {
        self.registry.lock().unwrap().provider_ids()
    }
    pub(crate) fn registry_snapshot(&self) -> ProviderRegistry { self.registry.lock().unwrap().clone() }
    pub fn insert_source(&self, source: Arc<dyn RuntimeSource>) -> SourceId {
        let id = source.id();
        self.sources.lock().unwrap().insert(id, source);
        id
    }
    pub fn get_source(&self, id: SourceId) -> Option<Arc<dyn RuntimeSource>> {
        self.sources.lock().unwrap().get(&id).cloned()
    }
    pub fn release_source(&self, id: SourceId) {
        self.sources.lock().unwrap().remove(&id);
    }
    pub fn create_session(&self) -> SessionId {
        let id = SessionId::fresh();
        self.sessions
            .lock()
            .unwrap()
            .insert(id, SessionEntry::new(id));
        id
    }
    pub(crate) fn entry(&self, id: SessionId) -> Result<Arc<SessionEntry>> {
        self.sessions
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown session".into(),
            })
    }
    pub fn submit(
        &self,
        command: &Command,
        cancel: &CancelFlag,
    ) -> Result<(CommandAccept, Vec<Event>)> {
        cancel.check()?;
        let entry = self.entry(command.session())?;
        if let Some(receipt) = entry
            .control
            .lock()
            .unwrap()
            .owner
            .receipt(command.request_id())
        {
            return Ok((receipt, Vec::new()));
        }
        let source = if let Command::Load { source, .. } = command {
            Some(
                self.get_source(*source)
                    .ok_or_else(|| LibzciError::Unavailable {
                        detail: "unknown source".into(),
                    })?,
            )
        } else {
            None
        };
        let registry = source
            .as_ref()
            .map(|_| self.registry.lock().unwrap().clone());
        let mut c = entry.control.lock().unwrap();
        if let Some((generation, position)) = c.output.as_ref().and_then(|o| o.media_position()) {
            c.owner.consumed(generation, position, false);
        }
        let previous = c.owner.snapshot();
        let previous_tag = c.owner.tag();
        let old = previous.generation;
        let (receipt, actions) = c.owner.accept(command)?;
        if actions.is_empty() {
            return Ok((receipt, Vec::new()));
        }
        if old != receipt.generation {
            if previous.pending_operation {
                c.events.push(Event::Failed {
                    session: command.session(),
                    request_id: Some(previous_tag.operation),
                    generation: old,
                    error: LibzciError::Cancelled,
                });
            }
            if let Some(p) = &c.plan {
                p.cancel.cancel();
            }
            c.result = None;
        }
        let deferred = actions.iter().any(|a| {
            matches!(
                a,
                SessionAction::Open { .. }
                    | SessionAction::Seek { .. }
                    | SessionAction::Module { .. }
            )
        });
        for action in actions {
            match action {
                SessionAction::Open {
                    tag, hint, options, ..
                } => {
                    c.plan = Some(Plan {
                        tag,
                        source: source.clone().unwrap(),
                        registry: registry.clone().unwrap(),
                        hint,
                        options,
                        controls: Vec::new(),
                        cancel: CancelFlag::child_of(cancel),
                    });
                }
                SessionAction::Seek { tag, time } => {
                    if let Some(p) = &mut c.plan {
                        p.tag = tag;
                        p.options.start_time = time;
                        p.cancel = CancelFlag::child_of(cancel);
                    }
                }
                SessionAction::Module { tag, control } => {
                    let s = c.owner.snapshot();
                    if let Some(p) = &mut c.plan {
                        p.tag = tag;
                        p.cancel = CancelFlag::child_of(cancel);
                        p.options.start_time = MediaTime::from_frames(
                            s.position_frames,
                            s.layout.unwrap().sample_rate,
                        );
                        match control {
                            ModuleControl::Subsong(n) => {
                                p.options.subsong = Some(n);
                                p.options.start_time = MediaTime(0.0);
                            }
                            _ => {
                                // Coalesce controls by parameter, bounded by module channels.
                                p.controls.retain(|v| !v.same_parameter(control));
                                p.controls.push(control);
                            }
                        }
                    }
                }
                SessionAction::Close => {
                    c.closed = true;
                    if let Some(p) = &c.plan {
                        p.cancel.cancel();
                    }
                }
                SessionAction::Output => (),
            }
        }
        let snap = c.owner.snapshot();
        c.refresh_output();
        let event = Event::StateChanged {
            session: command.session(),
            generation: snap.generation,
            revision: snap.revision,
        };
        c.events.push(event.clone());
        if !deferred {
            c.events.push(Event::Completed {
                session: command.session(),
                generation: receipt.generation,
                request_id: receipt.request_id,
            });
        }
        entry.wake.notify_all();
        drop(c);
        if matches!(command, Command::Dispose { .. }) {
            self.dispose_session(command.session());
        }
        Ok((receipt, vec![event]))
    }
    pub fn snapshot(&self, id: SessionId) -> Result<Snapshot> {
        Ok(self.entry(id)?.snapshot())
    }
    pub fn events(&self, id: SessionId) -> Result<EventBatch> {
        let entry = self.entry(id)?;
        let mut c = entry.control.lock().unwrap();
        Ok(EventBatch {
            events: c.events.drain(),
            coalesced: std::mem::take(&mut c.events.coalesced),
            dropped: std::mem::take(&mut c.events.dropped),
            snapshot: c.owner.snapshot(),
        })
    }
    /// Wait for open/seek completion while observing the caller's cancellation.
    pub fn wait_ready(&self, id: SessionId, cancel: &CancelFlag) -> Result<Snapshot> {
        let entry = self.entry(id)?;
        let mut c = entry.control.lock().unwrap();
        loop {
            cancel.check()?;
            if c.closed {
                return Err(LibzciError::Cancelled);
            }
            let s = c.owner.snapshot();
            if let Some(e) = s.error {
                return Err(e);
            }
            if !s.pending_operation {
                return Ok(s);
            }
            c = entry
                .wake
                .wait_timeout(c, Duration::from_millis(10))
                .unwrap()
                .0;
        }
    }
    /// Convenience for synchronous hosts; uses exactly the same Load operation.
    pub fn load(
        &self,
        session: SessionId,
        source: SourceId,
        hint: Option<&str>,
        cancel: &CancelFlag,
    ) -> Result<Vec<Event>> {
        self.submit(
            &Command::Load {
                request_id: RequestId::fresh(),
                session,
                source,
                options: LoadOptions::default(),
                extension_hint: hint.map(str::to_owned),
            },
            cancel,
        )?;
        self.wait_ready(session, cancel)?;
        Ok(self.events(session)?.events)
    }
    pub fn dispose_session(&self, id: SessionId) {
        if let Some(entry) = self.sessions.lock().unwrap().remove(&id) {
            entry.close();
        }
        self.stop_session_outputs(id);
    }
}
impl Drop for NativeRuntime {
    fn drop(&mut self) {
        for entry in self.sessions.get_mut().unwrap().values() {
            entry.close();
        }
        // OutputEntry releases streams and workers without a runtime Arc cycle.
        self.outputs.get_mut().unwrap().clear();
    }
}
