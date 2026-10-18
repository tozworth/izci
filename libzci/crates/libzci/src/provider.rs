//! Provider registration and decoder instances.
//!
//! A registry holds factories; each `open` returns an independent
//! instance. Both whole-source providers (module replay from a bounded
//! buffer) and packet providers (streaming demux plus per-packet
//! decode) implement the same instance contract without a fake common
//! demux layer: probing decides, `open` binds exactly one source, and
//! every result carries the timeline the session uses for generation
//! fencing.
//!
//! Production commands never report success using the test-only
//! [`FakeProvider`]; it exists so session/generation logic can be
//! exercised before the first real codec lands in Phase 1.2.

use std::collections::HashMap;
use std::sync::Arc;

use crate::audio::pcm::{ChannelLayout, PcmChunk, PcmLayout};
use crate::error::{LibzciError, Result};
use crate::source::{CancelFlag, RuntimeSource};

/// Static identity for one provider implementation.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct ProviderId(pub &'static str);

impl ProviderId {
    /// Well-known test provider (tests only).
    pub const FAKE: Self = Self("test.fake");
    /// Reference Opus provider (Phase 1.2).
    pub const OPUS: Self = Self("org.xiph.opus");
    /// Tracker-module provider (Phase 1.4).
    pub const OPENMPT: Self = Self("org.openmpt.libopenmpt");
    /// Hively provider (Phase 1.4).
    pub const HIVELY: Self = Self("hivelytracker.replay");
}

/// What a provider declares at registration.
#[derive(Clone, Copy, Debug)]
pub struct ProviderInfo {
    /// Stable provider ID.
    pub id: ProviderId,
    /// Provider implementation version (codec/library version).
    pub version: &'static str,
    /// Short human-readable name for diagnostics.
    pub display_name: &'static str,
}

impl ProviderInfo {
    /// Human `id/version` pair for diagnostics and PCM provenance.
    pub fn id_version(&self) -> String {
        format!("{}/{:?}", self.display_name, self.version)
    }
}

/// How strongly a factory claims an input during probing.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum ProbeScore {
    /// Decline: do not select this provider.
    No = 0,
    /// Accept by extension hint only (weak).
    Hint = 1,
    /// Accept by sniffed bytes (strong).
    Magic = 2,
}

/// Bounded probe input: first bytes plus extension hint.
pub struct ProbeInput<'a> {
    /// Up to the first N bytes of the source (providers must not
    /// require more than offered here during probing).
    pub header: &'a [u8],
    /// Lowercase extension without dot (`"opus"`, `"mod"`), if known.
    /// Hints only; sniffed content decides.
    pub extension_hint: Option<&'a str>,
    /// Declared full-buffer requirement of the source.
    pub requires_full_buffer: bool,
}

/// Trim/gain already applied by the provider, declared so later stages
/// apply each rule exactly once.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct AppliedAdjustments {
    /// Container pre-skip / codec delay discarded.
    pub trimmed_preskip: bool,
    /// End trimming applied.
    pub trimmed_end: bool,
    /// Mandatory header/output gain applied (opusfile-style mode with
    /// zero additional offset for Opus).
    pub applied_header_gain: bool,
}

/// Basic stream facts reported without creating audio output.
#[derive(Clone, Debug)]
pub struct ProviderMetadata {
    /// Provider that opened the source.
    pub info: ProviderInfo,
    /// Output layout (normalized float PCM).
    pub layout: PcmLayout,
    /// Total frames on the normalized audible timeline, when finite.
    pub total_frames: Option<u64>,
    /// Container trims/gains already applied.
    pub applied: AppliedAdjustments,
    /// Declared channel count from the container.
    pub declared_channels: u16,
    pub comments: Vec<(String, String)>,
}

impl ProviderMetadata {
    /// Audible duration in seconds, when the total is finite.
    pub fn duration_secs(&self) -> Option<f64> {
        self.total_frames
            .map(|f| f as f64 / self.layout.sample_rate as f64)
    }
}

/// One independent opened decoder.
///
/// Instances are `Send` but not `Sync`: the owning session drives one
/// instance at a time on its decode job, while a second session drives
/// its own instance concurrently.
pub trait DecoderInstance: Send {
    /// Temporary starvation is distinct from EOF; async providers override this.
    fn decode(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<DecodeStatus> {
        match self.decode_into(out, cancel)? {
            0 => Ok(DecodeStatus::EndOfStream),
            n => Ok(DecodeStatus::Data(n)),
        }
    }
    fn capabilities(&self) -> ModuleCapabilities {
        ModuleCapabilities::default()
    }
    fn module_control(
        &mut self,
        _control: crate::command::ModuleControl,
        _cancel: &CancelFlag,
    ) -> Result<()> {
        Err(LibzciError::Unsupported {
            detail: "provider has no module controls".into(),
        })
    }

    /// Static provider identity.
    fn info(&self) -> ProviderInfo;
    /// Normalized output layout.
    fn layout(&self) -> PcmLayout;
    /// Finite total on the audible timeline, if known.
    fn total_frames(&self) -> Option<u64>;
    /// Current position in frames on that timeline.
    fn position_frames(&self) -> u64;
    /// Decode up to `out.len()` interleaved samples into `out`.
    /// Returns the number of samples written (`0` at EOF).
    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize>;
    /// Seek to an absolute frame; returns the landed frame.
    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64>;
    /// Metadata snapshot (no audio output created).
    fn metadata(&self) -> ProviderMetadata;
}

/// Factory side of a provider: probing plus independent `open`.
pub trait ProviderFactory: Send + Sync {
    /// Static identity.
    fn info(&self) -> ProviderInfo;
    /// Score an input without opening it or creating audio output.
    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore;
    /// Open an independent instance bound to exactly one source.
    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>>;
}

/// Ordered registry of provider factories.
///
/// Selection prefers the highest probe score in registration order;
/// ties keep the earlier registration. Extension hints never
/// outrank sniffed magic.
#[derive(Clone)]
pub struct ProviderRegistry {
    factories: Vec<Arc<dyn ProviderFactory>>,
    /// Observable budget: maximum simultaneous open instances the
    /// tests may assert against.
    pub max_open_instances: usize,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self {
            factories: Vec::new(),
            max_open_instances: 16,
        }
    }
}

impl ProviderRegistry {
    /// Empty registry (callers register real providers).
    pub fn new() -> Self {
        Self::default()
    }

    /// Register one factory. Duplicate IDs are rejected.
    pub fn register(&mut self, factory: Arc<dyn ProviderFactory>) -> Result<()> {
        let id = factory.info().id;
        if self.factories.iter().any(|f| f.info().id == id) {
            return Err(LibzciError::InvalidArgument {
                detail: format!("duplicate provider {:?}", id.0),
            });
        }
        self.factories.push(factory);
        Ok(())
    }

    /// Registered provider IDs in order.
    pub fn provider_ids(&self) -> Vec<ProviderId> {
        self.factories.iter().map(|f| f.info().id).collect()
    }

    /// Probe all factories and open the winner.
    ///
    /// Reads at most [`PROBE_BYTES`] from the source start for the
    /// probe header; the header read honors cancellation and bounded
    /// access. Module-style full-buffer sources are still only probed
    /// from their header here; the winning `open` performs its own
    /// bounded full read against the declared maximum.
    pub fn open_best(
        &self,
        source: Arc<dyn RuntimeSource>,
        extension_hint: Option<&str>,
        cancel: &CancelFlag,
    ) -> Result<(ProviderInfo, Box<dyn DecoderInstance>)> {
        cancel.check()?;
        let mut header = vec![0u8; PROBE_BYTES];
        let n = match source.read_at(0, &mut header, cancel) {
            Ok(n) => n,
            Err(LibzciError::Cancelled) => return Err(LibzciError::Cancelled),
            Err(e) => return Err(e),
        };
        header.truncate(n);
        let input = ProbeInput {
            header: &header,
            extension_hint,
            requires_full_buffer: source.caps().requires_full_buffer,
        };
        let mut best: Option<(ProbeScore, Arc<dyn ProviderFactory>)> = None;
        for factory in &self.factories {
            let score = factory.probe(&input);
            if score == ProbeScore::No {
                continue;
            }
            let replace = match &best {
                None => true,
                Some((s, _)) => score > *s,
            };
            if replace {
                best = Some((score, Arc::clone(factory)));
            }
        }
        let (_, factory) = best.ok_or_else(|| LibzciError::Unsupported {
            detail: "no provider claimed the source".into(),
        })?;
        let info = factory.info();
        let instance = factory.open(source, cancel)?;
        Ok((info, instance))
    }
}

/// Maximum header bytes offered to `probe`.
pub const PROBE_BYTES: usize = 8192;

/// Upper bound for one `decode_into` call in the device-free
/// collector and tests (1M samples ≈ 10s stereo at 48kHz).
pub const MAX_DECODE_SAMPLES: usize = 1 << 20;

/// Decode through an instance into one validated [`PcmChunk`].
pub fn decode_chunk(
    instance: &mut dyn DecoderInstance,
    layout: PcmLayout,
    start_frame: u64,
    max_samples: usize,
    cancel: &CancelFlag,
) -> Result<PcmChunk> {
    let max_samples = max_samples.min(MAX_DECODE_SAMPLES);
    let mut frames = vec![0.0f32; max_samples];
    let n = instance.decode_into(&mut frames, cancel)?;
    frames.truncate(n);
    let chunk = PcmChunk {
        layout,
        start_frame,
        frames,
    };
    chunk.validate()?;
    Ok(chunk)
}

// ---------------------------------------------------------------------------
// Test-only fake provider
// ---------------------------------------------------------------------------

/// Factory ID for the fake (see [`ProviderId::FAKE`]).
#[derive(Debug)]
pub struct FakeFactory {
    info: ProviderInfo,
    /// Frames the fake pretends the source contains.
    pub total_frames: u64,
    /// Layout the fake reports.
    pub layout: PcmLayout,
    /// Error to return from `open`, if any.
    pub open_error: Option<LibzciError>,
}

impl FakeFactory {
    /// A fake reporting `total_frames` sine PCM at `layout`.
    pub fn new(total_frames: u64, layout: PcmLayout) -> Self {
        Self {
            info: ProviderInfo {
                id: ProviderId::FAKE,
                version: "test-1",
                display_name: "test-fake",
            },
            total_frames,
            layout,
            open_error: None,
        }
    }

    /// A fake whose `open` fails with `error`.
    pub fn failing(error: LibzciError) -> Self {
        Self {
            info: ProviderInfo {
                id: ProviderId::FAKE,
                version: "test-1",
                display_name: "test-fake",
            },
            total_frames: 0,
            layout: PcmLayout::mono48k(),
            open_error: Some(error),
        }
    }
}

impl ProviderFactory for FakeFactory {
    fn info(&self) -> ProviderInfo {
        self.info
    }

    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        if input.header.starts_with(b"FAKE") {
            ProbeScore::Magic
        } else {
            ProbeScore::No
        }
    }

    fn open(
        &self,
        _source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        cancel.check()?;
        if let Some(err) = &self.open_error {
            return Err(err.clone());
        }
        Ok(Box::new(FakeInstance {
            info: self.info,
            layout: self.layout,
            total_frames: self.total_frames,
            position: 0,
        }))
    }
}

/// Independent fake decoder: per-instance position, 440Hz sine.
#[derive(Debug)]
pub struct FakeInstance {
    info: ProviderInfo,
    layout: PcmLayout,
    total_frames: u64,
    position: u64,
}

impl DecoderInstance for FakeInstance {
    fn info(&self) -> ProviderInfo {
        self.info
    }

    fn layout(&self) -> PcmLayout {
        self.layout
    }

    fn total_frames(&self) -> Option<u64> {
        Some(self.total_frames)
    }

    fn position_frames(&self) -> u64 {
        self.position
    }

    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if self.position >= self.total_frames {
            return Ok(0);
        }
        let channels = self.layout.layout.channels() as usize;
        let frames_left = (self.total_frames - self.position) as usize;
        let frames_wanted = out.len() / channels.max(1);
        let frames = frames_wanted.min(frames_left);
        for i in 0..frames {
            let t = (self.position + i as u64) as f32 / self.layout.sample_rate as f32;
            let s = (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.5;
            for ch in 0..channels {
                out[i * channels + ch] = s;
            }
        }
        self.position += frames as u64;
        Ok(frames * channels)
    }

    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        self.position = frame.min(self.total_frames);
        Ok(self.position)
    }

    fn metadata(&self) -> ProviderMetadata {
        ProviderMetadata {
            info: self.info,
            layout: self.layout,
            total_frames: Some(self.total_frames),
            applied: AppliedAdjustments::default(),
            declared_channels: self.layout.layout.channels(),
            comments: Vec::new(),
        }
    }
}

/// Extension-hint-only factory used to prove hints never outrank magic.
#[derive(Debug)]
pub struct HintOnlyFactory {
    info: ProviderInfo,
}

impl HintOnlyFactory {
    /// Create with a distinct ID so registry tests can register both.
    pub fn new(id: &'static str) -> Self {
        // Leak is acceptable in tests; IDs must be 'static.
        let leaked: &'static str = Box::leak(id.to_string().into_boxed_str());
        Self {
            info: ProviderInfo {
                id: ProviderId(leaked),
                version: "test-1",
                display_name: "hint-only",
            },
        }
    }
}

impl ProviderFactory for HintOnlyFactory {
    fn info(&self) -> ProviderInfo {
        self.info
    }

    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        if input.extension_hint == Some("fakehint") {
            ProbeScore::Hint
        } else {
            ProbeScore::No
        }
    }

    fn open(
        &self,
        _source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        cancel.check()?;
        Ok(Box::new(FakeInstance {
            info: self.info,
            layout: PcmLayout {
                layout: ChannelLayout::Mono,
                sample_rate: 8000,
            },
            total_frames: 8,
            position: 0,
        }))
    }
}

impl std::fmt::Debug for ProviderRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderRegistry")
            .field("providers", &self.provider_ids())
            .field("max_open_instances", &self.max_open_instances)
            .finish()
    }
}

/// Registered providers keyed by ID (diagnostics helper).
pub fn registry_map(reg: &ProviderRegistry) -> HashMap<&'static str, &'static str> {
    reg.factories
        .iter()
        .map(|f| (f.info().id.0, f.info().version))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemSource;

    fn mem(bytes: &[u8]) -> Arc<dyn RuntimeSource> {
        Arc::new(MemSource::new(bytes.to_vec()))
    }

    #[test]
    fn magic_outranks_extension_hint() {
        let mut reg = ProviderRegistry::new();
        reg.register(Arc::new(HintOnlyFactory::new("test.hint")))
            .unwrap();
        reg.register(Arc::new(FakeFactory::new(16, PcmLayout::mono48k())))
            .unwrap();
        let cancel = CancelFlag::default();
        let (info, _) = reg
            .open_best(mem(b"FAKExyz"), Some("fakehint"), &cancel)
            .unwrap();
        assert_eq!(info.id, ProviderId::FAKE);
    }

    #[test]
    fn unsupported_when_nothing_claims() {
        let reg = ProviderRegistry::new();
        let cancel = CancelFlag::default();
        let err = match reg.open_best(mem(b"nope"), None, &cancel) {
            Ok(_) => panic!("expected Unsupported"),
            Err(e) => e,
        };
        assert_eq!(err.kind(), "unsupported");
    }

    #[test]
    fn duplicate_provider_ids_rejected() {
        let mut reg = ProviderRegistry::new();
        reg.register(Arc::new(FakeFactory::new(1, PcmLayout::mono48k())))
            .unwrap();
        let err = reg
            .register(Arc::new(FakeFactory::new(2, PcmLayout::mono48k())))
            .unwrap_err();
        assert_eq!(err.kind(), "invalid-argument");
    }

    #[test]
    fn two_instances_hold_separate_positions() {
        let factory = FakeFactory::new(48000, PcmLayout::mono48k());
        let cancel = CancelFlag::default();
        let mut a = factory.open(mem(b"FAKEa"), &cancel).unwrap();
        let mut b = factory.open(mem(b"FAKEb"), &cancel).unwrap();
        let mut buf = vec![0.0f32; 480];
        a.decode_into(&mut buf, &cancel).unwrap();
        assert_eq!(a.position_frames(), 480);
        assert_eq!(b.position_frames(), 0);
        b.seek_to_frame(100, &cancel).unwrap();
        assert_eq!(a.position_frames(), 480);
        assert_eq!(b.position_frames(), 100);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeStatus {
    Data(usize),
    Pending,
    EndOfStream,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct ModuleCapabilities {
    pub subsongs: u32,
    pub interpolation: bool,
    pub channel_mute: bool,
}
