//! Historical packet implementation retained only for R3 comparison tests.
//! Reference Opus provider: shared Ogg packet reader plus packet-level
//! reference libopus decode.
//!
//! Design (scoped packet-level path per `scaffolding §3`):
//!
//! - The Ogg container is parsed by the shared reader in this module
//!   (page headers, lacing, continued packets, granule index). The
//!   reference libogg source is still acquired/built for provenance and
//!   the Emscripten comparison; see `libzci/vendor/dependencies.json`.
//! - Compressed packets are decoded by reference libopus 1.5.2
//!   (statically linked; version asserted in tests via
//!   `opus_get_version_string`).
//! - opusfile semantics are mirrored exactly once: the mandatory
//!   OpusHead output gain is applied with zero additional offset,
//!   pre-skip samples are discarded before the audible timeline, and
//!   end trimming truncates the final packet to the granule timeline.
//!   ReplayGain/R128 tag policy stays core-owned (later); tags are
//!   parsed for diagnostics but never applied here.
//! - Output is normalized float PCM at 48 kHz, mono or stereo
//!   (mapping family 0). Mapping family 1+, channel counts above
//!   stereo, and chained Ogg links fail explicitly as named gaps —
//!   never silent wrong audio.
//! - Reads are bounded: the index scan reads page headers only, decode
//!   reads one page body at a time (≤ 64 KiB), and no whole-file copy
//!   is retained. Limits in [`OpusLimits`] are observable and enforced.

use std::sync::Arc;

use libzci::{
    audio::pcm::{ChannelLayout, PcmLayout},
    format::{parse_opus_tags_packet, sniff_opus_head_page},
    ogg_reader::{
        ogg_crc, split_packets_with_carry, validate_ogg_index, PageEntry, PageScanner, GRANULE_NONE,
    },
    AppliedAdjustments, CancelFlag, DecoderInstance, LibzciError, ProbeInput, ProbeScore,
    ProviderFactory, ProviderId, ProviderInfo, ProviderMetadata, Result, RuntimeSource,
};

use libzci_codecs::opus_ffi;

/// Provider identity for diagnostics and PCM provenance.
pub const OPUS_VERSION: &str = "libopus-1.5.2/p1";

/// Maximum Opus frame block per decode call: 120 ms at 48 kHz.
pub const MAX_DECODE_FRAMES: usize = 5760;

/// Observable resource limits.
#[derive(Clone, Copy, Debug)]
pub struct OpusLimits {
    /// Refuse to open sources larger than this (bytes).
    pub max_source_bytes: u64,
    /// Refuse to index more pages than this.
    pub max_pages: usize,
}

impl Default for OpusLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: 1 << 30,
            max_pages: 262_144,
        }
    }
}

/// Reference Opus factory.
#[derive(Clone, Copy, Debug, Default)]
pub struct OpusFactory {
    limits: OpusLimits,
}

impl OpusFactory {
    /// Create with explicit limits (tests use small limits to prove
    /// enforcement is observable).
    pub fn with_limits(limits: OpusLimits) -> Self {
        Self { limits }
    }

    /// Active limits.
    pub fn limits(&self) -> OpusLimits {
        self.limits
    }
}

fn provider_info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId::OPUS,
        version: OPUS_VERSION,
        display_name: "Reference Opus",
    }
}

impl ProviderFactory for OpusFactory {
    fn info(&self) -> ProviderInfo {
        provider_info()
    }

    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        if sniff_opus_head_page(input.header).is_some() {
            ProbeScore::Magic
        } else {
            ProbeScore::No
        }
    }

    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        OpusInstance::open(source, self.limits, cancel).map(|i| Box::new(i) as _)
    }
}

// ---------------------------------------------------------------------------
// Stream headers
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct OpusHeaders {
    channels: u8,
    preskip: u64,
    gain_linear: f32,
    vendor: String,
    comment_count: usize,
}

/// Mandatory header output gain, opusfile-style, zero additional offset.
fn parse_opus_head(packet: &[u8]) -> Result<(u8, u64, f32)> {
    let params = libzci::format::parse_opus_head_packet(packet)?;
    Ok((params.channels, params.preskip, params.gain_linear()?))
}

/// Tags are diagnostics-only here (core policy: never applied).
fn parse_opus_tags(packet: &[u8]) -> Result<(String, usize)> {
    let tags = parse_opus_tags_packet(packet)?;
    Ok((tags.vendor, tags.comment_count))
}

// ---------------------------------------------------------------------------
// Decoder instance
// ---------------------------------------------------------------------------

/// One independent opened Opus stream.
pub struct OpusInstance {
    info: ProviderInfo,
    layout: PcmLayout,
    headers: OpusHeaders,
    total_frames: u64,
    source: Arc<dyn RuntimeSource>,
    pages: Vec<PageEntry>,
    /// Location of the first audio packet, computed at open by
    /// counting exactly two header packets (never "first page with
    /// ≥2 packets", which drops audio when headers occupy own pages).
    audio_start_page: usize,
    audio_start_packet: usize,
    /// Page currently loaded for packet extraction.
    loaded_page: usize,
    /// Data packets of the loaded page (headers excluded).
    loaded_packets: Vec<Vec<u8>>,
    loaded_index: usize,
    /// `true` once the audio-start page has been processed.
    past_headers: bool,
    /// One-shot skip for a seek that reloads the audio-start page.
    seek_skip: Option<(usize, usize)>,
    /// Carry for a packet continued from the previous page.
    carry: Vec<u8>,
    /// libopus handle, owned by this instance.
    decoder: *mut opus_ffi::OpusDecoder,
    /// Reusable decode scratch (interleaved, ≤ 5760 frames).
    scratch: Vec<f32>,
    /// Stash for decoded output exceeding the caller's buffer.
    stash: std::collections::VecDeque<f32>,
    /// Discards still owed before the audible timeline (preskip, then
    /// seek skips). Preskip does not advance `position`; seek skips set
    /// it directly.
    pending_discard: u64,
    position_frames: u64,
    finished: bool,
}

// SAFETY: the handle is owned by this instance and only touched through
// `&mut self` on the owning decode job.
unsafe impl Send for OpusInstance {}

impl OpusInstance {
    fn open(
        source: Arc<dyn RuntimeSource>,
        limits: OpusLimits,
        cancel: &CancelFlag,
    ) -> Result<Self> {
        cancel.check()?;
        if let Some(len) = source.caps().len {
            if len > limits.max_source_bytes {
                return Err(LibzciError::ResourceExhausted {
                    detail: format!(
                        "opus source {len} bytes exceeds limit {}",
                        limits.max_source_bytes
                    ),
                });
            }
        }
        let scanner = PageScanner::new(&source, cancel);
        // Index page headers only (bounded reads, no whole-file copy).
        let mut pages = Vec::new();
        let mut offset = 0u64;
        loop {
            cancel.check()?;
            match scanner.read_page_entry(offset)? {
                None => break,
                Some(entry) => {
                    if pages.len() >= limits.max_pages {
                        return Err(LibzciError::ResourceExhausted {
                            detail: format!("opus page count exceeds limit {}", limits.max_pages),
                        });
                    }
                    offset = entry.offset + entry.header_len + entry.body_len;
                    pages.push(entry);
                }
            }
        }
        if pages.is_empty() {
            return Err(LibzciError::Unsupported {
                detail: "empty source".into(),
            });
        }
        // Serial/sequence/chained validation is the shared core rule.
        let _facts = validate_ogg_index(&pages)?;
        // Walk page bodies from the start, counting exactly two header
        // packets, and record where audio begins. Headers may share a
        // page with audio or occupy pages alone; counting packets (not
        // "first page with ≥2 packets") keeps audio intact either way.
        let mut header_packets: Vec<Vec<u8>> = Vec::new();
        let mut audio_start_page = 0usize;
        let mut audio_start_packet = 0usize;
        let mut carry: Vec<u8> = Vec::new();
        let mut pages_consumed = 0usize;
        for (i, page) in pages.iter().enumerate() {
            let body = scanner.read_at(page.offset + page.header_len, page.body_len as usize)?;
            if body.len() as u64 != page.body_len {
                return Err(LibzciError::Corrupt {
                    detail: "truncated Ogg page body".into(),
                });
            }
            // CRC check now that the body is in hand.
            let fixed = scanner.read_at(page.offset, page.header_len as usize)?;
            let stored = u32::from_le_bytes(fixed[22..26].try_into().unwrap());
            if ogg_crc(&fixed, &body, 22) != stored {
                return Err(LibzciError::Corrupt {
                    detail: format!("Ogg checksum mismatch at {}", page.offset),
                });
            }
            let lacing = scanner.read_at(page.offset + 27, (page.header_len - 27) as usize)?;
            let packets = split_packets_with_carry(&body, &lacing, &mut carry, page.header_type)?;
            pages_consumed = i + 1;
            let mut consumed_here = 0usize;
            for packet in &packets {
                if header_packets.len() < 2 {
                    header_packets.push(packet.clone());
                    consumed_here += 1;
                } else {
                    break;
                }
            }
            if header_packets.len() >= 2 {
                audio_start_page = i;
                audio_start_packet = consumed_here;
                break;
            }
            if i + 1 >= pages.len() {
                break;
            }
        }
        if header_packets.len() < 2 {
            return Err(LibzciError::Corrupt {
                detail: "missing OpusHead/OpusTags".into(),
            });
        }
        let _ = pages_consumed;
        let (channels, preskip, gain_linear) = parse_opus_head(&header_packets[0])?;
        let (vendor, comment_count) = parse_opus_tags(&header_packets[1])?;
        // Audible total: last valid granule minus preskip.
        let mut total_frames = None;
        for page in pages.iter().rev() {
            if page.granule != GRANULE_NONE {
                total_frames = Some(page.granule.saturating_sub(preskip));
                break;
            }
        }
        let total_frames = total_frames.ok_or_else(|| LibzciError::Corrupt {
            detail: "no Ogg granule position".into(),
        })?;
        let layout = PcmLayout::new(
            if channels == 1 {
                ChannelLayout::Mono
            } else {
                ChannelLayout::Stereo
            },
            48_000,
        )?;
        let channels_i = channels as std::os::raw::c_int;
        let mut error = 0;
        // SAFETY: valid args; null checked below.
        let decoder = unsafe { opus_ffi::opus_decoder_create(48_000, channels_i, &mut error) };
        if decoder.is_null() || error != opus_ffi::OPUS_OK {
            return Err(LibzciError::ResourceExhausted {
                detail: format!(
                    "opus_decoder_create failed: {}",
                    opus_ffi::error_string(error)
                ),
            });
        }
        Ok(Self {
            info: provider_info(),
            layout,
            headers: OpusHeaders {
                channels,
                preskip,
                gain_linear,
                vendor,
                comment_count,
            },
            total_frames,
            source,
            pages,
            audio_start_page,
            audio_start_packet,
            loaded_page: usize::MAX,
            loaded_packets: Vec::new(),
            loaded_index: 0,
            past_headers: false,
            seek_skip: None,
            carry: Vec::new(),
            decoder,
            scratch: vec![0.0; MAX_DECODE_FRAMES * 2],
            stash: std::collections::VecDeque::new(),
            pending_discard: preskip,
            position_frames: 0,
            finished: total_frames == 0,
        })
    }

    /// Linked reference libopus version (provenance proof).
    pub fn linked_version() -> String {
        opus_ffi::version_string()
    }

    /// Parsed OpusTags vendor string (diagnostics; tags never affect gain).
    pub fn vendor(&self) -> &str {
        &self.headers.vendor
    }

    /// Parsed comment count (diagnostics only).
    pub fn comment_count(&self) -> usize {
        self.headers.comment_count
    }

    /// Declared channel count from OpusHead.
    pub fn declared_channels(&self) -> u16 {
        self.headers.channels as u16
    }

    fn ensure_page_loaded(&mut self, cancel: &CancelFlag) -> Result<bool> {
        if self.loaded_index < self.loaded_packets.len() {
            return Ok(true);
        }
        // Advance to the next page with packet data.
        let mut next = if self.loaded_page == usize::MAX {
            0
        } else {
            self.loaded_page + 1
        };
        loop {
            if next >= self.pages.len() {
                return Ok(false);
            }
            // Never decode header-only pages as data: audio starts at
            // (audio_start_page, audio_start_packet) by exact count.
            if next < self.audio_start_page {
                self.loaded_page = next;
                next += 1;
                continue;
            }
            let page = self.pages[next];
            let scanner = PageScanner::new(&self.source, cancel);
            let body = scanner.read_at(page.offset + page.header_len, page.body_len as usize)?;
            if body.len() as u64 != page.body_len {
                return Err(LibzciError::Corrupt {
                    detail: format!("truncated Ogg page body at {}", page.offset),
                });
            }
            let fixed = scanner.read_at(page.offset, page.header_len as usize)?;
            let stored = u32::from_le_bytes(fixed[22..26].try_into().unwrap());
            if ogg_crc(&fixed, &body, 22) != stored {
                return Err(LibzciError::Corrupt {
                    detail: format!("Ogg checksum mismatch at {}", page.offset),
                });
            }
            let lacing = scanner.read_at(page.offset + 27, (page.header_len - 27) as usize)?;
            let mut packets =
                split_packets_with_carry(&body, &lacing, &mut self.carry, page.header_type)?;
            if !self.past_headers {
                // Drain exactly the header packets on the audio-start
                // page (a seek reload may ask for a different count via
                // seek_skip); pages past the headers decode in full.
                let skip = match self.seek_skip.take() {
                    Some((p, n)) if p == next => n,
                    Some((p, n)) => {
                        self.seek_skip = Some((p, n));
                        if next == self.audio_start_page {
                            self.audio_start_packet
                        } else {
                            0
                        }
                    }
                    None if next == self.audio_start_page => self.audio_start_packet,
                    None => 0,
                };
                let drop = skip.min(packets.len());
                packets.drain(..drop);
                // If the whole page was headers, keep scanning.
                if packets.is_empty() && self.carry.is_empty() {
                    self.loaded_page = next;
                    self.past_headers = true;
                    next += 1;
                    continue;
                }
                self.past_headers = true;
            }
            self.loaded_page = next;
            self.loaded_packets = packets;
            self.loaded_index = 0;
            if self.loaded_packets.is_empty() {
                next += 1;
                continue;
            }
            return Ok(true);
        }
    }

    fn decode_one_packet(&mut self, cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if !self.ensure_page_loaded(cancel)? {
            self.finished = true;
            return Ok(0);
        }
        let packet = self.loaded_packets[self.loaded_index].clone();
        self.loaded_index += 1;
        if packet.is_empty() {
            return Ok(0);
        }
        let channels = self.headers.channels as usize;
        let capacity_frames = MAX_DECODE_FRAMES;
        // SAFETY: decoder owned, scratch sized for capacity*channels.
        let decoded = unsafe {
            opus_ffi::opus_decode_float(
                self.decoder,
                packet.as_ptr(),
                packet.len() as i32,
                self.scratch.as_mut_ptr(),
                capacity_frames as std::os::raw::c_int,
                0,
            )
        };
        if decoded < 0 {
            if decoded == opus_ffi::OPUS_INVALID_PACKET {
                return Err(LibzciError::Corrupt {
                    detail: format!("invalid opus packet: {}", opus_ffi::error_string(decoded)),
                });
            }
            return Err(LibzciError::DecoderFailure {
                detail: format!("opus_decode_float: {}", opus_ffi::error_string(decoded)),
            });
        }
        let mut frames = decoded as usize;
        let mut start = 0usize;
        // Owed discards (preskip at stream start).
        if self.pending_discard > 0 {
            let drop = (self.pending_discard as usize).min(frames);
            start += drop;
            frames -= drop;
            self.pending_discard -= drop as u64;
        }
        // End trimming: never emit past the granule total.
        let remaining = self.total_frames.saturating_sub(self.position_frames) as usize;
        frames = frames.min(remaining);
        if frames == 0 {
            if self.position_frames >= self.total_frames {
                self.finished = true;
            }
            return Ok(0);
        }
        let gain = self.headers.gain_linear;
        for i in 0..frames {
            for ch in 0..channels {
                self.stash
                    .push_back(self.scratch[(start + i) * channels + ch] * gain);
            }
        }
        self.position_frames += frames as u64;
        if self.position_frames >= self.total_frames {
            self.finished = true;
        }
        Ok(frames * channels)
    }

    fn seek_aligned(&mut self, target: u64, cancel: &CancelFlag) -> Result<u64> {
        let target = target.min(self.total_frames);
        let granule_target = target + self.headers.preskip;
        // First page whose packet data ends past the target granule.
        let mut found = None;
        let mut prev_valid = 0u64;
        for (i, page) in self.pages.iter().enumerate() {
            if page.granule != GRANULE_NONE {
                if page.granule > granule_target {
                    found = Some((i, prev_valid));
                    break;
                }
                prev_valid = page.granule;
            }
        }
        // SAFETY: reset owned decoder in place.
        let rc = unsafe {
            opus_ffi::opus_decoder_init(
                self.decoder,
                48_000,
                self.headers.channels as std::os::raw::c_int,
            )
        };
        if rc != opus_ffi::OPUS_OK {
            return Err(LibzciError::DecoderFailure {
                detail: format!("opus_decoder_init: {}", opus_ffi::error_string(rc)),
            });
        }
        self.stash.clear();
        self.finished = false;
        match found {
            None => {
                // Target at/past the audible end.
                self.position_frames = self.total_frames;
                self.pending_discard = 0;
                self.stash.clear();
                self.loaded_packets.clear();
                self.loaded_index = 0;
                self.seek_skip = None;
                self.finished = true;
                Ok(self.position_frames)
            }
            Some((page_idx, prev)) => {
                // Walk back over continued packets so the preroll starts
                // at a fresh packet; never walk into header pages.
                let mut start = page_idx;
                while start > self.audio_start_page && self.pages[start].header_type & 0x01 != 0 {
                    start -= 1;
                }
                self.loaded_page = start.wrapping_sub(1);
                // Ensure the very next load lands on `start` even when
                // `start` is 0 (wrapping_sub underflows to MAX and the
                // loader treats MAX as "start from 0").
                if start == 0 {
                    self.loaded_page = usize::MAX;
                }
                self.loaded_packets.clear();
                self.loaded_index = 0;
                self.carry.clear();
                self.past_headers = false;
                self.seek_skip = Some((
                    start,
                    if start == self.audio_start_page {
                        self.audio_start_packet
                    } else {
                        0
                    },
                ));
                self.position_frames = target;
                // Decode-and-discard from the page start: this both lands
                // the cursor and prerolls the decoder. Granule windows
                // keep preskip/end-trim exact: decoded block k covers
                // granules [granule_pos, granule_pos + got), of which
                // [granule_target, preskip + total) is audible output.
                // Only the crossing block's tail is stashed; later
                // packets decode on demand with identical state.
                let audible_end = self.headers.preskip + self.total_frames;
                let mut granule_pos = prev;
                let mut kept = 0u64;
                let mut empty_skips = 0u32;
                while granule_pos < granule_target {
                    cancel.check()?;
                    if !self.ensure_page_loaded(cancel)? {
                        break;
                    }
                    let packet = self.loaded_packets[self.loaded_index].clone();
                    self.loaded_index += 1;
                    if packet.is_empty() {
                        empty_skips += 1;
                        if empty_skips > 1024 {
                            return Err(LibzciError::Corrupt {
                                detail: "too many empty packets during seek preroll".into(),
                            });
                        }
                        continue;
                    }
                    let decoded = unsafe {
                        opus_ffi::opus_decode_float(
                            self.decoder,
                            packet.as_ptr(),
                            packet.len() as i32,
                            self.scratch.as_mut_ptr(),
                            MAX_DECODE_FRAMES as std::os::raw::c_int,
                            0,
                        )
                    };
                    if decoded < 0 {
                        return Err(LibzciError::Corrupt {
                            detail: format!(
                                "invalid opus packet during seek: {}",
                                opus_ffi::error_string(decoded)
                            ),
                        });
                    }
                    let got = decoded as u64;
                    let keep_start = granule_pos.max(granule_target);
                    let keep_end = (granule_pos + got).min(audible_end);
                    if keep_end > keep_start {
                        let drop = (keep_start - granule_pos) as usize;
                        let keep = (keep_end - keep_start) as usize;
                        let channels = self.headers.channels as usize;
                        let gain = self.headers.gain_linear;
                        for i in 0..keep {
                            for ch in 0..channels {
                                self.stash
                                    .push_back(self.scratch[(drop + i) * channels + ch] * gain);
                            }
                        }
                        kept += keep as u64;
                    }
                    granule_pos += got;
                }
                if granule_pos < granule_target {
                    return Err(LibzciError::Corrupt {
                        detail: format!(
                            "seek preroll exhausted before target {target} (granule {granule_pos} < {granule_target})"
                        ),
                    });
                }
                self.position_frames = target + kept;
                self.pending_discard = 0;
                if self.position_frames >= self.total_frames {
                    self.finished = true;
                }
                Ok(target)
            }
        }
    }
}

impl Drop for OpusInstance {
    fn drop(&mut self) {
        if !self.decoder.is_null() {
            // SAFETY: created by opus_decoder_create, owned here.
            unsafe { opus_ffi::opus_decoder_destroy(self.decoder) };
            self.decoder = std::ptr::null_mut();
        }
    }
}

impl DecoderInstance for OpusInstance {
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
        self.position_frames
    }

    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if out.is_empty() {
            return Ok(0);
        }
        // Drain stash first.
        let mut written = 0;
        while written < out.len() {
            match self.stash.pop_front() {
                Some(s) => {
                    out[written] = s;
                    written += 1;
                }
                None => break,
            }
        }
        while written < out.len() && !self.finished {
            let before = self.stash.len();
            let produced = self.decode_one_packet(cancel)?;
            if produced == 0 && self.stash.len() == before {
                break;
            }
            while written < out.len() {
                match self.stash.pop_front() {
                    Some(s) => {
                        out[written] = s;
                        written += 1;
                    }
                    None => break,
                }
            }
        }
        // Validate finished state against the granule total.
        if self.finished {
            self.position_frames = self.position_frames.min(self.total_frames);
        }
        Ok(written)
    }

    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        cancel.check()?;
        self.seek_aligned(frame, cancel)
    }

    fn metadata(&self) -> ProviderMetadata {
        ProviderMetadata {
            info: self.info,
            layout: self.layout,
            total_frames: Some(self.total_frames),
            applied: AppliedAdjustments {
                trimmed_preskip: true,
                trimmed_end: true,
                applied_header_gain: true,
            },
            declared_channels: self.headers.channels as u16,
            comments: Vec::new(),
        }
    }
}
