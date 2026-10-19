//! Hively (AHX/HVL) provider over the instance-safe context wrapper.
//!
//! Each open owns one `lz_hively_ctx`: source copy, live tune, probe
//! tune, buffers, position, duration state, subsong, mutes, and
//! interpolation. Two contexts interleave with no shared mutable
//! state; upstream table initialization is audited in the
//! implementation log (one synchronized init, immutable after).
//!
//! Duration discovery and seeks are bounded cancellable steps on
//! decode jobs — never one uncancellable call and never on audio
//! callbacks. Output is float stereo at 48 kHz. Blank AHX/HVL tunes
//! prove lifecycle (open/seek/select/mute/dispose/EOF); audible DSP
//! and mute verification need real fixtures (named gap, not claimed).

use std::sync::Arc;

use libzci::{
    audio::pcm::{ChannelLayout, PcmLayout},
    format::{sniff_module_family, HivelyKind, ModuleFamily},
    AppliedAdjustments, CancelFlag, DecoderInstance, LibzciError, ProbeInput, ProbeScore,
    ProviderFactory, ProviderId, ProviderInfo, ProviderMetadata, Result, RuntimeSource,
};

use crate::hively_ffi;

/// Provider identity for diagnostics and PCM provenance.
pub const HIVELY_VERSION: &str = "hivelytracker-f393ca7/p1";

/// Maximum Hively source bytes accepted at open.
pub const MAX_HIVELY_BYTES: u64 = 64 << 20;

/// Duration probe batch in 1/50 s frames (cancellable between batches).
pub const PROBE_BATCH_FRAMES: u32 = 512;

/// Seek discard batch in Hively frames (cancellable between batches).
pub const SEEK_BATCH_FRAMES: u32 = 256;

/// Observable resource limits.
#[derive(Clone, Copy, Debug)]
pub struct HivelyLimits {
    /// Refuse sources larger than this.
    pub max_source_bytes: u64,
}

impl Default for HivelyLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: MAX_HIVELY_BYTES,
        }
    }
}

/// Hively factory.
#[derive(Clone, Copy, Debug, Default)]
pub struct HivelyFactory {
    limits: HivelyLimits,
}

impl HivelyFactory {
    /// Create with explicit limits.
    pub fn with_limits(limits: HivelyLimits) -> Self {
        Self { limits }
    }
}

fn provider_info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId::HIVELY,
        version: HIVELY_VERSION,
        display_name: "HivelyTracker",
    }
}

impl ProviderFactory for HivelyFactory {
    fn info(&self) -> ProviderInfo {
        provider_info()
    }

    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        match sniff_module_family(input.header) {
            Some(ModuleFamily::Hively(_)) => ProbeScore::Magic,
            _ => ProbeScore::No,
        }
    }

    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        HivelyInstance::open(source, self.limits, cancel).map(|i| Box::new(i) as _)
    }
}

/// One independent opened Hively tune.
pub struct HivelyInstance {
    info: ProviderInfo,
    ctx: *mut hively_ffi::lz_hively_ctx,
    kind: HivelyKind,
    channels: u32,
    frame_samples: u32,
    total_frames: Option<u64>,
    /// Emitted audible position (Rust-owned: the C position includes
    /// seek-discarded and spilled samples).
    position_frames: u64,
    title: String,
}

// SAFETY: the context is owned by this instance and only touched
// through `&mut self` on the owning decode job.
unsafe impl Send for HivelyInstance {}

impl HivelyInstance {
    /// Open one tune from a bounded complete buffer.
    pub fn open(
        source: Arc<dyn RuntimeSource>,
        limits: HivelyLimits,
        cancel: &CancelFlag,
    ) -> Result<Self> {
        cancel.check()?;
        let len = source.caps().len.ok_or_else(|| LibzciError::Unsupported {
            detail: "hively source has unknown length".into(),
        })?;
        if len > limits.max_source_bytes {
            return Err(LibzciError::ResourceExhausted {
                detail: format!(
                    "hively source {len} bytes exceeds limit {}",
                    limits.max_source_bytes
                ),
            });
        }
        let mut data = vec![0u8; len as usize];
        source
            .read_exact_at(0, &mut data, cancel)
            .map_err(|e| match e {
                LibzciError::Corrupt { .. } => LibzciError::Corrupt {
                    detail: "truncated hively source".into(),
                },
                other => other,
            })?;
        let kind = match sniff_module_family(&data) {
            Some(ModuleFamily::Hively(kind)) => kind,
            _ => {
                return Err(LibzciError::Unsupported {
                    detail: "not AHX/HVL content".into(),
                });
            }
        };
        hively_ffi::ensure_tables();
        let mut errbuf = [0i8; 32];
        // SAFETY: data outlives the call; the context copies it.
        let ctx = unsafe {
            hively_ffi::lz_hively_open(
                data.as_ptr(),
                data.len() as u32,
                48_000,
                errbuf.as_mut_ptr(),
                errbuf.len(),
            )
        };
        if ctx.is_null() {
            let kind_str = String::from_utf8_lossy(
                unsafe { std::ffi::CStr::from_ptr(errbuf.as_ptr()) }.to_bytes(),
            );
            return match kind_str.as_ref() {
                "resource" => Err(LibzciError::ResourceExhausted {
                    detail: "hively open allocation failed".into(),
                }),
                "corrupt" => Err(LibzciError::Corrupt {
                    detail: "hively tune does not load".into(),
                }),
                _ => Err(LibzciError::Unsupported {
                    detail: "hively open refused input".into(),
                }),
            };
        }
        // SAFETY: context valid.
        let (channels, frame_samples, title) = unsafe {
            (
                hively_ffi::lz_hively_channel_count(ctx),
                hively_ffi::lz_hively_frame_samples(ctx),
                {
                    let mut len = 0u32;
                    let ptr = hively_ffi::lz_hively_title(ctx, &mut len);
                    let bytes = std::slice::from_raw_parts(ptr as *const u8, len.min(128) as usize);
                    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                    String::from_utf8_lossy(&bytes[..end]).into_owned()
                },
            )
        };
        let mut instance = Self {
            info: provider_info(),
            ctx,
            kind,
            channels: channels.max(1),
            frame_samples: frame_samples.max(1),
            total_frames: None,
            position_frames: 0,
            title,
        };
        instance.probe_duration(cancel)?;
        // The upstream loader is lenient: magic-claiming garbage can
        // still "load". A tune with no audible duration is corrupt
        // input, not an empty success.
        if instance.total_frames == Some(0) {
            return Err(LibzciError::Corrupt {
                detail: "hively tune has no audible duration".into(),
            });
        }
        Ok(instance)
    }

    /// Bounded cancellable duration probe (probe tune; live untouched).
    fn probe_duration(&mut self, cancel: &CancelFlag) -> Result<()> {
        loop {
            cancel.check()?;
            let mut rendered = 0u32;
            let mut ended = 0;
            let mut duration = 0u32;
            // SAFETY: owned context.
            let ok = unsafe {
                hively_ffi::lz_hively_probe_step(
                    self.ctx,
                    PROBE_BATCH_FRAMES,
                    &mut rendered,
                    &mut ended,
                    &mut duration,
                )
            };
            if ok != 1 {
                return Err(LibzciError::DecoderFailure {
                    detail: "hively probe step failed".into(),
                });
            }
            if ended != 0 {
                self.total_frames = Some(duration as u64 * self.frame_samples as u64);
                return Ok(());
            }
            if duration >= hively_ffi::MAX_DURATION_FRAMES {
                // Looping/unbounded content: finite EOF unknown.
                self.total_frames = None;
                return Ok(());
            }
        }
    }

    /// Tune flavor.
    pub fn kind(&self) -> HivelyKind {
        self.kind
    }

    /// Title bytes (bounded, NUL-trimmed).
    pub fn title(&self) -> &str {
        &self.title
    }

    /// Subsong count.
    pub fn subsong_count(&self) -> u32 {
        // SAFETY: owned context.
        unsafe { hively_ffi::lz_hively_subsong_count(self.ctx) }.max(1)
    }

    /// Currently selected subsong.
    pub fn selected_subsong(&self) -> u32 {
        // SAFETY: owned context.
        unsafe { hively_ffi::lz_hively_subsong(self.ctx) }
    }

    /// Select a subsong and re-probe its duration (bounded, cancellable).
    pub fn select_subsong(&mut self, subsong: u32, cancel: &CancelFlag) -> Result<u32> {
        cancel.check()?;
        let count = self.subsong_count();
        let clamped = subsong.min(count.saturating_sub(1));
        // SAFETY: owned context.
        let ok = unsafe { hively_ffi::lz_hively_select_subsong(self.ctx, clamped) };
        if ok != 1 {
            return Err(LibzciError::DecoderFailure {
                detail: format!("hively select subsong {clamped} failed"),
            });
        }
        self.position_frames = 0;
        self.total_frames = None;
        self.probe_duration(cancel)?;
        Ok(clamped)
    }

    /// Current order/row (pattern display).
    pub fn order_row(&self) -> (u32, u32) {
        // SAFETY: owned context.
        unsafe {
            (
                hively_ffi::lz_hively_order(self.ctx),
                hively_ffi::lz_hively_row(self.ctx),
            )
        }
    }

    /// Set a channel mute (per-instance).
    pub fn set_channel_mute(&mut self, channel: u32, muted: bool) -> Result<()> {
        // SAFETY: owned context.
        let ok = unsafe { hively_ffi::lz_hively_set_channel_mute(self.ctx, channel, muted as i32) };
        if ok != 1 {
            return Err(LibzciError::InvalidArgument {
                detail: format!("hively channel {channel} out of range"),
            });
        }
        Ok(())
    }

    /// Current mute state (per-instance).
    pub fn channel_mute(&self, channel: u32) -> Result<bool> {
        // SAFETY: owned context.
        let status = unsafe { hively_ffi::lz_hively_channel_mute(self.ctx, channel) };
        if status < 0 {
            return Err(LibzciError::InvalidArgument {
                detail: format!("hively channel {channel} out of range"),
            });
        }
        Ok(status != 0)
    }

    /// Set interpolation taps (2/4/8, else stock).
    pub fn set_interpolation(&mut self, taps: u32) {
        // SAFETY: owned context.
        unsafe { hively_ffi::lz_hively_set_interpolation(self.ctx, taps) };
    }

    /// Whether the live tune reached song end.
    pub fn ended(&self) -> bool {
        // SAFETY: owned context.
        unsafe { hively_ffi::lz_hively_ended(self.ctx) != 0 }
    }
}

impl Drop for HivelyInstance {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            // SAFETY: created by lz_hively_open, owned here.
            unsafe { hively_ffi::lz_hively_close(self.ctx) };
            self.ctx = std::ptr::null_mut();
        }
    }
}

impl DecoderInstance for HivelyInstance {
    fn module_observation(&self) -> Option<libzci::ModuleObservation> {
        let (order,row) = self.order_row();
        let first = row.saturating_sub(4);
        let rows = unsafe { hively_ffi::lz_hively_pattern_rows(self.ctx) }.saturating_sub(first).min(16);
        let channels = self.channels.min(32);
        let mut cells = Vec::with_capacity((rows*channels) as usize);
        for r in first..first+rows { for c in 0..channels {
            let mut cell = [0;6];
            unsafe { hively_ffi::lz_hively_pattern_cell(self.ctx,order,r,c,cell.as_mut_ptr()); }
            cells.push(cell);
        }}
        Some(libzci::ModuleObservation { selected_subsong:self.selected_subsong(),order,pattern:order,row,first_row:first,rows,channels,cells })
    }
    fn capabilities(&self) -> libzci::ModuleCapabilities {
        libzci::ModuleCapabilities {
            subsongs: self.subsong_count(),
            interpolation: true,
            channel_mute: true,
            channels: self.channels,
            patterns: true,
            ..Default::default()
        }
    }
    fn module_control(
        &mut self,
        control: libzci::ModuleControl,
        cancel: &CancelFlag,
    ) -> Result<()> {
        cancel.check()?;
        control.validate(self.capabilities())?;
        match control {
            libzci::ModuleControl::Subsong(n) => {
                self.select_subsong(n, cancel)?;
            }
            libzci::ModuleControl::Interpolation(n) => {
                self.set_interpolation(n);
            }
            libzci::ModuleControl::ChannelMute { channel, mute } => {
                self.set_channel_mute(channel, mute)?
            }
            _ => return Err(LibzciError::Unsupported { detail: "Hively has no speed, pitch, ramping or repeat control".into() }),
        }
        Ok(())
    }

    fn info(&self) -> ProviderInfo {
        self.info
    }

    fn layout(&self) -> PcmLayout {
        PcmLayout::new(ChannelLayout::Stereo, 48_000).expect("stereo48k valid")
    }

    fn total_frames(&self) -> Option<u64> {
        self.total_frames
    }

    fn position_frames(&self) -> u64 {
        self.position_frames
    }

    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if out.len() < 2 {
            return Ok(0);
        }
        let want_frames = (out.len() / 2).min(i32::MAX as usize) as u32;
        if want_frames == 0 {
            return Ok(0);
        }
        // End-trim against a probed total.
        let want_frames = match self.total_frames {
            Some(total) => {
                let remaining = total.saturating_sub(self.position_frames);
                if remaining == 0 {
                    return Ok(0);
                }
                want_frames.min(remaining as u32)
            }
            None => want_frames,
        };
        // SAFETY: out sized for want_frames stereo; owned context.
        let rendered =
            unsafe { hively_ffi::lz_hively_render_float(self.ctx, out.as_mut_ptr(), want_frames) };
        self.position_frames += rendered as u64;
        Ok(rendered as usize * 2)
    }

    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        let clamped = match self.total_frames {
            Some(total) => frame.min(total),
            None => frame,
        };
        let target_hvl = (clamped / self.frame_samples as u64).min(u32::MAX as u64) as u32;
        // Bounded forward steps with cancellation between batches.
        loop {
            cancel.check()?;
            let mut position = 0u32;
            // SAFETY: owned context.
            let ok = unsafe {
                hively_ffi::lz_hively_seek_step(
                    self.ctx,
                    target_hvl,
                    SEEK_BATCH_FRAMES,
                    &mut position,
                )
            };
            if ok != 1 {
                return Err(LibzciError::DecoderFailure {
                    detail: "hively seek step failed".into(),
                });
            }
            if position >= target_hvl {
                break;
            }
            if self.ended() {
                break;
            }
        }
        // Sub-frame remainder: render and drop (sample-exact landing).
        let remainder = (clamped % self.frame_samples as u64) as usize;
        if remainder > 0 {
            let mut scratch = vec![0.0f32; remainder * 2];
            // SAFETY: scratch sized; owned context.
            let rendered = unsafe {
                hively_ffi::lz_hively_render_float(self.ctx, scratch.as_mut_ptr(), remainder as u32)
            };
            if rendered < remainder as u32 {
                self.position_frames = clamped - (remainder as u64 - rendered as u64);
                return Ok(self.position_frames);
            }
        }
        self.position_frames = clamped;
        Ok(clamped)
    }

    fn metadata(&self) -> ProviderMetadata {
        ProviderMetadata {
            info: self.info,
            layout: self.layout(),
            total_frames: self.total_frames,
            applied: AppliedAdjustments::default(),
            declared_channels: self.channels as u16,
            comments: vec![("title".into(), self.title.clone()), ("type".into(), format!("{:?}",self.kind))],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{blank_ahx, blank_hvl};
    use libzci::source::MemSource;

    fn open_bytes(bytes: Vec<u8>) -> HivelyInstance {
        HivelyInstance::open(
            Arc::new(MemSource::new(bytes)),
            HivelyLimits::default(),
            &CancelFlag::default(),
        )
        .unwrap_or_else(|e| panic!("open failed: {e:?}"))
    }

    #[test]
    fn probe_claims_hively_rejects_mod() {
        let factory = HivelyFactory::default();
        let mod_bytes = crate::test_helpers::tone_module(false);
        for (bytes, expect) in [
            (blank_ahx(), ProbeScore::Magic),
            (blank_hvl(), ProbeScore::Magic),
            (mod_bytes, ProbeScore::No),
            (b"garbage-bytes".to_vec(), ProbeScore::No),
        ] {
            assert_eq!(
                factory.probe(&ProbeInput {
                    header: &bytes[..bytes.len().min(8192)],
                    extension_hint: None,
                    requires_full_buffer: false,
                }),
                expect
            );
        }
    }

    #[test]
    fn blank_tunes_run_lifecycle_to_eof() {
        for (bytes, kind) in [
            (blank_ahx(), HivelyKind::Ahx),
            (blank_hvl(), HivelyKind::Hvl),
        ] {
            let mut inst = open_bytes(bytes);
            assert_eq!(inst.kind(), kind);
            assert_eq!(inst.subsong_count(), 1);
            let total = inst.total_frames().expect("blank tune has finite EOF");
            assert!(
                total > 0 && total < 48_000 * 60 * 31,
                "bounded duration {total}"
            );
            let cancel = CancelFlag::default();
            let mut buf = vec![0.0f32; 4096];
            let mut rendered = 0u64;
            loop {
                let n = inst.decode_into(&mut buf, &cancel).unwrap();
                if n == 0 {
                    break;
                }
                assert!(buf[..n].iter().all(|s| s.is_finite()));
                rendered += n as u64 / 2;
            }
            assert_eq!(rendered, total, "rendered matches probed total");
            assert!(inst.ended());
            // Play-after-end restarts from the top (seek 0 then render).
            inst.seek_to_frame(0, &cancel).unwrap();
            assert_eq!(inst.position_frames(), 0);
            // Seek to duration ends; sub-frame seek lands exactly.
            inst.seek_to_frame(total, &cancel).unwrap();
            assert_eq!(inst.decode_into(&mut buf, &cancel).unwrap(), 0);
            inst.seek_to_frame(1920, &cancel).unwrap();
            assert_eq!(inst.position_frames(), 1920);
        }
    }

    #[test]
    fn interleaved_contexts_do_not_share_state() {
        let cancel = CancelFlag::default();
        let mut a = open_bytes(blank_ahx());
        let mut b = open_bytes(blank_ahx());
        a.set_channel_mute(0, true).unwrap();
        assert!(a.channel_mute(0).unwrap());
        assert!(!b.channel_mute(0).unwrap(), "mute on A leaves B alone");
        a.seek_to_frame(1920, &cancel).unwrap();
        assert_eq!(a.position_frames(), 1920);
        assert_eq!(b.position_frames(), 0, "seek on A leaves B alone");
        assert_eq!(a.selected_subsong(), b.selected_subsong());
        drop(a);
        // The surviving context still renders lifecycle output.
        let mut buf = vec![0.0f32; 512];
        let mut saw_eof = false;
        for _ in 0..100_000 {
            if b.decode_into(&mut buf, &cancel).unwrap() == 0 {
                saw_eof = true;
                break;
            }
        }
        assert!(saw_eof, "survivor reaches EOF after sibling dispose");
        assert!(b.set_channel_mute(99, true).is_err());
    }

    #[test]
    fn garbage_with_magic_is_corrupt_without_is_unsupported() {
        let factory = HivelyFactory::default();
        let cancel = CancelFlag::default();
        // THX magic but broken body. The upstream loader is lenient:
        // it may still "load" structural garbage as a silent tune
        // (documented below); it must never report audible success.
        let mut bad = blank_ahx();
        bad.truncate(14);
        bad.extend_from_slice(&[0u8; 64]);
        match factory.open(Arc::new(MemSource::new(bad)), &cancel) {
            Err(LibzciError::Corrupt { .. }) | Err(LibzciError::Unsupported { .. }) => {}
            Err(e) => panic!("expected Corrupt/Unsupported, got {}", e.kind()),
            Ok(mut instance) => {
                let mut buf = vec![0.0f32; 1024];
                let mut frames = 0u64;
                loop {
                    let n = instance.decode_into(&mut buf, &cancel).unwrap();
                    if n == 0 {
                        break;
                    }
                    assert!(buf[..n].iter().all(|s| s.is_finite()));
                    assert!(
                        buf[..n].iter().all(|&s| s == 0.0),
                        "magic-claiming garbage must stay silent"
                    );
                    frames += n as u64 / 2;
                    assert!(frames < 48_000 * 60 * 31, "bounded garbage render");
                }
            }
        }
        // No magic at all.
        match factory.open(
            Arc::new(MemSource::new(b"definitely not a tune......".to_vec())),
            &cancel,
        ) {
            Err(LibzciError::Unsupported { .. }) => {}
            Err(e) => panic!("expected Unsupported, got {}", e.kind()),
            Ok(_) => panic!("expected Unsupported, opened successfully"),
        }
    }
}
