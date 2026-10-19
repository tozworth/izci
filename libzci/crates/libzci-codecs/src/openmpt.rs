//! Tracker-module provider over libopenmpt 0.8.4.
//!
//! Each open owns one `openmpt_module_ext` (plus its borrowed standard
//! handle and interactive interface): no mutable singleton, so the
//! current source, prepared next source, probes, and renders coexist.
//! Handles are created from a bounded complete buffer (module
//! providers declare that requirement with an explicit maximum);
//! inspection reads metadata without creating audio output.
//!
//! Normalized output is float stereo at 48 kHz with repeat count 0
//! (play once, then finite EOF). Seeks reapply channel mutes, matching
//! the current player behavior. Interpolation filter length and mutes
//! are explicit provider controls; broader effect policy belongs to
//! the later Raf core, not this provider.

use std::ffi::CString;
use std::sync::Arc;

use libzci::{
    audio::pcm::{ChannelLayout, PcmLayout},
    format::sniff_module_family,
    AppliedAdjustments, CancelFlag, DecoderInstance, LibzciError, ProbeInput, ProbeScore,
    ProviderFactory, ProviderId, ProviderInfo, ProviderMetadata, Result, RuntimeSource,
};

use crate::openmpt_ffi;

/// Provider identity for diagnostics and PCM provenance.
pub const OPENMPT_VERSION: &str = "libopenmpt-0.8.4/p1";

/// Maximum module bytes accepted at open (bounded complete buffer).
pub const MAX_MODULE_BYTES: u64 = 64 << 20;

/// Render scratch frames per decode call.
pub const SCRATCH_FRAMES: usize = 4096;

/// Observable resource limits.
#[derive(Clone, Copy, Debug)]
pub struct OpenmptLimits {
    /// Refuse sources larger than this.
    pub max_source_bytes: u64,
}

impl Default for OpenmptLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: MAX_MODULE_BYTES,
        }
    }
}

/// Tracker-module factory.
#[derive(Clone, Copy, Debug, Default)]
pub struct OpenmptFactory {
    limits: OpenmptLimits,
}

impl OpenmptFactory {
    /// Create with explicit limits.
    pub fn with_limits(limits: OpenmptLimits) -> Self {
        Self { limits }
    }
}

fn provider_info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId::OPENMPT,
        version: OPENMPT_VERSION,
        display_name: "libopenmpt",
    }
}

impl ProviderFactory for OpenmptFactory {
    fn info(&self) -> ProviderInfo {
        provider_info()
    }

    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        match sniff_module_family(input.header) {
            Some(libzci::ModuleFamily::Openmpt) => ProbeScore::Magic,
            _ if input.extension_hint.is_some_and(libzci::is_module_extension_hint) => ProbeScore::Hint,
            _ => ProbeScore::No,
        }
    }

    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        OpenmptInstance::open(source, self.limits, cancel).map(|i| Box::new(i) as _)
    }
}

/// Basic module facts for inspection (no audio output created).
#[derive(Clone, Debug)]
pub struct ModuleInfo {
    /// Tracker type string (e.g. `"MOD"`).
    pub tracker_type: String,
    /// Title metadata.
    pub title: String,
    /// Channel count.
    pub channels: u32,
    /// Subsong count.
    pub subsongs: u32,
    /// Currently selected subsong.
    pub selected_subsong: u32,
}

/// One independent opened module.
pub struct OpenmptInstance {
    info: ProviderInfo,
    // ext owns everything; mod_ borrows from ext; iface holds interface
    // function pointers valid while ext lives.
    ext: *mut openmpt_ffi::openmpt_module_ext,
    mod_: *mut openmpt_ffi::openmpt_module,
    iface: openmpt_ffi::InteractiveInterface,
    interactive: bool,
    channels: u32,
    total_frames: Option<u64>,
    position_frames: u64,
    mutes: Vec<bool>,
    scratch_left: Vec<f32>,
    scratch_right: Vec<f32>,
    speed: f64,
    repeats: u32,
}

// SAFETY: the handle is owned by this instance and only touched through
// `&mut self` on the owning decode job.
unsafe impl Send for OpenmptInstance {}

impl OpenmptInstance {
    /// Open and inspect one module from a bounded complete buffer.
    pub fn open(
        source: Arc<dyn RuntimeSource>,
        limits: OpenmptLimits,
        cancel: &CancelFlag,
    ) -> Result<Self> {
        cancel.check()?;
        let len = source.caps().len.ok_or_else(|| LibzciError::Unsupported {
            detail: "module source has unknown length".into(),
        })?;
        if len > limits.max_source_bytes {
            return Err(LibzciError::ResourceExhausted {
                detail: format!(
                    "module source {len} bytes exceeds limit {}",
                    limits.max_source_bytes
                ),
            });
        }
        // Bounded complete buffer (declared module-provider requirement).
        let mut data = vec![0u8; len as usize];
        source
            .read_exact_at(0, &mut data, cancel)
            .map_err(|e| match e {
                LibzciError::Corrupt { .. } => LibzciError::Corrupt {
                    detail: "truncated module source".into(),
                },
                other => other,
            })?;
        let magic = sniff_module_family(&data);
        // SAFETY: data outlives the create call; libopenmpt copies input.
        let mut error = 0;
        let mut error_message: *const std::os::raw::c_char = std::ptr::null();
        let ext = unsafe {
            openmpt_ffi::openmpt_module_ext_create_from_memory(
                data.as_ptr() as *const _,
                data.len(),
                None,
                std::ptr::null_mut(),
                None,
                std::ptr::null_mut(),
                &mut error,
                &mut error_message,
                std::ptr::null(),
            )
        };
        if ext.is_null() {
            let detail = openmpt_ffi::take_error_message(error_message);
            if error == openmpt_ffi::ERROR_OUT_OF_MEMORY {
                return Err(LibzciError::ResourceExhausted { detail });
            }
            // Claimed-by-magic bytes that do not load are corrupt;
            // unclaimed bytes are unsupported.
            if magic == Some(libzci::ModuleFamily::Openmpt) {
                return Err(LibzciError::Corrupt { detail });
            }
            return Err(LibzciError::Unsupported { detail });
        }
        // SAFETY: ext is valid; the borrowed handle lives while ext lives.
        let mod_ = unsafe { openmpt_ffi::openmpt_module_ext_get_module(ext) };
        if mod_.is_null() {
            unsafe { openmpt_ffi::openmpt_module_ext_destroy(ext) };
            return Err(LibzciError::DecoderFailure {
                detail: "libopenmpt ext has no module".into(),
            });
        }
        let mut iface: openmpt_ffi::InteractiveInterface = unsafe { std::mem::zeroed() };
        let interactive = unsafe {
            openmpt_ffi::openmpt_module_ext_get_interface(
                ext,
                openmpt_ffi::INTERFACE_INTERACTIVE.as_ptr() as *const _,
                &mut iface as *mut _ as *mut _,
                std::mem::size_of_val(&iface),
            ) == 1
                && iface.set_channel_mute_status.is_some()
        };
        // Finite EOF: play once, no repeats.
        unsafe { openmpt_ffi::openmpt_module_set_repeat_count(mod_, 0) };
        // Default interpolation (cubic-ish length 4, matching the
        // current worklet default); explicit control, not policy.
        unsafe {
            openmpt_ffi::openmpt_module_set_render_param(
                mod_,
                openmpt_ffi::RENDER_INTERPOLATIONFILTER_LENGTH,
                4,
            )
        };
        let channels = unsafe { openmpt_ffi::openmpt_module_get_num_channels(mod_) }.max(1) as u32;
        let duration = unsafe { openmpt_ffi::openmpt_module_get_duration_seconds(mod_) };
        let total_frames = if duration.is_finite() && duration > 0.0 && duration < 3600.0 * 12.0 {
            Some((duration * 48000.0).round() as u64)
        } else {
            None
        };
        Ok(Self {
            info: provider_info(),
            ext,
            mod_,
            iface,
            interactive,
            channels,
            total_frames,
            position_frames: 0,
            mutes: vec![false; channels as usize],
            scratch_left: vec![0.0; SCRATCH_FRAMES],
            scratch_right: vec![0.0; SCRATCH_FRAMES],
            speed: 1.0,
            repeats: 0,
        })
    }

    /// Inspection facts without creating audio output.
    pub fn inspect(&self) -> ModuleInfo {
        let title_key = CString::new("title").unwrap();
        let type_key = CString::new("type").unwrap();
        // SAFETY: keys valid; returned strings module-owned.
        let (title, tracker_type) = unsafe {
            (
                openmpt_ffi::borrowed_string(openmpt_ffi::openmpt_module_get_metadata(
                    self.mod_,
                    title_key.as_ptr(),
                )),
                openmpt_ffi::borrowed_string(openmpt_ffi::openmpt_module_get_metadata(
                    self.mod_,
                    type_key.as_ptr(),
                )),
            )
        };
        ModuleInfo {
            tracker_type,
            title,
            channels: self.channels,
            subsongs: self.subsong_count(),
            selected_subsong: self.selected_subsong(),
        }
    }

    /// Subsong count.
    pub fn subsong_count(&self) -> u32 {
        unsafe { openmpt_ffi::openmpt_module_get_num_subsongs(self.mod_) }.max(1) as u32
    }

    /// Currently selected subsong.
    pub fn selected_subsong(&self) -> u32 {
        unsafe { openmpt_ffi::openmpt_module_get_selected_subsong(self.mod_) }.max(0) as u32
    }

    /// Subsong display name (may be empty).
    pub fn subsong_name(&self, subsong: u32) -> String {
        // SAFETY: module-owned string.
        unsafe {
            openmpt_ffi::borrowed_string(openmpt_ffi::openmpt_module_get_subsong_name(
                self.mod_,
                subsong as i32,
            ))
        }
    }

    /// Select a subsong (clamped, then rewound), like the current player.
    pub fn select_subsong(&mut self, subsong: u32, cancel: &CancelFlag) -> Result<u32> {
        cancel.check()?;
        let count = self.subsong_count();
        let clamped = subsong.min(count.saturating_sub(1));
        // SAFETY: owned handle.
        unsafe { openmpt_ffi::openmpt_module_select_subsong(self.mod_, clamped as i32) };
        self.seek_to_frame(0, cancel)?;
        self.refresh_duration();
        Ok(clamped)
    }

    /// Set interpolation filter length (0/1/2/4/8); returns whether the
    /// backend accepted it.
    pub fn set_interpolation(&mut self, taps: u32) -> bool {
        let value = match taps {
            0 | 1 | 2 | 4 | 8 => taps as i32,
            _ => return false,
        };
        // SAFETY: owned handle.
        unsafe {
            openmpt_ffi::openmpt_module_set_render_param(
                self.mod_,
                openmpt_ffi::RENDER_INTERPOLATIONFILTER_LENGTH,
                value,
            ) == 1
        }
    }

    /// Set a channel mute through the interactive interface.
    pub fn set_channel_mute(&mut self, channel: u32, muted: bool) -> Result<()> {
        if !self.interactive {
            return Err(LibzciError::Unsupported {
                detail: "interactive interface unavailable".into(),
            });
        }
        if channel >= self.channels {
            return Err(LibzciError::InvalidArgument {
                detail: format!("channel {channel} out of range {}", self.channels),
            });
        }
        // Interface present (checked at open); calling a stored
        // function pointer needs no unsafe block.
        let ok =
            self.iface.set_channel_mute_status.unwrap()(self.ext, channel as i32, muted as i32);
        if ok != 1 {
            return Err(LibzciError::DecoderFailure {
                detail: "set_channel_mute_status failed".into(),
            });
        }
        self.mutes[channel as usize] = muted;
        Ok(())
    }

    /// Current channel mute (Rainy-day check via the interface).
    pub fn channel_mute(&self, channel: u32) -> Result<bool> {
        if !self.interactive {
            return Err(LibzciError::Unsupported {
                detail: "interactive interface unavailable".into(),
            });
        }
        if channel >= self.channels {
            return Err(LibzciError::InvalidArgument {
                detail: format!("channel {channel} out of range {}", self.channels),
            });
        }
        // Interface present (checked at open); calling a stored
        // function pointer needs no unsafe block.
        let status = self.iface.get_channel_mute_status.unwrap()(self.ext, channel as i32);
        Ok(status == 1)
    }

    fn reapply_mutes(&mut self) {
        if !self.interactive {
            return;
        }
        for (channel, muted) in self.mutes.iter().enumerate() {
            // Checked at open; best effort (seek must not fail).
            if let Some(set) = self.iface.set_channel_mute_status {
                set(self.ext, channel as i32, *muted as i32);
            }
        }
    }
    fn refresh_duration(&mut self) {
        let duration = unsafe { openmpt_ffi::openmpt_module_get_duration_seconds(self.mod_) };
        self.total_frames = (duration.is_finite() && duration > 0.0 && duration < 43200.0)
            .then(|| (duration * 48000.0 * (self.repeats + 1) as f64 / self.speed).round() as u64);
    }
}

impl Drop for OpenmptInstance {
    fn drop(&mut self) {
        if !self.ext.is_null() {
            // SAFETY: created by create_from_memory, owned here.
            unsafe { openmpt_ffi::openmpt_module_ext_destroy(self.ext) };
            self.ext = std::ptr::null_mut();
            self.mod_ = std::ptr::null_mut();
        }
    }
}

impl DecoderInstance for OpenmptInstance {
    fn capabilities(&self) -> libzci::ModuleCapabilities {
        libzci::ModuleCapabilities {
            subsongs: self.subsong_count(),
            interpolation: true,
            channel_mute: self.interactive,
            channels: self.channels,
            ramping: true,
            speed: self.iface.set_tempo_factor.is_some(),
            pitch: self.iface.set_pitch_factor.is_some(),
            loop_limit: true,
            patterns: true,
        }
    }
    fn module_observation(&self) -> Option<libzci::ModuleObservation> {
        unsafe {
            let pattern = openmpt_ffi::openmpt_module_get_current_pattern(self.mod_).max(0);
            let row = openmpt_ffi::openmpt_module_get_current_row(self.mod_).max(0) as u32;
            let first = row.saturating_sub(4);
            let rows = (openmpt_ffi::openmpt_module_get_pattern_num_rows(self.mod_, pattern).max(0) as u32).saturating_sub(first).min(16);
            let channels = self.channels.min(32);
            let mut cells = Vec::with_capacity((rows * channels) as usize);
            for r in first..first+rows { for c in 0..channels {
                cells.push(std::array::from_fn(|cmd| openmpt_ffi::openmpt_module_get_pattern_row_channel_command(self.mod_,pattern,r as i32,c as i32,cmd as i32)));
            }}
            Some(libzci::ModuleObservation { selected_subsong: self.selected_subsong(), order: openmpt_ffi::openmpt_module_get_current_order(self.mod_).max(0) as u32,
                pattern: pattern as u32, row, first_row: first, rows, channels, cells })
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
                if !self.set_interpolation(n) {
                    return Err(LibzciError::InvalidArgument {
                        detail: "invalid interpolation".into(),
                    });
                }
            }
            libzci::ModuleControl::ChannelMute { channel, mute } => {
                self.set_channel_mute(channel, mute)?
            }
            libzci::ModuleControl::Ramping(n) => {
                if unsafe { openmpt_ffi::openmpt_module_set_render_param(self.mod_, openmpt_ffi::RENDER_VOLUMERAMPING_STRENGTH, n) } != 1 {
                    return Err(LibzciError::DecoderFailure { detail: "ramping rejected".into() });
                }
            }
            libzci::ModuleControl::Speed(n) => {
                if self.iface.set_tempo_factor.unwrap()(self.ext,n) != 1 { return Err(LibzciError::DecoderFailure { detail: "tempo rejected".into() }); }
                self.speed = n; self.refresh_duration();
            }
            libzci::ModuleControl::Pitch(n) => {
                if self.iface.set_pitch_factor.unwrap()(self.ext,n) != 1 { return Err(LibzciError::DecoderFailure { detail: "pitch rejected".into() }); }
            }
            libzci::ModuleControl::LoopLimit(n) => {
                unsafe { openmpt_ffi::openmpt_module_set_repeat_count(self.mod_,n as i32); }
                self.repeats = n; self.refresh_duration();
            }
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
        let mut written = 0;
        while written + 1 < out.len() {
            cancel.check()?;
            let want_frames = ((out.len() - written) / 2).min(SCRATCH_FRAMES);
            if want_frames == 0 {
                break;
            }
            // SAFETY: scratch sized; owned handle.
            let got = unsafe {
                openmpt_ffi::openmpt_module_read_float_stereo(
                    self.mod_,
                    48_000,
                    want_frames,
                    self.scratch_left.as_mut_ptr(),
                    self.scratch_right.as_mut_ptr(),
                )
            };
            if got == 0 {
                break;
            }
            // End-trim at the duration estimate: libopenmpt may render a
            // short silence tail past it (measured 0.1 s of digital
            // silence on the fixtures); the audible timeline stays exact.
            let mut take = got;
            if let Some(total) = self.total_frames {
                let remaining = total.saturating_sub(self.position_frames) as usize;
                if remaining == 0 {
                    self.position_frames = total;
                    break;
                }
                take = take.min(remaining);
            }
            for i in 0..take {
                out[written + i * 2] = self.scratch_left[i];
                out[written + i * 2 + 1] = self.scratch_right[i];
            }
            written += take * 2;
            self.position_frames += take as u64;
            if let Some(total) = self.total_frames {
                if self.position_frames >= total {
                    break;
                }
            }
            if got < want_frames {
                break;
            }
        }
        Ok(written)
    }

    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        let clamped = match self.total_frames {
            Some(total) => frame.min(total),
            None => frame,
        };
        // SAFETY: owned handle.
        let landed = unsafe {
            openmpt_ffi::openmpt_module_set_position_seconds(self.mod_, clamped as f64 * self.speed / 48000.0)
        };
        self.reapply_mutes();
        self.position_frames = if landed.is_finite() && landed >= 0.0 {
            (landed * 48000.0 / self.speed).round() as u64
        } else {
            clamped
        };
        Ok(self.position_frames)
    }

    fn metadata(&self) -> ProviderMetadata {
        ProviderMetadata {
            info: self.info,
            layout: self.layout(),
            total_frames: self.total_frames,
            applied: AppliedAdjustments::default(),
            declared_channels: self.channels as u16,
            comments: ["title", "type", "tracker", "artist", "message"].iter().map(|key| {
                let c = CString::new(*key).unwrap();
                (key.to_string(), unsafe { openmpt_ffi::borrowed_string(openmpt_ffi::openmpt_module_get_metadata(self.mod_,c.as_ptr())) }.chars().take(4096).collect())
            }).collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::{blank_ahx, blank_hvl, tone_module};
    use libzci::source::MemSource;

    fn fixture_bytes(id: &str) -> Vec<u8> {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../.local/libzci/media")
            .join(if id.ends_with(".mod") { "m1/tone.mod" } else { "r3/stereo.opus" });
        std::fs::read(&path).unwrap_or_else(|_| {
            panic!(
                "missing fixture {} — run `node fixtures/generate.mjs` first",
                path.display()
            )
        })
    }

    fn open_bytes(bytes: Vec<u8>) -> OpenmptInstance {
        OpenmptInstance::open(
            Arc::new(MemSource::new(bytes)),
            OpenmptLimits::default(),
            &CancelFlag::default(),
        )
        .unwrap_or_else(|e| panic!("open failed: {e:?}"))
    }

    #[test]
    fn probe_claims_mod_rejects_opus() {
        let factory = OpenmptFactory::default();
        let opus = fixture_bytes("media/audio/tone.opus");
        let module = fixture_bytes("media/modules/tone.mod");
        for (bytes, expect) in [
            (module, ProbeScore::Magic),
            (opus, ProbeScore::No),
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
    fn mod_renders_finite_audible_pcm() {
        let bytes = fixture_bytes("media/modules/tone.mod");
        let mut inst = open_bytes(bytes);
        let info = inst.inspect();
        assert_eq!(info.channels, 4);
        assert_eq!(info.subsongs, 1);
        assert!(info.title.contains("M1 tone MOD"));
        let total = inst.total_frames().expect("finite mod total");
        // 7.68 s at 48 kHz = 368640 frames; allow backend rounding.
        assert!(
            (360_000..=375_000).contains(&total),
            "audible total {total} outside expected range"
        );
        let cancel = CancelFlag::default();
        let mut pcm = Vec::new();
        let mut buf = vec![0.0f32; 8192];
        loop {
            let n = inst.decode_into(&mut buf, &cancel).unwrap();
            if n == 0 {
                break;
            }
            pcm.extend_from_slice(&buf[..n]);
        }
        assert_eq!(pcm.len() as u64, total * 2, "stereo samples match total");
        assert!(pcm.iter().all(|s| s.is_finite()));
        assert!(pcm.iter().any(|&s| s != 0.0), "audible module pcm");
    }

    #[test]
    fn two_subsong_fixture_selects_and_seeks() {
        let mut inst = open_bytes(tone_module(true));
        assert_eq!(inst.subsong_count(), 2);
        let cancel = CancelFlag::default();
        assert_eq!(inst.select_subsong(1, &cancel).unwrap(), 1);
        assert_eq!(inst.selected_subsong(), 1);
        assert_eq!(inst.position_frames(), 0);
        // Out-of-range subsongs clamp instead of failing.
        assert_eq!(inst.select_subsong(99, &cancel).unwrap(), 1);
        // The helper's second subsong loops after a few rows, so its
        // finite total is short; seeks land exactly and clamp at it.
        let total = inst.total_frames().expect("finite subsong total");
        assert!(
            total > 0 && total < 48_000,
            "short looping subsong total {total}"
        );
        assert_eq!(inst.seek_to_frame(total / 2, &cancel).unwrap(), total / 2);
        assert_eq!(inst.seek_to_frame(total + 10_000, &cancel).unwrap(), total);
    }

    #[test]
    fn channel_mutes_apply_and_reapply_after_seek() {
        let mut inst = open_bytes(tone_module(false));
        let cancel = CancelFlag::default();
        assert!(inst.interactive);
        inst.set_channel_mute(0, true).unwrap();
        assert!(inst.channel_mute(0).unwrap());
        inst.seek_to_frame(1000, &cancel).unwrap();
        assert!(inst.channel_mute(0).unwrap(), "mute survives seek");
        inst.set_channel_mute(0, false).unwrap();
        assert!(!inst.channel_mute(0).unwrap());
        assert!(inst.set_channel_mute(99, true).is_err());
    }

    #[test]
    fn two_instances_are_independent() {
        let cancel = CancelFlag::default();
        let bytes = tone_module(true);
        let mut a = OpenmptInstance::open(
            Arc::new(MemSource::new(bytes.clone())),
            OpenmptLimits::default(),
            &cancel,
        )
        .unwrap();
        let mut b = OpenmptInstance::open(
            Arc::new(MemSource::new(bytes)),
            OpenmptLimits::default(),
            &cancel,
        )
        .unwrap();
        a.select_subsong(1, &cancel).unwrap();
        a.set_channel_mute(2, true).unwrap();
        let mut buf = vec![0.0f32; 512];
        a.decode_into(&mut buf, &cancel).unwrap();
        assert_eq!(b.selected_subsong(), 0);
        assert!(!b.channel_mute(2).unwrap());
        assert_eq!(b.position_frames(), 0);
        drop(a);
        // The surviving handle still decodes.
        assert!(b.decode_into(&mut buf, &cancel).unwrap() > 0);
    }

    #[test]
    fn registry_selects_openmpt_for_mod() {
        use libzci::ProviderRegistry;
        let mut registry = ProviderRegistry::new();
        registry
            .register(Arc::new(OpenmptFactory::default()))
            .unwrap();
        let cancel = CancelFlag::default();
        let (info, mut instance) = registry
            .open_best(
                Arc::new(MemSource::new(tone_module(false))),
                Some("mod"),
                &cancel,
            )
            .unwrap();
        assert_eq!(info.id, ProviderId::OPENMPT);
        let mut buf = vec![0.0f32; 256];
        assert!(instance.decode_into(&mut buf, &cancel).unwrap() > 0);
    }

    #[test]
    fn helpers_build_loadable_modules() {
        // The Rust helper ports test-fixtures.ts toneModule() (title
        // "izci WASM test"); the corpus fixture uses the separate
        // fixtures/generate.mjs recipe (title "izci Stage 1 MOD").
        // Both must load and render; byte-identity is not claimed.
        for two in [false, true] {
            let inst = open_bytes(tone_module(two));
            assert_eq!(inst.inspect().title, "izci WASM test");
            assert_eq!(inst.subsong_count(), if two { 2 } else { 1 });
        }
        // Blank Hively helpers construct loadable tunes (lifecycle only).
        assert!(!blank_ahx().is_empty() && !blank_hvl().is_empty());
    }
}
