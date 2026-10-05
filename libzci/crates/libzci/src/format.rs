//! Centralized format identification policy.
//!
//! Extension hints and sniffed content decide provider selection here,
//! once, so native and browser factories agree. An extension is only a
//! hint; sniffed bytes outrank it, and unknown bytes are declined
//! (never guessed). Module families land here in Phase 1.4.

use crate::error::{LibzciError, Result};

/// Extensions that suggest (never prove) Ogg Opus content.
pub const OPUS_EXTENSIONS: &[&str] = &["opus", "ogg", "oga"];

/// Extensions suggesting tracker-module content (libopenmpt surface).
pub const MODULE_EXTENSIONS: &[&str] = &[
    "mod", "mptm", "s3m", "xm", "it", "mo3", "669", "amf", "ams", "dbm", "digi", "dmf", "dsm",
    "far", "gdm", "imf", "j2b", "mdl", "med", "mt2", "mtm", "okt", "psm", "ptm", "s3z", "stm",
    "stx", "ult", "umx", "xmz", "itz",
];

/// Extensions suggesting Hively content.
pub const HIVELY_EXTENSIONS: &[&str] = &["ahx", "hvl"];

/// Normalized Opus identification facts from an `OpusHead` packet.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct OpusStreamParams {
    /// Declared channel count (1–2; more is a named gap).
    pub channels: u8,
    /// Pre-skip in 48 kHz samples, discarded before the timeline.
    pub preskip: u64,
    /// Mandatory header output gain in Q8 dB units (applied by the
    /// provider with zero additional offset).
    pub gain_q8: i16,
    /// Channel mapping family (0 only; 1+ is a named gap).
    pub family: u8,
}

impl OpusStreamParams {
    /// Linear gain multiplier for the mandatory header output gain.
    pub fn gain_linear(&self) -> Result<f32> {
        let linear = 10f64.powf(self.gain_q8 as f64 / 256.0 / 20.0) as f32;
        if !linear.is_finite() || linear < 0.0 {
            return Err(LibzciError::Corrupt {
                detail: "non-finite OpusHead output gain".into(),
            });
        }
        Ok(linear)
    }

    /// Enforce the Phase 1.2 channel/mapping policy.
    pub fn check_supported(&self) -> Result<()> {
        if self.channels == 0 || self.channels > 2 {
            return Err(LibzciError::Unsupported {
                detail: format!("opus channel count {} (multichannel is a named gap)", self.channels),
            });
        }
        if self.family != 0 {
            return Err(LibzciError::Unsupported {
                detail: format!("opus mapping family {} (named gap)", self.family),
            });
        }
        Ok(())
    }
}

/// Parse a full `OpusHead` packet (≥19 bytes).
pub fn parse_opus_head_packet(packet: &[u8]) -> Result<OpusStreamParams> {
    if packet.len() < 19 || &packet[0..8] != b"OpusHead" {
        return Err(LibzciError::Corrupt {
            detail: "first Ogg packet is not OpusHead".into(),
        });
    }
    if packet[8] != 1 {
        return Err(LibzciError::Unsupported {
            detail: format!("OpusHead version {} (expected 1)", packet[8]),
        });
    }
    let params = OpusStreamParams {
        channels: packet[9],
        preskip: u16::from_le_bytes([packet[10], packet[11]]) as u64,
        gain_q8: i16::from_le_bytes([packet[16], packet[17]]),
        family: packet[18],
    };
    params.check_supported()?;
    Ok(params)
}

/// Sniff an Ogg first page for Opus content. `None` means "not Opus"
/// (the factory must decline, even with an `.opus` extension hint).
pub fn sniff_opus_head_page(header: &[u8]) -> Option<OpusStreamParams> {
    if header.len() < 28 || &header[0..4] != b"OggS" || header[4] != 0 {
        return None;
    }
    let seg_count = header[26] as usize;
    if header.len() < 27 + seg_count {
        return None;
    }
    let body_start = 27 + seg_count;
    let lacing = &header[27..27 + seg_count];
    let mut first_len = 0usize;
    for &seg in lacing {
        first_len += seg as usize;
        if seg < 255 {
            break;
        }
    }
    if first_len < 19 || header.len() < body_start + 19 {
        return None;
    }
    let packet = &header[body_start..];
    if &packet[0..8] != b"OpusHead" || packet[8] != 1 {
        return None;
    }
    let params = OpusStreamParams {
        channels: packet[9],
        preskip: u16::from_le_bytes([packet[10], packet[11]]) as u64,
        gain_q8: i16::from_le_bytes([packet[16], packet[17]]),
        family: packet[18],
    };
    params.check_supported().ok()?;
    Some(params)
}

/// Whether an extension hint suggests Ogg Opus (hint only).
pub fn is_opus_extension_hint(ext: &str) -> bool {
    OPUS_EXTENSIONS.contains(&ext)
}

/// Whether an extension hint suggests tracker-module content.
pub fn is_module_extension_hint(ext: &str) -> bool {
    MODULE_EXTENSIONS.contains(&ext)
}

/// Whether an extension hint suggests Hively content.
pub fn is_hively_extension_hint(ext: &str) -> bool {
    HIVELY_EXTENSIONS.contains(&ext)
}

/// Which module family sniffed bytes claim.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModuleFamily {
    /// libopenmpt surface (MOD/XM/S3M/IT/MO3 magics).
    Openmpt,
    /// HivelyTracker replay surface.
    Hively(HivelyKind),
}

/// AHX vs HVL flavor.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HivelyKind {
    /// `THX` magic.
    Ahx,
    /// `HVL` magic.
    Hvl,
}

/// Sniff tracker-module magics in a header (needs 1084+ bytes for MOD,
/// far less for the rest). Returns the claimed family, if any.
pub fn sniff_module_family(header: &[u8]) -> Option<ModuleFamily> {
    if header.len() >= 3 {
        if &header[0..3] == b"THX" {
            return Some(ModuleFamily::Hively(HivelyKind::Ahx));
        }
        if &header[0..3] == b"HVL" {
            return Some(ModuleFamily::Hively(HivelyKind::Hvl));
        }
    }
    if header.starts_with(b"Extended Module: ") {
        return Some(ModuleFamily::Openmpt);
    }
    if header.len() >= 4 && &header[0..4] == b"IMPM" {
        return Some(ModuleFamily::Openmpt);
    }
    if header.len() >= 48 && &header[44..48] == b"SCRM" {
        return Some(ModuleFamily::Openmpt);
    }
    if header.len() >= 3 && &header[0..3] == b"MO3" {
        return Some(ModuleFamily::Openmpt);
    }
    if header.len() >= 1084 {
        let tag = &header[1080..1084];
        // ProTracker 4-channel, TakeTracker, and `xCHN`/`xxCH` clones.
        if tag == b"M.K."
            || tag == b"M!K!"
            || tag == b"FLT4"
            || tag == b"FLT8"
            || tag == b"CD81"
            || tag == b"OKTA"
            || tag.ends_with(b"CHN")
            || tag.ends_with(b"CH")
            || tag.starts_with(b"TDZ")
            || tag.starts_with(b"FLT")
        {
            return Some(ModuleFamily::Openmpt);
        }
    }
    None
}

/// Parsed `OpusTags` facts. Tags are diagnostics only: ReplayGain and
/// R128 tags are never applied by providers (core policy, later).
#[derive(Clone, Debug)]
pub struct OpusTags {
    /// Vendor string.
    pub vendor: String,
    /// Comment entry count.
    pub comment_count: usize,
}

/// Parse an `OpusTags` packet (≥8 bytes).
pub fn parse_opus_tags_packet(packet: &[u8]) -> Result<OpusTags> {
    if packet.len() < 8 || &packet[0..8] != b"OpusTags" {
        return Err(LibzciError::Corrupt {
            detail: "second Ogg packet is not OpusTags".into(),
        });
    }
    let mut pos = 8usize;
    let read_u32 = |pos: &mut usize| -> Result<u32> {
        if packet.len() < *pos + 4 {
            return Err(LibzciError::Corrupt {
                detail: "truncated OpusTags".into(),
            });
        }
        let v = u32::from_le_bytes(packet[*pos..*pos + 4].try_into().unwrap());
        *pos += 4;
        Ok(v)
    };
    let vendor_len = read_u32(&mut pos)? as usize;
    if packet.len() < pos + vendor_len {
        return Err(LibzciError::Corrupt {
            detail: "truncated OpusTags vendor".into(),
        });
    }
    let vendor = String::from_utf8_lossy(&packet[pos..pos + vendor_len]).into_owned();
    pos += vendor_len;
    let comment_count = read_u32(&mut pos)? as usize;
    for _ in 0..comment_count {
        let len = read_u32(&mut pos)? as usize;
        if packet.len() < pos + len {
            return Err(LibzciError::Corrupt {
                detail: "truncated OpusTags comment".into(),
            });
        }
        pos += len;
    }
    Ok(OpusTags {
        vendor,
        comment_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_opus_pages() {
        assert!(sniff_opus_head_page(b"not ogg").is_none());
        assert!(sniff_opus_head_page(&[0u8; 64]).is_none());
    }

    #[test]
    fn parses_head_packet_with_policy() {
        let mut packet = vec![0u8; 19];
        packet[0..8].copy_from_slice(b"OpusHead");
        packet[8] = 1;
        packet[9] = 2;
        let params = parse_opus_head_packet(&packet).unwrap();
        assert_eq!(params.channels, 2);
        assert!((params.gain_linear().unwrap() - 1.0).abs() < 1e-6);
        packet[9] = 6;
        assert_eq!(
            parse_opus_head_packet(&packet).unwrap_err().kind(),
            "unsupported"
        );
    }

    #[test]
    fn sniffs_module_magics() {
        assert_eq!(sniff_module_family(b"THX rest"), Some(ModuleFamily::Hively(HivelyKind::Ahx)));
        assert_eq!(sniff_module_family(b"HVL rest"), Some(ModuleFamily::Hively(HivelyKind::Hvl)));
        assert_eq!(
            sniff_module_family(b"Extended Module: title"),
            Some(ModuleFamily::Openmpt)
        );
        let mut mod_bytes = vec![0u8; 1084];
        mod_bytes[1080..1084].copy_from_slice(b"M.K.");
        assert_eq!(sniff_module_family(&mod_bytes), Some(ModuleFamily::Openmpt));
        mod_bytes[1080..1084].copy_from_slice(b"8CHN");
        assert_eq!(sniff_module_family(&mod_bytes), Some(ModuleFamily::Openmpt));
        assert_eq!(sniff_module_family(b"garbage bytes here"), None);
        assert!(is_module_extension_hint("xm") && !is_module_extension_hint("opus"));
        assert!(is_hively_extension_hint("ahx") && !is_hively_extension_hint("mod"));
    }
}
