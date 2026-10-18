//! Browser engine: core-owned transport decisions over a feed-driven
//! host decoder.
//!
//! The decode worker owns the File bytes and the platform Opus decoder
//! (WebCodecs `AudioDecoder`); this engine owns everything else through
//! the same core types as native:
//!
//! - provider selection via [`ProviderRegistry`] and the centralized
//!   format policy (real sniff, magic outranks hints);
//! - per-session [`Session`] transport with generation fencing — a
//!   later seek/load bumps the generation and stale worker PCM is
//!   rejected, never rendered;
//! - authoritative [`Snapshot`]s and bounded [`Event`]s for the page.
//!
//! [`HostDecoder`] implements [`DecoderInstance`] over a shared state
//! cell: the decode worker's PCM is ingested with its generation, and
//! only current-generation PCM reaches the session. Seeks reset the
//! queue through the normal core seek path, so rapid seeks cannot leak
//! old PCM even across worker messages.
//!
//! JSON shapes emitted here are mirrored in
//! `consumers/crude-pwa/src/protocol.ts`. PCM itself never travels as
//! JSON: `ingest_pcm` takes raw `f32` slices (transferable
//! `Float32Array`s across the worker boundary).

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use crate::session_driver::WebSession as Session;
use libzci::{
    AppliedAdjustments, CancelFlag, ChannelLayout, DecoderInstance, Event, Generation, LibzciError,
    MemSource, OpusStreamParams, PcmLayout, ProviderFactory, ProviderId, ProviderInfo,
    ProviderMetadata, ProviderRegistry, RequestId, Result, RuntimeSource, SessionId, Snapshot,
};

// ---------------------------------------------------------------------------
// Browser Opus factory (probe + pending open; platform decodes packets)
// ---------------------------------------------------------------------------

/// Browser Opus provider identity (platform decode, core decisions).
pub const BROWSER_OPUS_VERSION: &str = "webcodecs-opus/p1";

fn browser_opus_info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId::OPUS,
        version: BROWSER_OPUS_VERSION,
        display_name: "Browser Opus",
    }
}

/// Factory selecting Ogg Opus by the same centralized sniff as native.
/// Opening binds header facts; packet decode stays on the platform
/// decoder in the decode worker and is fed back with generations.
///
/// The factory remembers the shared cell of the instance it most
/// recently opened so the engine can adopt it after
/// [`Session::load_source`] takes ownership (no downcast needed).
#[derive(Debug, Default)]
pub struct BrowserOpusFactory {
    last: Mutex<Option<Arc<Mutex<HostShared>>>>,
}

impl BrowserOpusFactory {
    /// Create (the engine keeps its own `Arc` to this factory).
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            last: Mutex::new(None),
        })
    }

    /// Take the shared cell of the most recently opened instance.
    pub fn take_last(&self) -> Option<Arc<Mutex<HostShared>>> {
        self.last.lock().unwrap().take()
    }
}

impl ProviderFactory for BrowserOpusFactory {
    fn info(&self) -> ProviderInfo {
        browser_opus_info()
    }

    fn probe(&self, input: &libzci::ProbeInput<'_>) -> libzci::ProbeScore {
        if libzci::sniff_opus_head_page(input.header).is_some() {
            libzci::ProbeScore::Magic
        } else {
            libzci::ProbeScore::No
        }
    }

    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        cancel.check()?;
        // Header-only sources suffice: the first 8 KiB hold OpusHead
        // plus OpusTags for every fixture and the synth.
        let mut header = vec![0u8; libzci::provider::PROBE_BYTES];
        let n = source.read_at(0, &mut header, cancel).unwrap_or(0);
        header.truncate(n);
        let params = header_params(&header)?;
        let decoder = HostDecoder::new_pending(params)?;
        *self.last.lock().unwrap() = Some(decoder.shared().clone());
        Ok(Box::new(decoder))
    }
}

/// Extract identification facts from header bytes (first page split).
fn header_params(header: &[u8]) -> Result<OpusStreamParams> {
    if header.len() < 28 || &header[0..4] != b"OggS" {
        return Err(LibzciError::Corrupt {
            detail: "not an Ogg page".into(),
        });
    }
    let seg_count = header[26] as usize;
    if header.len() < 27 + seg_count {
        return Err(LibzciError::Corrupt {
            detail: "truncated Ogg header".into(),
        });
    }
    let body = &header[27 + seg_count..];
    let lacing = &header[27..27 + seg_count];
    let mut carry = Vec::new();
    let packets = libzci::split_packets_with_carry(body, lacing, &mut carry, header[5])?;
    let first = packets.first().ok_or_else(|| LibzciError::Corrupt {
        detail: "missing OpusHead".into(),
    })?;
    libzci::parse_opus_head_packet(first)
}

// ---------------------------------------------------------------------------
// Feed-driven host decoder
// ---------------------------------------------------------------------------

/// Shared decoder state: the engine holds one `Arc`, the session's
/// [`HostDecoder`] holds the other. Index facts arrive asynchronously
/// from the decode worker's page scan; PCM arrives tagged with the
/// generation it was decoded for.
#[derive(Debug)]
pub struct HostShared {
    params: OpusStreamParams,
    layout: PcmLayout,
    /// Finite total once the page index commits (`None` while loading).
    pub total_frames: Option<u64>,
    /// Queued current-generation PCM (interleaved f32).
    queue: VecDeque<f32>,
    /// Next expected audible start frame (contiguity check).
    next_frame: u64,
    /// Current audible position.
    position_frames: u64,
    /// `true` after the worker reports end of stream for the current
    /// generation.
    eof: bool,
    /// Stale PCM refused after a seek/load (diagnostics).
    pub rejected_stale: u64,
    /// Generation the queued PCM belongs to.
    queued_generation: Option<Generation>,
}

impl HostShared {
    fn new(params: OpusStreamParams) -> Result<Arc<Mutex<Self>>> {
        params.check_supported()?;
        let layout = PcmLayout::new(
            if params.channels == 1 {
                ChannelLayout::Mono
            } else {
                ChannelLayout::Stereo
            },
            48_000,
        )?;
        Ok(Arc::new(Mutex::new(Self {
            params,
            layout,
            total_frames: None,
            queue: VecDeque::new(),
            next_frame: 0,
            position_frames: 0,
            eof: false,
            rejected_stale: 0,
            queued_generation: None,
        })))
    }
}

/// [`DecoderInstance`] over [`HostShared`].
pub struct HostDecoder {
    info: ProviderInfo,
    shared: Arc<Mutex<HostShared>>,
}

impl HostDecoder {
    /// Create in the pending (index-less) state.
    pub fn new_pending(params: OpusStreamParams) -> Result<Self> {
        Ok(Self {
            info: browser_opus_info(),
            shared: HostShared::new(params)?,
        })
    }

    /// Shared cell for the engine's index/ingest paths.
    pub fn shared(&self) -> &Arc<Mutex<HostShared>> {
        &self.shared
    }
}

impl DecoderInstance for HostDecoder {
    fn decode(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<libzci::DecodeStatus> {
        let n = self.decode_into(out, cancel)?;
        if n > 0 {
            Ok(libzci::DecodeStatus::Data(n))
        } else if self.shared.lock().unwrap().eof {
            Ok(libzci::DecodeStatus::EndOfStream)
        } else {
            Ok(libzci::DecodeStatus::Pending)
        }
    }

    fn info(&self) -> ProviderInfo {
        self.info
    }

    fn layout(&self) -> PcmLayout {
        self.shared.lock().unwrap().layout
    }

    fn total_frames(&self) -> Option<u64> {
        self.shared.lock().unwrap().total_frames
    }

    fn position_frames(&self) -> u64 {
        self.shared.lock().unwrap().position_frames
    }

    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        let mut shared = self.shared.lock().unwrap();
        let mut written = 0;
        while written < out.len() {
            match shared.queue.pop_front() {
                Some(s) => {
                    out[written] = s;
                    written += 1;
                }
                None => break,
            }
        }
        shared.position_frames += written as u64 / shared.layout.layout.channels() as u64;
        Ok(written)
    }

    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        let mut shared = self.shared.lock().unwrap();
        let target = match shared.total_frames {
            Some(total) => frame.min(total),
            None => frame,
        };
        shared.queue.clear();
        shared.position_frames = target;
        shared.next_frame = target;
        shared.eof = false;
        shared.queued_generation = None;
        Ok(target)
    }

    fn metadata(&self) -> ProviderMetadata {
        let shared = self.shared.lock().unwrap();
        ProviderMetadata {
            info: self.info,
            layout: shared.layout,
            total_frames: shared.total_frames,
            applied: AppliedAdjustments {
                trimmed_preskip: true,
                trimmed_end: true,
                applied_header_gain: true,
            },
            declared_channels: shared.params.channels as u16,
            comments: Vec::new(),
        }
    }
}

// SAFETY: all state lives behind the mutex; the decoder is driven
// through `&mut self` on the engine worker.
unsafe impl Send for HostDecoder {}

// ---------------------------------------------------------------------------
// Engine facade
// ---------------------------------------------------------------------------

/// Planned decode start for a seek target: the single seek
/// implementation (mirrors `OpusInstance::seek_aligned`). The decode
/// worker executes it without granule math of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeekPlan {
    /// Page index to load first (`pages.len()` means immediate EOF).
    pub start_page: usize,
    /// Header packets to drain when `start_page` is the audio-start page.
    pub skip_packets: usize,
    /// Decoded samples to discard from the start page onward
    /// (preskip/preroll window).
    pub skip_samples: u64,
}

/// Compute [`SeekPlan`] for an Ogg Opus index.
pub fn plan_opus_seek(
    pages: &[libzci::PageEntry],
    audio_start_page: usize,
    audio_start_packet: usize,
    preskip: u64,
    total: u64,
    target: u64,
) -> Result<SeekPlan> {
    let target = target.min(total);
    let granule_target = target + preskip;
    let mut found: Option<(usize, u64)> = None;
    let mut prev_valid = 0u64;
    for (i, page) in pages.iter().enumerate() {
        if page.granule != libzci::GRANULE_NONE {
            if page.granule > granule_target {
                found = Some((i, prev_valid));
                break;
            }
            prev_valid = page.granule;
        }
    }
    match found {
        None => Ok(SeekPlan {
            start_page: pages.len(),
            skip_packets: 0,
            skip_samples: 0,
        }),
        Some((mut start, prev)) => {
            while start > audio_start_page && pages[start].header_type & 0x01 != 0 {
                start -= 1;
            }
            Ok(SeekPlan {
                start_page: start,
                skip_packets: if start == audio_start_page {
                    audio_start_packet
                } else {
                    0
                },
                skip_samples: granule_target.saturating_sub(prev),
            })
        }
    }
}

/// Browser module factory: probes with the same centralized sniff
/// as native; opening waits on the Emscripten provider modules
/// (pending: no `emcc` in this environment). The failure is an
/// explicit visible `Unsupported`, never a demo decoder or a second
/// JS player.
#[derive(Debug, Default)]
pub struct BrowserModuleFactory;

impl ProviderFactory for BrowserModuleFactory {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ProviderId::OPENMPT,
            version: "libopenmpt-0.8.4/p1-browser-pending",
            display_name: "Browser libopenmpt",
        }
    }

    fn probe(&self, input: &libzci::ProbeInput<'_>) -> libzci::ProbeScore {
        match libzci::sniff_module_family(input.header) {
            Some(libzci::ModuleFamily::Openmpt) => libzci::ProbeScore::Magic,
            _ => libzci::ProbeScore::No,
        }
    }

    fn open(
        &self,
        _source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        cancel.check()?;
        Err(LibzciError::Unsupported {
            detail: "browser libopenmpt module not yet built (pending Emscripten toolchain)".into(),
        })
    }
}

/// Browser Hively factory: same terms as [`BrowserModuleFactory`].
#[derive(Debug, Default)]
pub struct BrowserHivelyFactory;

impl ProviderFactory for BrowserHivelyFactory {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ProviderId::HIVELY,
            version: "hivelytracker-f393ca7/p1-browser-pending",
            display_name: "Browser Hively",
        }
    }

    fn probe(&self, input: &libzci::ProbeInput<'_>) -> libzci::ProbeScore {
        match libzci::sniff_module_family(input.header) {
            Some(libzci::ModuleFamily::Hively(_)) => libzci::ProbeScore::Magic,
            _ => libzci::ProbeScore::No,
        }
    }

    fn open(
        &self,
        _source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        cancel.check()?;
        Err(LibzciError::Unsupported {
            detail: "browser hively module not yet built (pending Emscripten toolchain)".into(),
        })
    }
}

/// One browser engine: registry, sessions, and the shared decoder
/// cells. File bytes stay in the decode worker; only bounded
/// header/index/PCM messages cross.
pub struct Engine {
    factory: Arc<BrowserOpusFactory>,
    registry: ProviderRegistry,
    sessions: HashMap<SessionId, Session>,
    shared: HashMap<SessionId, Arc<Mutex<HostShared>>>,
    /// Retained page indexes for seek planning (engine-owned).
    pages: HashMap<SessionId, Vec<libzci::PageEntry>>,
    /// Retained audio-start facts per session.
    audio_start: HashMap<SessionId, (usize, usize)>,
    cancel: CancelFlag,
}

impl Default for Engine {
    fn default() -> Self {
        let factory = BrowserOpusFactory::new();
        let mut registry = ProviderRegistry::new();
        registry
            .register(factory.clone())
            .expect("fresh registry accepts browser opus");
        registry
            .register(Arc::new(BrowserModuleFactory))
            .expect("fresh registry accepts browser modules");
        registry
            .register(Arc::new(BrowserHivelyFactory))
            .expect("fresh registry accepts browser hively");
        Self {
            factory,
            registry,
            sessions: HashMap::new(),
            shared: HashMap::new(),
            pages: HashMap::new(),
            audio_start: HashMap::new(),
            cancel: CancelFlag::default(),
        }
    }
}

impl Engine {
    /// Create with the browser Opus provider registered.
    pub fn new() -> Self {
        Self::default()
    }

    /// Registered provider IDs (diagnostics).
    pub fn provider_ids(&self) -> Vec<ProviderId> {
        self.registry.provider_ids()
    }

    /// Create one idle session.
    pub fn create_session(&mut self) -> SessionId {
        let id = SessionId::fresh();
        self.sessions.insert(id, Session::new(id));
        id
    }

    /// Open a session on header bytes supplied by the decode worker
    /// (bounded: the worker sends at most `PROBE_BYTES`). Returns the
    /// session snapshot after selection.
    pub fn open_header(
        &mut self,
        session: SessionId,
        header: Vec<u8>,
        extension_hint: Option<&str>,
    ) -> Result<Snapshot> {
        let source: Arc<dyn RuntimeSource> = Arc::new(MemSource::new(header));
        let session_ref =
            self.sessions
                .get_mut(&session)
                .ok_or_else(|| LibzciError::InvalidArgument {
                    detail: "unknown session".into(),
                })?;
        let events = session_ref.load_source(
            RequestId::fresh(),
            source,
            extension_hint,
            &self.registry,
            &self.cancel,
        )?;
        let failed = events.iter().find_map(|e| match e {
            Event::Failed { error, .. } => Some(error.clone()),
            _ => None,
        });
        if let Some(error) = failed {
            return Err(error);
        }
        let shared = self
            .factory
            .take_last()
            .ok_or_else(|| LibzciError::DecoderFailure {
                detail: "browser factory opened nothing".into(),
            })?;
        self.shared.insert(session, shared);
        Ok(session_ref.snapshot())
    }

    /// Look up the shared decoder cell for index/ingest paths.
    fn shared_for(&self, session: SessionId) -> Result<Arc<Mutex<HostShared>>> {
        self.shared
            .get(&session)
            .cloned()
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "session has no shared decoder cell".into(),
            })
    }

    /// Commit a scanned page index: validate with the shared core rule,
    /// cross-check the worker's header parse against the engine's own
    /// (core is authoritative), derive the audible total, and publish
    /// it to the decoder cell. Returns `(total_frames, audio_start_page,
    /// audio_start_packet)`.
    pub fn commit_index(
        &mut self,
        session: SessionId,
        pages: Vec<libzci::PageEntry>,
        audio_start_page: usize,
        audio_start_packet: usize,
        reported_preskip: u64,
        reported_channels: u8,
    ) -> Result<(u64, usize, usize)> {
        libzci::validate_ogg_index(&pages)?;
        let shared = self.shared_for(session)?;
        let total = {
            let guard = shared.lock().unwrap();
            if reported_preskip != guard.params.preskip
                || reported_channels != guard.params.channels
            {
                return Err(LibzciError::DecoderFailure {
                    detail: format!(
                        "worker/core header mismatch: worker preskip {reported_preskip}/ch {reported_channels} vs core {}/{}",
                        guard.params.preskip, guard.params.channels
                    ),
                });
            }
            pages
                .iter()
                .rev()
                .find(|p| p.granule != libzci::GRANULE_NONE)
                .map(|p| p.granule.saturating_sub(guard.params.preskip))
                .ok_or_else(|| LibzciError::Corrupt {
                    detail: "no Ogg granule position".into(),
                })?
        };
        shared.lock().unwrap().total_frames = Some(total);
        self.pages.insert(session, pages);
        self.audio_start
            .insert(session, (audio_start_page, audio_start_packet));
        Ok((total, audio_start_page, audio_start_packet))
    }

    /// Plan a decode start for `target` on a committed index. Pure
    /// engine decision; the worker executes the returned plan.
    pub fn plan_seek(&self, session: SessionId, target: u64) -> Result<(SeekPlan, u64)> {
        let pages = self
            .pages
            .get(&session)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "session has no committed index".into(),
            })?;
        let (audio_page, audio_packet) =
            self.audio_start.get(&session).copied().ok_or_else(|| {
                LibzciError::InvalidArgument {
                    detail: "session has no committed index".into(),
                }
            })?;
        let shared = self.shared_for(session)?;
        let guard = shared.lock().unwrap();
        let total = guard
            .total_frames
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "index not committed".into(),
            })?;
        let preskip = guard.params.preskip;
        drop(guard);
        Ok((
            plan_opus_seek(pages, audio_page, audio_packet, preskip, total, target)?,
            total,
        ))
    }

    /// Ingest worker PCM tagged with its generation. Stale generations
    /// are refused (counted, never queued). Accepted PCM is pumped
    /// through the core session immediately so snapshots observe
    /// decoded position without a UI timer driving transport. Returns
    /// `(accepted_frames, position_frames)`.
    pub fn ingest_pcm(
        &mut self,
        session: SessionId,
        generation: Generation,
        start_frame: u64,
        samples: Vec<f32>,
    ) -> Result<(u64, u64)> {
        let accepted = {
            let session_ref =
                self.sessions
                    .get(&session)
                    .ok_or_else(|| LibzciError::InvalidArgument {
                        detail: "unknown session".into(),
                    })?;
            let shared = self.shared_for(session)?;
            let mut guard = shared.lock().unwrap();
            if !session_ref.is_current(generation) {
                guard.rejected_stale += 1;
                return Err(LibzciError::Cancelled);
            }
            match guard.queued_generation {
                Some(g) if g != generation => {
                    guard.rejected_stale += 1;
                    return Err(LibzciError::Cancelled);
                }
                _ => {}
            }
            if start_frame != guard.next_frame {
                return Err(LibzciError::DecoderFailure {
                    detail: format!(
                        "noncontiguous worker pcm: start {start_frame}, expected {}",
                        guard.next_frame
                    ),
                });
            }
            let channels = guard.layout.layout.channels() as usize;
            if samples.len() % channels != 0 {
                return Err(LibzciError::DecoderFailure {
                    detail: "worker pcm not a multiple of channel count".into(),
                });
            }
            if samples.iter().any(|s| !s.is_finite()) {
                return Err(LibzciError::DecoderFailure {
                    detail: "non-finite worker pcm".into(),
                });
            }
            // End-trim against a committed total: the platform decoder may
            // run past the granule on the final packet. Samples at or past
            // the total are dropped (never queued as stale-visible audio).
            let mut samples = samples;
            if let Some(total) = guard.total_frames {
                if start_frame >= total {
                    return Ok((0, guard.position_frames));
                }
                let keep_frames = (total - start_frame) as usize;
                samples.truncate(keep_frames * channels);
            }
            guard.next_frame += samples.len() as u64 / channels as u64;
            guard.queued_generation = Some(generation);
            let frames = samples.len() as u64 / channels as u64;
            guard.queue.extend(samples);
            frames
        };
        let position = self.pump_session(session, usize::MAX)?;
        Ok((accepted, position))
    }

    /// Pump queued PCM through the core session; returns the session
    /// position afterwards.
    fn pump_session(&mut self, session: SessionId, max_samples: usize) -> Result<u64> {
        let session_ref =
            self.sessions
                .get_mut(&session)
                .ok_or_else(|| LibzciError::InvalidArgument {
                    detail: "unknown session".into(),
                })?;
        let (generation, _) = session_ref.decode_for_generation(max_samples, &self.cancel)?;
        if !session_ref.is_current(generation) {
            return Err(LibzciError::Cancelled);
        }
        Ok(session_ref.position_frames())
    }

    /// Note end of stream for a generation (stale notes are ignored).
    /// Drains the remaining queue through the core session so position
    /// reaches the total without a UI timer driving transport.
    pub fn note_eof(&mut self, session: SessionId, generation: Generation) -> Result<bool> {
        let current = {
            let session_ref =
                self.sessions
                    .get(&session)
                    .ok_or_else(|| LibzciError::InvalidArgument {
                        detail: "unknown session".into(),
                    })?;
            session_ref.is_current(generation)
        };
        if !current {
            return Ok(false);
        }
        let shared = self.shared_for(session)?;
        shared.lock().unwrap().eof = true;
        // Drain through the session; an empty final chunk with Playing
        // state transitions to Ended in core.
        loop {
            let has_work = {
                let guard = shared.lock().unwrap();
                !guard.queue.is_empty()
            };
            if !has_work {
                break;
            }
            self.pump_session(session, usize::MAX)?;
        }
        Ok(true)
    }

    /// Pump decoded PCM through the core session (position/state stay
    /// core-owned). Returns `Ok(None)` when no data is ready and the
    /// stream has not ended (pending, not EOF). The display timer may
    /// call this to refresh meters; transport never depends on it
    /// (ingest/note_eof already pump).
    pub fn pump(
        &mut self,
        session: SessionId,
        max_samples: usize,
    ) -> Result<Option<(Generation, u64)>> {
        let shared = self.shared_for(session)?;
        let generation = {
            let session_ref =
                self.sessions
                    .get(&session)
                    .ok_or_else(|| LibzciError::InvalidArgument {
                        detail: "unknown session".into(),
                    })?;
            session_ref.generation()
        };
        let has_work = {
            let guard = shared.lock().unwrap();
            !guard.queue.is_empty() || guard.eof
        };
        if !has_work {
            return Ok(None);
        }
        let position = self.pump_session(session, max_samples)?;
        Ok(Some((generation, position)))
    }

    /// Current snapshot for the page.
    pub fn snapshot(&self, session: SessionId) -> Result<Snapshot> {
        self.sessions
            .get(&session)
            .map(Session::snapshot)
            .ok_or_else(|| LibzciError::InvalidArgument {
                detail: "unknown session".into(),
            })
    }

    /// Submit play/pause/stop/seek through the core session. Seeks
    /// reset the shared queue through the normal seek path; the caller
    /// forwards the new generation to the decode worker. Returns `None`
    /// as the snapshot after dispose (the session is gone by design).
    pub fn command(
        &mut self,
        session: SessionId,
        kind: EngineCommand,
    ) -> Result<(libzci::CommandAccept, Vec<Event>, Option<Snapshot>)> {
        let request = RequestId::fresh();
        let command = match kind {
            EngineCommand::Play => libzci::Command::Play {
                request_id: request,
                session,
            },
            EngineCommand::Pause => libzci::Command::Pause {
                request_id: request,
                session,
            },
            EngineCommand::Stop => libzci::Command::Stop {
                request_id: request,
                session,
            },
            EngineCommand::Seek { frame } => libzci::Command::Seek {
                request_id: request,
                session,
                time: libzci::MediaTime::from_frames(
                    frame,
                    self.sessions
                        .get(&session)
                        .and_then(|s| s.snapshot().layout)
                        .map_or(48_000, |l| l.sample_rate),
                ),
            },
            EngineCommand::Dispose => libzci::Command::Dispose {
                request_id: request,
                session,
            },
        };
        // Empty registry/sources: only Load consults them, and loads go
        // through open_header, never this path.
        let registry = ProviderRegistry::new();
        let sources = HashMap::new();
        let session_ref =
            self.sessions
                .get_mut(&session)
                .ok_or_else(|| LibzciError::InvalidArgument {
                    detail: "unknown session".into(),
                })?;
        let (accept, events) = session_ref.apply(&command, &registry, &sources, &self.cancel)?;
        if matches!(kind, EngineCommand::Dispose) {
            self.sessions.remove(&session);
            self.shared.remove(&session);
            self.pages.remove(&session);
            self.audio_start.remove(&session);
            return Ok((accept, events, None));
        }
        let snapshot = self.sessions.get(&session).map(Session::snapshot);
        Ok((accept, events, snapshot))
    }
}

/// Engine-level command kinds (the worker protocol mirrors these).
#[derive(Clone, Copy, Debug)]
pub enum EngineCommand {
    /// Start or resume output.
    Play,
    /// Pause output, retaining position.
    Pause,
    /// Stop and park at the start.
    Stop,
    /// Seek to an absolute provider-timeline frame.
    Seek {
        /// Target frame.
        frame: u64,
    },
    /// Dispose the session.
    Dispose,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_bytes(rel: &str) -> Vec<u8> {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/libzci/media/r3")
            .join(rel);
        std::fs::read(&path).unwrap_or_else(|_| {
            panic!(
                "missing fixture {} — run `python libzci/tests/generate-r3-media.py` first",
                path.display()
            )
        })
    }

    fn open_engine(header: &[u8]) -> (Engine, SessionId) {
        let mut engine = Engine::new();
        let session = engine.create_session();
        let snapshot = engine
            .open_header(session, header.to_vec(), Some("opus"))
            .expect("open header");
        assert_eq!(snapshot.provider.map(|p| p.id), Some(ProviderId::OPUS));
        (engine, session)
    }

    fn full_header() -> Vec<u8> {
        let bytes = fixture_bytes("mono.opus");
        bytes[..bytes.len().min(libzci::provider::PROBE_BYTES)].to_vec()
    }

    #[test]
    fn probe_selects_browser_opus() {
        let engine = Engine::new();
        assert_eq!(
            engine.provider_ids(),
            vec![ProviderId::OPUS, ProviderId::OPENMPT, ProviderId::HIVELY]
        );
    }

    #[test]
    fn browser_module_opens_stay_visibly_pending() {
        let mut probe_registry = ProviderRegistry::new();
        probe_registry
            .register(Arc::new(BrowserModuleFactory))
            .unwrap();
        probe_registry
            .register(Arc::new(BrowserHivelyFactory))
            .unwrap();
        // Minimal MOD magic: the module factory claims it by sniff, then
        // reports the pending Emscripten build instead of decoding.
        let mut header = vec![0u8; 1084];
        header[1080..1084].copy_from_slice(b"M.K.");
        let cancel = CancelFlag::default();
        match probe_registry.open_best(Arc::new(MemSource::new(header)), Some("mod"), &cancel) {
            Err(e) => assert_eq!(e.kind(), "unsupported"),
            Ok(_) => panic!("expected Unsupported, opened successfully"),
        }
    }

    #[test]
    fn stale_ingest_is_rejected_after_seek() {
        let (mut engine, session) = open_engine(&full_header());
        let gen0 = engine.snapshot(session).unwrap().generation;
        // Ingest current-generation PCM.
        let (accepted, _) = engine
            .ingest_pcm(session, gen0, 0, vec![0.1, -0.1, 0.2, -0.2])
            .unwrap();
        assert_eq!(accepted, 4);
        // Seek bumps the generation through the core path...
        let (accept, _, _) = engine
            .command(session, EngineCommand::Seek { frame: 2 })
            .unwrap();
        assert!(accept.generation > gen0);
        // ...so late PCM for the old generation is refused, never queued.
        assert_eq!(
            engine
                .ingest_pcm(session, gen0, 4, vec![0.5; 4])
                .unwrap_err()
                .kind(),
            "cancelled"
        );
        // And the new generation is contiguous from the seek target.
        let (accepted, position) = engine
            .ingest_pcm(session, accept.generation, 2, vec![0.0; 8])
            .unwrap();
        assert_eq!(accepted, 8);
        assert_eq!(position, 2); // Decoding alone cannot advance audible position.
    }

    #[test]
    fn noncontiguous_ingest_is_a_decoder_failure() {
        let (mut engine, session) = open_engine(&full_header());
        let gen = engine.snapshot(session).unwrap().generation;
        let err = engine
            .ingest_pcm(session, gen, 96, vec![0.0; 4])
            .unwrap_err();
        assert_eq!(err.kind(), "decoder-failure");
    }

    #[test]
    fn eof_for_stale_generation_is_ignored() {
        let (mut engine, session) = open_engine(&full_header());
        let gen0 = engine.snapshot(session).unwrap().generation;
        let (_, _, _) = engine
            .command(session, EngineCommand::Seek { frame: 0 })
            .unwrap();
        assert!(!engine.note_eof(session, gen0).unwrap());
    }

    #[test]
    fn dispose_drops_the_session() {
        let (mut engine, session) = open_engine(&full_header());
        let (_, _, snapshot) = engine.command(session, EngineCommand::Dispose).unwrap();
        assert!(snapshot.is_none());
        assert!(engine.snapshot(session).is_err());
    }

    fn scan_pages(bytes: &[u8]) -> (Vec<libzci::PageEntry>, usize, usize) {
        use libzci::{MemSource, PageScanner, RuntimeSource};
        use std::sync::Arc;
        let source: Arc<dyn RuntimeSource> = Arc::new(MemSource::new(bytes.to_vec()));
        let cancel = CancelFlag::default();
        let scanner = PageScanner::new(&source, &cancel);
        let mut pages = Vec::new();
        let mut offset = 0u64;
        while let Some(entry) = scanner.read_page_entry(offset).unwrap() {
            offset = entry.offset + entry.header_len + entry.body_len;
            pages.push(entry);
        }
        // Count exactly two header packets for the audio start.
        let mut carry = Vec::new();
        let mut headers = 0usize;
        let mut audio_page = 0usize;
        let mut audio_packet = 0usize;
        for (i, page) in pages.iter().enumerate() {
            let body = scanner
                .read_at(page.offset + page.header_len, page.body_len as usize)
                .unwrap();
            let lacing = scanner
                .read_at(page.offset + 27, (page.header_len - 27) as usize)
                .unwrap();
            let packets =
                libzci::split_packets_with_carry(&body, &lacing, &mut carry, page.header_type)
                    .unwrap();
            let mut consumed = 0usize;
            for packet in &packets {
                if headers < 2 {
                    // Validate through the shared core policy.
                    if headers == 0 {
                        libzci::parse_opus_head_packet(packet).unwrap();
                    } else {
                        libzci::parse_opus_tags_packet(packet).unwrap();
                    }
                    headers += 1;
                    consumed += 1;
                } else {
                    break;
                }
            }
            if headers >= 2 {
                audio_page = i;
                audio_packet = consumed;
                if audio_packet >= packets.len() {
                    // Headers exactly fill the page: audio starts on the
                    // next page (normalized so loaders skip by count).
                    audio_page = i + 1;
                    audio_packet = 0;
                }
                break;
            }
        }
        assert_eq!(headers, 2);
        (pages, audio_page, audio_packet)
    }

    #[test]
    fn seek_plans_match_native_math() {
        let bytes = fixture_bytes("mono.opus");
        let (pages, audio_page, audio_packet) = scan_pages(&bytes);
        // R3 mono fixture: headers on pages 0-1, all audio on page 2.
        assert_eq!((audio_page, audio_packet), (2, 0));
        let preskip = 312u64;
        let total = pages
            .iter()
            .rev()
            .find(|p| p.granule != libzci::GRANULE_NONE)
            .map(|p| p.granule - preskip)
            .unwrap();
        assert_eq!(total, 12006);
        // From the top: start at the audio page, discard preskip.
        assert_eq!(
            plan_opus_seek(&pages, audio_page, audio_packet, preskip, total, 0).unwrap(),
            SeekPlan {
                start_page: 2,
                skip_packets: 0,
                skip_samples: 312
            }
        );
        // Mid-stream on the same single audio page.
        assert_eq!(
            plan_opus_seek(&pages, audio_page, audio_packet, preskip, total, 6000).unwrap(),
            SeekPlan {
                start_page: 2,
                skip_packets: 0,
                skip_samples: 6312
            }
        );
        // At/past the end: immediate EOF plan.
        assert_eq!(
            plan_opus_seek(&pages, audio_page, audio_packet, preskip, total, total).unwrap(),
            SeekPlan {
                start_page: pages.len(),
                skip_packets: 0,
                skip_samples: 0
            }
        );
    }

    #[test]
    fn commit_then_plan_round_trip() {
        let bytes = fixture_bytes("mono.opus");
        let (pages, audio_page, audio_packet) = scan_pages(&bytes);
        let (mut engine, session) =
            open_engine(&bytes[..bytes.len().min(libzci::provider::PROBE_BYTES)]);
        let (total, _, _) = engine
            .commit_index(session, pages, audio_page, audio_packet, 312, 1)
            .unwrap();
        assert_eq!(total, 12006);
        let (plan, planned_total) = engine.plan_seek(session, 1000).unwrap();
        assert_eq!(planned_total, 12006);
        assert_eq!(plan.start_page, 2);
        assert_eq!(plan.skip_samples, 1312);
        // Header mismatch is a decoder failure, not silent acceptance.
        let bytes2 = fixture_bytes("mono.opus");
        let (pages2, _, _) = scan_pages(&bytes2);
        let err = engine
            .commit_index(session, pages2, 2, 0, 999, 1)
            .unwrap_err();
        assert_eq!(err.kind(), "decoder-failure");
    }
}
