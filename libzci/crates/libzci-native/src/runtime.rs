//! Minimal native runtime assembly.
//!
//! Owns the provider registry, runtime source handles, and sessions.
//! Each session's commands are serialized through a per-session mutex;
//! cancellation/close prevents late results becoming authoritative,
//! and observers receive bounded/coalesced events.
//!
//! No database, profile, device output, or GUI lives here in Phase 1.1.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use libzci::{
    CancelFlag, Command, CommandAccept, Event, LibzciError, PcmCollector, ProviderFactory,
    ProviderRegistry, RequestId, Result, RuntimeSource, Session, SessionId, Snapshot, SourceId,
};

/// Native runtime: registry + sources + serialized sessions.
#[derive(Default)]
pub struct NativeRuntime {
    pub(crate) registry: Mutex<ProviderRegistry>,
    pub(crate) sources: Mutex<HashMap<SourceId, Arc<dyn RuntimeSource>>>,
    pub(crate) sessions: Mutex<HashMap<SessionId, Mutex<Session>>>,
    pub(crate) outputs: Mutex<crate::playback::OutputMap>,
}

impl NativeRuntime {
    /// Create an empty runtime (no providers registered).
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Register one provider factory.
    pub fn register_provider(&self, factory: Arc<dyn ProviderFactory>) -> Result<()> {
        self.registry.lock().unwrap().register(factory)
    }

    /// Registered provider IDs in order.
    pub fn provider_ids(&self) -> Vec<libzci::ProviderId> {
        self.registry.lock().unwrap().provider_ids()
    }

    /// Insert an already-opened runtime source; returns its ID.
    /// (File opening itself lives in [`crate::source::NativeFileSource`].)
    pub fn insert_source(&self, source: Arc<dyn RuntimeSource>) -> SourceId {
        let id = source.id();
        self.sources.lock().unwrap().insert(id, source);
        id
    }

    /// Look up a registered source.
    pub fn get_source(&self, id: SourceId) -> Option<Arc<dyn RuntimeSource>> {
        self.sources.lock().unwrap().get(&id).cloned()
    }

    /// Release a source handle (decode instances already opened keep
    /// their own `Arc`; in-flight reads complete or cancel).
    pub fn release_source(&self, id: SourceId) {
        self.sources.lock().unwrap().remove(&id);
    }

    /// Create one idle session.
    pub fn create_session(&self) -> SessionId {
        let id = SessionId::fresh();
        self.sessions
            .lock()
            .unwrap()
            .insert(id, Mutex::new(Session::new(id)));
        id
    }

    /// Load a registered source into a session through provider
    /// selection. Bumps the session generation.
    pub fn load(
        &self,
        session: SessionId,
        source: SourceId,
        extension_hint: Option<&str>,
        cancel: &CancelFlag,
    ) -> Result<Vec<Event>> {
        let src = self.get_source(source).ok_or_else(|| LibzciError::Unavailable {
            detail: format!("unknown source {source:?}"),
        })?;
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions.get(&session).ok_or_else(|| LibzciError::InvalidArgument {
            detail: format!("unknown session {session:?}"),
        })?;
        let mut sess = cell.lock().unwrap();
        let registry = self.registry.lock().unwrap();
        sess.load_source(RequestId::fresh(), src, extension_hint, &registry, cancel)
    }

    /// Submit one serialized command to a session.
    pub fn submit(&self, command: &Command, cancel: &CancelFlag) -> Result<(CommandAccept, Vec<Event>)> {
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions.get(&command.session()).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown session".into(),
        })?;
        let mut sess = cell.lock().unwrap();
        let registry = self.registry.lock().unwrap();
        let sources = self.sources.lock().unwrap();
        sess.apply(command, &registry, &sources, cancel)
    }

    /// Current snapshot for a session.
    pub fn snapshot(&self, session: SessionId) -> Result<Snapshot> {
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions.get(&session).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown session".into(),
        })?;
        let snapshot = cell.lock().unwrap().snapshot();
        Ok(snapshot)
    }

    /// Device-free render: decode until EOF/cancel through the public
    /// session API into a [`PcmCollector`].
    pub fn render_to_collector(
        &self,
        session: SessionId,
        max_samples_per_chunk: usize,
        max_chunks: usize,
        cancel: &CancelFlag,
    ) -> Result<PcmCollector> {
        let sessions = self.sessions.lock().unwrap();
        let cell = sessions.get(&session).ok_or_else(|| LibzciError::InvalidArgument {
            detail: "unknown session".into(),
        })?;
        let mut sess = cell.lock().unwrap();
        let mut collector = PcmCollector::default();
        collector.collect_until_eof(&mut sess, max_samples_per_chunk, max_chunks, cancel)?;
        Ok(collector)
    }

    /// Dispose a session and forget it. Late results from it can never
    /// become authoritative afterwards.
    pub fn dispose_session(&self, session: SessionId) {
        self.sessions.lock().unwrap().remove(&session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libzci::{MemSource, provider::FakeFactory};

    fn runtime_with_fake(total: u64) -> Arc<NativeRuntime> {
        let rt = NativeRuntime::new();
        rt.register_provider(Arc::new(FakeFactory::new(total, libzci::PcmLayout::mono48k())))
            .unwrap();
        rt
    }

    #[test]
    fn two_sessions_hold_separate_fake_state() {
        let rt = runtime_with_fake(48000);
        let cancel = CancelFlag::default();
        let a = rt.create_session();
        let b = rt.create_session();
        let sa = rt.insert_source(Arc::new(MemSource::new(b"FAKE-a".to_vec())));
        let sb = rt.insert_source(Arc::new(MemSource::new(b"FAKE-b".to_vec())));
        rt.load(a, sa, None, &cancel).unwrap();
        rt.load(b, sb, None, &cancel).unwrap();
        let ca = rt.render_to_collector(a, 480, 200, &cancel).unwrap();
        assert_eq!(ca.accepted_frames, 48000);
        assert_eq!(rt.snapshot(a).unwrap().position_frames, 48000);
        assert_eq!(rt.snapshot(b).unwrap().position_frames, 0);
    }

    #[test]
    fn dispose_prevents_late_authority() {
        let rt = runtime_with_fake(8000);
        let cancel = CancelFlag::default();
        let s = rt.create_session();
        let src = rt.insert_source(Arc::new(MemSource::new(b"FAKEx".to_vec())));
        rt.load(s, src, None, &cancel).unwrap();
        rt.dispose_session(s);
        assert!(rt.snapshot(s).is_err());
    }
}
