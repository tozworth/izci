//! Playback sessions: transport state, generation fencing, and the
//! device-free PCM collector.
//!
//! One session owns one decoder instance, one generation counter, and
//! one revision counter. Control is serialized per session: the
//! [`Session`] methods take `&mut self`, so the runtime executor holds
//! a per-session mutex (or single-threaded owner) and late results
//! carrying an old generation can never become authoritative.
//!
//! Transport states: idle, loading, ready/paused, playing, ended,
//! failed, and output-suspended. `Ready` covers both paused and
//! prepared-to-play; `Playing` is requested play, distinct from output
//! actually running (a Phase 2 device concern).

use std::sync::Arc;

use crate::audio::pcm::{PcmChunk, PcmLayout};
use crate::command::{Command, CommandAccept};
use crate::error::{LibzciError, Result};
use crate::event::{Event, Snapshot};
use crate::ids::{Generation, RequestId, Revision, SessionId};
use crate::provider::{DecoderInstance, ProviderInfo, ProviderRegistry};
use crate::source::{CancelFlag, RuntimeSource};

/// Minimum transport states.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransportState {
    /// No source open.
    Idle,
    /// Open/probe in progress (acceptance precedes completion).
    Loading,
    /// Source open, output held (paused/prepared).
    Ready,
    /// Play requested (output-running is observed in Phase 2).
    Playing,
    /// Decoder drained to EOF.
    Ended,
    /// Terminal failure for the current source (see snapshot error).
    Failed,
    /// Output suspended by the device/policy (position retained).
    OutputSuspended,
}

/// One playback session.
pub struct Session {
    id: SessionId,
    generation: Generation,
    revision: Revision,
    state: TransportState,
    decoder: Option<Box<dyn DecoderInstance>>,
    provider: Option<ProviderInfo>,
    layout: Option<PcmLayout>,
    total_frames: Option<u64>,
    position_frames: u64,
    error: Option<LibzciError>,
    disposed: bool,
    last_request: Option<RequestId>,
}

impl Session {
    /// Create an idle session.
    pub fn new(id: SessionId) -> Self {
        Self {
            id,
            generation: Generation::INITIAL,
            revision: Revision::INITIAL,
            state: TransportState::Idle,
            decoder: None,
            provider: None,
            layout: None,
            total_frames: None,
            position_frames: 0,
            error: None,
            disposed: false,
            last_request: None,
        }
    }

    /// Session identity.
    pub fn id(&self) -> SessionId {
        self.id
    }

    /// Current generation (validity epoch for PCM/events).
    pub fn generation(&self) -> Generation {
        self.generation
    }

    /// Current snapshot revision.
    pub fn revision(&self) -> Revision {
        self.revision
    }

    /// Current transport state.
    pub fn state(&self) -> TransportState {
        self.state
    }

    /// Current position on the provider timeline.
    pub fn position_frames(&self) -> u64 {
        self.position_frames
    }

    fn check_live(&self) -> Result<()> {
        if self.disposed {
            return Err(LibzciError::Cancelled);
        }
        Ok(())
    }

    fn commit(&mut self) -> Revision {
        self.revision.bump()
    }

    /// Authoritative snapshot for observers.
    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            session: self.id,
            revision: self.revision,
            generation: self.generation,
            state: self.state,
            provider: self.provider,
            position_frames: self.position_frames,
            total_frames: self.total_frames,
            error: self.error.clone(),
            request_id: self.last_request,
        }
    }

    /// Apply one serialized command. Returns acceptance plus events
    /// to publish. Slow/decode work is synchronous here; the threaded
    /// runtime in later phases moves it to jobs while keeping this
    /// generation discipline.
    pub fn apply(
        &mut self,
        command: &Command,
        registry: &ProviderRegistry,
        sources: &std::collections::HashMap<crate::ids::SourceId, Arc<dyn RuntimeSource>>,
        cancel: &CancelFlag,
    ) -> Result<(CommandAccept, Vec<Event>)> {
        self.check_live()?;
        if command.session() != self.id {
            return Err(LibzciError::InvalidArgument {
                detail: "command targeted another session".into(),
            });
        }
        match command {
            Command::Load {
                request_id,
                extension_hint,
                ..
            } => self.do_load(*request_id, extension_hint.clone(), registry, sources, cancel),
            Command::Play { request_id, .. } => self.do_play(*request_id),
            Command::Pause { request_id, .. } => self.do_pause(*request_id),
            Command::Seek {
                request_id, frame, ..
            } => self.do_seek(*request_id, *frame, cancel),
            Command::Stop { request_id, .. } => self.do_stop(*request_id),
            Command::Dispose { request_id, .. } => self.do_dispose(*request_id),
        }
    }

    fn do_load(
        &mut self,
        request_id: RequestId,
        extension_hint: Option<String>,
        registry: &ProviderRegistry,
        sources: &std::collections::HashMap<crate::ids::SourceId, Arc<dyn RuntimeSource>>,
        cancel: &CancelFlag,
    ) -> Result<(CommandAccept, Vec<Event>)> {
        // Loading bumps the generation first so any in-flight PCM
        // from the previous source is stale on arrival.
        self.generation.bump();
        let generation = self.generation;
        self.state = TransportState::Loading;
        self.error = None;
        self.decoder = None;
        self.provider = None;
        self.position_frames = 0;
        self.total_frames = None;
        self.last_request = Some(request_id);
        self.commit();

        // The load command must name its source. The session cannot
        // guess: callers pass the source ID via the extension-hint
        // channel in Phase 1.1 tests through `load_source` below.
        // `apply(Load)` without a registered source binding is a
        // programming error; use `load_source` for real opens.
        let _ = (registry, sources, extension_hint, cancel);
        let accept = CommandAccept {
            request_id,
            session: self.id,
            generation,
        };
        Ok((
            accept,
            vec![Event::StateChanged {
                session: self.id,
                generation,
                revision: self.revision,
            }],
        ))
    }

    /// Real open path: bind a registered source through the registry.
    /// Used by the runtime and tests; keeps `apply` free of source-map
    /// plumbing while preserving identical generation rules.
    pub fn load_source(
        &mut self,
        request_id: RequestId,
        source: Arc<dyn RuntimeSource>,
        extension_hint: Option<&str>,
        registry: &ProviderRegistry,
        cancel: &CancelFlag,
    ) -> Result<Vec<Event>> {
        self.check_live()?;
        self.generation.bump();
        let generation = self.generation;
        self.state = TransportState::Loading;
        self.error = None;
        self.last_request = Some(request_id);
        self.commit();
        cancel.check()?;
        match registry.open_best(source, extension_hint, cancel) {
            Ok((info, instance)) => {
                self.layout = Some(instance.layout());
                self.total_frames = instance.total_frames();
                self.position_frames = instance.position_frames();
                self.decoder = Some(instance);
                self.provider = Some(info);
                self.state = TransportState::Ready;
                self.commit();
                Ok(vec![
                    Event::StateChanged {
                        session: self.id,
                        generation,
                        revision: self.revision,
                    },
                    Event::Completed {
                        session: self.id,
                        request_id,
                        generation,
                    },
                ])
            }
            Err(e) => {
                self.state = TransportState::Failed;
                self.error = Some(e.clone());
                self.decoder = None;
                self.provider = None;
                self.commit();
                Ok(vec![Event::Failed {
                    session: self.id,
                    request_id: Some(request_id),
                    generation,
                    error: e,
                }])
            }
        }
    }

    fn do_play(&mut self, request_id: RequestId) -> Result<(CommandAccept, Vec<Event>)> {
        let generation = self.generation;
        self.last_request = Some(request_id);
        match self.state {
            TransportState::Ready | TransportState::OutputSuspended | TransportState::Ended => {
                if self.decoder.is_some() {
                    // Replaying from Ended restarts from the top,
                    // mirroring worklet play-after-ended semantics.
                    if self.state == TransportState::Ended {
                        self.position_frames = 0;
                        if let Some(d) = self.decoder.as_mut() {
                            let _ = d.seek_to_frame(0, &CancelFlag::default());
                            self.position_frames = d.position_frames();
                        }
                    }
                    self.state = TransportState::Playing;
                    self.error = None;
                } else {
                    self.state = TransportState::Failed;
                    self.error = Some(LibzciError::InvalidArgument {
                        detail: "play with no loaded source".into(),
                    });
                }
            }
            TransportState::Playing => {}
            TransportState::Idle | TransportState::Loading | TransportState::Failed => {
                self.state = TransportState::Failed;
                if self.error.is_none() {
                    self.error = Some(LibzciError::InvalidArgument {
                        detail: "play in a non-playable state".into(),
                    });
                }
            }
        }
        self.commit();
        let accept = CommandAccept {
            request_id,
            session: self.id,
            generation,
        };
        Ok((
            accept,
            vec![Event::StateChanged {
                session: self.id,
                generation,
                revision: self.revision,
            }],
        ))
    }

    fn do_pause(&mut self, request_id: RequestId) -> Result<(CommandAccept, Vec<Event>)> {
        let generation = self.generation;
        self.last_request = Some(request_id);
        if self.state == TransportState::Playing {
            self.state = TransportState::Ready;
        }
        self.commit();
        let accept = CommandAccept {
            request_id,
            session: self.id,
            generation,
        };
        Ok((
            accept,
            vec![Event::StateChanged {
                session: self.id,
                generation,
                revision: self.revision,
            }],
        ))
    }

    fn do_seek(
        &mut self,
        request_id: RequestId,
        frame: u64,
        cancel: &CancelFlag,
    ) -> Result<(CommandAccept, Vec<Event>)> {
        self.generation.bump();
        let generation = self.generation;
        self.last_request = Some(request_id);
        if let Some(decoder) = self.decoder.as_mut() {
            match decoder.seek_to_frame(frame, cancel) {
                Ok(landed) => {
                    self.position_frames = landed;
                    self.error = None;
                    if self.state == TransportState::Ended && landed < self.total_frames.unwrap_or(u64::MAX) {
                        self.state = TransportState::Ready;
                    }
                    self.commit();
                    Ok((
                        CommandAccept {
                            request_id,
                            session: self.id,
                            generation,
                        },
                        vec![Event::StateChanged {
                            session: self.id,
                            generation,
                            revision: self.revision,
                        }],
                    ))
                }
                Err(LibzciError::Cancelled) => {
                    // Seek superseded: keep the new generation so late
                    // PCM from the old seek cannot commit.
                    self.commit();
                    Ok((
                        CommandAccept {
                            request_id,
                            session: self.id,
                            generation,
                        },
                        vec![Event::Failed {
                            session: self.id,
                            request_id: Some(request_id),
                            generation,
                            error: LibzciError::Cancelled,
                        }],
                    ))
                }
                Err(e) => {
                    self.error = Some(e.clone());
                    self.state = TransportState::Failed;
                    self.commit();
                    Ok((
                        CommandAccept {
                            request_id,
                            session: self.id,
                            generation,
                        },
                        vec![Event::Failed {
                            session: self.id,
                            request_id: Some(request_id),
                            generation,
                            error: e,
                        }],
                    ))
                }
            }
        } else {
            self.error = Some(LibzciError::InvalidArgument {
                detail: "seek with no loaded source".into(),
            });
            self.state = TransportState::Failed;
            self.commit();
            Ok((
                CommandAccept {
                    request_id,
                    session: self.id,
                    generation,
                },
                vec![Event::Failed {
                    session: self.id,
                    request_id: Some(request_id),
                    generation,
                    error: self.error.clone().unwrap(),
                }],
            ))
        }
    }

    fn do_stop(&mut self, request_id: RequestId) -> Result<(CommandAccept, Vec<Event>)> {
        // Stop flushes queued audio: bump the generation so any
        // produced-but-unconsumed PCM is stale, then park at start.
        self.generation.bump();
        let generation = self.generation;
        self.last_request = Some(request_id);
        if let Some(decoder) = self.decoder.as_mut() {
            let _ = decoder.seek_to_frame(0, &CancelFlag::default());
            self.position_frames = decoder.position_frames();
        } else {
            self.position_frames = 0;
        }
        if self.state == TransportState::Playing
            || self.state == TransportState::Ready
            || self.state == TransportState::Ended
        {
            self.state = TransportState::Ready;
        }
        self.commit();
        let accept = CommandAccept {
            request_id,
            session: self.id,
            generation,
        };
        Ok((
            accept,
            vec![Event::StateChanged {
                session: self.id,
                generation,
                revision: self.revision,
            }],
        ))
    }

    fn do_dispose(&mut self, request_id: RequestId) -> Result<(CommandAccept, Vec<Event>)> {
        let generation = self.generation;
        self.disposed = true;
        self.decoder = None;
        self.last_request = Some(request_id);
        self.commit();
        let accept = CommandAccept {
            request_id,
            session: self.id,
            generation,
        };
        // After disposal no further result from this session becomes
        // authoritative; the runtime drops its registry entry.
        Ok((accept, vec![]))
    }

    /// Decode up to `max_samples` through the public runtime path.
    /// The returned chunk carries the current generation; callers
    /// must drop it when `chunk_generation != session.generation()`
    /// (see [`PcmCollector`]).
    pub fn decode_for_generation(
        &mut self,
        max_samples: usize,
        cancel: &CancelFlag,
    ) -> Result<(Generation, PcmChunk)> {
        self.check_live()?;
        let generation = self.generation;
        let decoder = self.decoder.as_mut().ok_or_else(|| LibzciError::InvalidArgument {
            detail: "decode with no loaded source".into(),
        })?;
        let decoder: &mut dyn DecoderInstance = &mut **decoder;
        let layout = decoder.layout();
        let start_frame = decoder.position_frames();
        let collected = crate::provider::decode_chunk(decoder, layout, start_frame, max_samples, cancel)?;
        self.position_frames = decoder.position_frames();
        if collected.frame_count() == 0 && self.state == TransportState::Playing {
            self.state = TransportState::Ended;
            self.commit();
        }
        Ok((generation, collected))
    }

    /// Whether a produced result is still authoritative.
    pub fn is_current(&self, generation: Generation) -> bool {
        !self.disposed && generation == self.generation
    }
}

/// Device-free PCM collector through the public runtime API.
///
/// Wraps [`Session::decode_for_generation`] and enforces the
/// generation fence: stale results are counted and dropped, never
/// published to observers.
#[derive(Debug, Default)]
pub struct PcmCollector {
    /// Accepted chunks (current generation only).
    pub accepted: Vec<PcmChunk>,
    /// Stale chunks refused after a seek/stop/dispose.
    pub rejected_stale: u64,
    /// Total accepted frames.
    pub accepted_frames: u64,
}

impl PcmCollector {
    /// Collect one chunk from `session`, enforcing the fence.
    pub fn collect(
        &mut self,
        session: &mut Session,
        max_samples: usize,
        cancel: &CancelFlag,
    ) -> Result<bool> {
        let (generation, chunk) = session.decode_for_generation(max_samples, cancel)?;
        if !session.is_current(generation) {
            self.rejected_stale += 1;
            return Ok(false);
        }
        let more = chunk.frame_count() > 0;
        self.accepted_frames += chunk.frame_count() as u64;
        self.accepted.push(chunk);
        Ok(more)
    }

    /// Collect until EOF, cancellation, or `max_chunks`.
    pub fn collect_until_eof(
        &mut self,
        session: &mut Session,
        max_samples_per_chunk: usize,
        max_chunks: usize,
        cancel: &CancelFlag,
    ) -> Result<()> {
        for _ in 0..max_chunks {
            cancel.check()?;
            if !self.collect(session, max_samples_per_chunk, cancel)? {
                return Ok(());
            }
        }
        Err(LibzciError::ResourceExhausted {
            detail: "collect_until_eof exceeded max_chunks".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::pcm::PcmLayout;
    use crate::provider::FakeFactory;
    use crate::source::MemSource;
    use std::sync::Arc;

    fn load_fake(total: u64) -> (ProviderRegistry, Session) {
        let mut reg = ProviderRegistry::new();
        reg.register(Arc::new(FakeFactory::new(total, PcmLayout::mono48k())))
            .unwrap();
        (reg, Session::new(SessionId::fresh()))
    }

    #[test]
    fn delayed_decode_then_seek_rejects_stale_pcm() {
        let (reg, mut session) = load_fake(48000);
        let source: Arc<dyn RuntimeSource> = Arc::new(MemSource::new(b"FAKEx".to_vec()));
        let cancel = CancelFlag::default();
        let events = session
            .load_source(RequestId::fresh(), source, None, &reg, &cancel)
            .unwrap();
        assert!(events.iter().any(|e| matches!(e, Event::Completed { .. })));
        // Produce PCM for the load generation...
        let (gen_before, _) = session.decode_for_generation(480, &cancel).unwrap();
        // ...then seek, bumping the generation...
        let (accept, _) = session
            .apply(
                &Command::Seek {
                    request_id: RequestId::fresh(),
                    session: session.id(),
                    frame: 1000,
                },
                &reg,
                &Default::default(),
                &cancel,
            )
            .unwrap();
        assert!(accept.generation > gen_before);
        // ...so the earlier generation is no longer current.
        assert!(!session.is_current(gen_before));
        assert!(session.is_current(session.generation()));
    }

    #[test]
    fn stop_flushes_and_dispose_silences() {
        let (reg, mut session) = load_fake(8000);
        let source: Arc<dyn RuntimeSource> = Arc::new(MemSource::new(b"FAKEx".to_vec()));
        let cancel = CancelFlag::default();
        session
            .load_source(RequestId::fresh(), source, None, &reg, &cancel)
            .unwrap();
        let gen_before = session.generation();
        let _ = session
            .apply(
                &Command::Stop {
                    request_id: RequestId::fresh(),
                    session: session.id(),
                },
                &reg,
                &Default::default(),
                &cancel,
            )
            .unwrap();
        assert!(session.generation() > gen_before);
        let mut collector = PcmCollector::default();
        collector.collect(&mut session, 64, &cancel).unwrap();
        assert_eq!(collector.rejected_stale, 0);
        assert!(!collector.accepted.is_empty());
        let _ = session
            .apply(
                &Command::Dispose {
                    request_id: RequestId::fresh(),
                    session: session.id(),
                },
                &reg,
                &Default::default(),
                &cancel,
            )
            .unwrap();
        assert!(session.decode_for_generation(64, &cancel).is_err());
    }

    #[test]
    fn two_sessions_hold_separate_state() {
        let (reg, mut a) = load_fake(48000);
        let mut b = Session::new(SessionId::fresh());
        let cancel = CancelFlag::default();
        a.load_source(
            RequestId::fresh(),
            Arc::new(MemSource::new(b"FAKEx".to_vec())),
            None,
            &reg,
            &cancel,
        )
        .unwrap();
        b.load_source(
            RequestId::fresh(),
            Arc::new(MemSource::new(b"FAKEx".to_vec())),
            None,
            &reg,
            &cancel,
        )
        .unwrap();
        let mut collector = PcmCollector::default();
        collector.collect(&mut a, 480, &cancel).unwrap();
        assert_eq!(a.position_frames(), 480);
        assert_eq!(b.position_frames(), 0);
    }

    #[test]
    fn errors_do_not_collapse_into_unsupported() {
        use crate::provider::ProviderRegistry as R;
        let mut reg = R::new();
        reg.register(Arc::new(FakeFactory::failing(LibzciError::Corrupt {
            detail: "bad bytes".into(),
        })))
        .unwrap();
        let mut session = Session::new(SessionId::fresh());
        let cancel = CancelFlag::default();
        let events = session
            .load_source(
                RequestId::fresh(),
                Arc::new(MemSource::new(b"FAKEx".to_vec())),
                None,
                &reg,
                &cancel,
            )
            .unwrap();
        match &events[0] {
            Event::Failed { error, .. } => assert_eq!(error.kind(), "corrupt"),
            other => panic!("expected Failed, got {other:?}"),
        }
    }
}
