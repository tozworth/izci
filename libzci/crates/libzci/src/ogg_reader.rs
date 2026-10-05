//! Shared Ogg container reader.
//!
//! One implementation serves the native Opus provider
//! (`libzci-codecs`) and the browser decode worker (`libzci-web`):
//! page headers, lacing tables, continued packets, checksums, and the
//! granule index. Codec payloads (OpusHead/Tags, packet decode) stay
//! in provider modules; this module never interprets packet contents.
//!
//! All reads through [`PageScanner`] are bounded single slices — no
//! whole-file copies — and every function reports
//! [`LibzciError::Corrupt`] for damaged framing rather than guessing.

use std::sync::Arc;

use crate::error::{LibzciError, Result};
use crate::source::{CancelFlag, RuntimeSource};

/// Granule value meaning "no packet ends on this page".
pub const GRANULE_NONE: u64 = u64::MAX;

/// Largest single source read the reader ever issues (max Ogg page
/// body plus header slack).
pub const MAX_SINGLE_READ: usize = 65536 + 512;

/// One Ogg page location plus its framing facts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PageEntry {
    /// Absolute source offset of the page start (`OggS` magic).
    pub offset: u64,
    /// Page granule position (`GRANULE_NONE` when no packet ends here).
    pub granule: u64,
    /// Logical bitstream serial.
    pub serial: u32,
    /// Page sequence number.
    pub seq: u32,
    /// Ogg header-type flags (continued/BOS/EOS bits).
    pub header_type: u8,
    /// Full header length (27 + segment count).
    pub header_len: u64,
    /// Body length (sum of lacing values).
    pub body_len: u64,
}

fn ogg_crc_table() -> &'static [u32; 256] {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    TABLE.get_or_init(|| {
        let mut table = [0u32; 256];
        for i in 0..256 {
            let mut r = (i as u32) << 24;
            for _ in 0..8 {
                r = if r & 0x8000_0000 != 0 {
                    (r << 1) ^ 0x04C1_1DB7
                } else {
                    r << 1
                };
            }
            table[i] = r;
        }
        table
    })
}

/// Ogg CRC32 over a page header (with the 4 checksum bytes at
/// `checksum_offset` zeroed) plus its body.
pub fn ogg_crc(header: &[u8], body: &[u8], checksum_offset: usize) -> u32 {
    let table = ogg_crc_table();
    let mut crc = 0u32;
    for (i, &b) in header.iter().enumerate() {
        let byte = if (checksum_offset..checksum_offset + 4).contains(&i) {
            0
        } else {
            b
        };
        crc = table[((crc >> 24) ^ byte as u32) as usize & 0xFF] ^ (crc << 8);
    }
    for &b in body {
        crc = table[((crc >> 24) ^ b as u32) as usize & 0xFF] ^ (crc << 8);
    }
    crc
}

/// Split one page body into packets, threading `carry` for packets
/// continued across page boundaries. `header_type & 0x01` marks a page
/// whose first packet continues the previous page; a pending carry
/// without that flag is corrupt framing (truncated packet).
pub fn split_packets_with_carry(
    body: &[u8],
    lacing: &[u8],
    carry: &mut Vec<u8>,
    header_type: u8,
) -> Result<Vec<Vec<u8>>> {
    let mut packets = Vec::new();
    let mut pos = 0usize;
    let mut current: Vec<u8> = if header_type & 0x01 != 0 {
        std::mem::take(carry)
    } else {
        if !carry.is_empty() {
            return Err(LibzciError::Corrupt {
                detail: "ogg continued packet missing its tail page".into(),
            });
        }
        Vec::new()
    };
    let mut in_continued = header_type & 0x01 != 0;
    for &seg in lacing {
        let end = (pos + seg as usize).min(body.len());
        current.extend_from_slice(&body[pos..end]);
        pos = end;
        if seg < 255 {
            packets.push(std::mem::take(&mut current));
            in_continued = false;
        } else {
            in_continued = true;
        }
    }
    if in_continued {
        *carry = current;
    } else if !current.is_empty() {
        packets.push(current);
    }
    Ok(packets)
}

/// Validated Ogg index facts shared by native and browser opens.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IndexFacts {
    /// Logical bitstream serial shared by all pages.
    pub serial: u32,
}

/// Validate a scanned page index: non-empty, first page BOS, single
/// serial, contiguous sequence, no chained second BOS (chained Ogg is
/// an explicit named gap, later coverage).
pub fn validate_ogg_index(pages: &[PageEntry]) -> Result<IndexFacts> {
    use crate::error::LibzciError;
    let first = pages.first().ok_or_else(|| LibzciError::Unsupported {
        detail: "empty source".into(),
    })?;
    if first.header_type & 0x02 == 0 {
        return Err(LibzciError::Corrupt {
            detail: "first Ogg page is not BOS".into(),
        });
    }
    for (i, page) in pages.iter().enumerate() {
        if page.serial != first.serial {
            return Err(LibzciError::Corrupt {
                detail: "Ogg serial changed mid-stream".into(),
            });
        }
        if page.seq as usize != i {
            return Err(LibzciError::Corrupt {
                detail: "Ogg page sequence gap".into(),
            });
        }
        if page.header_type & 0x02 != 0 && i != 0 {
            return Err(LibzciError::Unsupported {
                detail: "chained Ogg (named gap; later coverage)".into(),
            });
        }
    }
    Ok(IndexFacts { serial: first.serial })
}

/// Bounded random-access page scanner over any [`RuntimeSource`].
pub struct PageScanner<'a> {
    /// Source to read from.
    pub source: &'a Arc<dyn RuntimeSource>,
    /// Cooperative cancellation.
    pub cancel: &'a CancelFlag,
    /// Upper bound for any single read (defaults to
    /// [`MAX_SINGLE_READ`]).
    pub max_single_read: usize,
}

impl<'a> PageScanner<'a> {
    /// Create with the default single-read bound.
    pub fn new(source: &'a Arc<dyn RuntimeSource>, cancel: &'a CancelFlag) -> Self {
        Self {
            source,
            cancel,
            max_single_read: MAX_SINGLE_READ,
        }
    }

    /// Read up to `len` bytes at `offset` (short at EOF).
    pub fn read_at(&self, offset: u64, len: usize) -> Result<Vec<u8>> {
        if len > self.max_single_read {
            return Err(LibzciError::ResourceExhausted {
                detail: format!("page read {len} exceeds bound {}", self.max_single_read),
            });
        }
        let mut buf = vec![0u8; len];
        let mut filled = 0;
        while filled < len {
            let n = self.source.read_at(offset + filled as u64, &mut buf[filled..], self.cancel)?;
            if n == 0 {
                break;
            }
            filled += n;
        }
        buf.truncate(filled);
        Ok(buf)
    }

    /// Read one page entry at `offset`; `Ok(None)` at clean EOF.
    pub fn read_page_entry(&self, offset: u64) -> Result<Option<PageEntry>> {
        let fixed = self.read_at(offset, 27)?;
        if fixed.is_empty() {
            return Ok(None);
        }
        if fixed.len() < 27 {
            return Err(LibzciError::Corrupt {
                detail: format!("truncated ogg page header at {offset}"),
            });
        }
        if &fixed[0..4] != b"OggS" {
            return Err(LibzciError::Corrupt {
                detail: format!("not an Ogg page at {offset}"),
            });
        }
        if fixed[4] != 0 {
            return Err(LibzciError::Corrupt {
                detail: "unsupported Ogg stream version".into(),
            });
        }
        let header_type = fixed[5];
        let granule = u64::from_le_bytes(fixed[6..14].try_into().unwrap());
        let serial = u32::from_le_bytes(fixed[14..18].try_into().unwrap());
        let seq = u32::from_le_bytes(fixed[18..22].try_into().unwrap());
        let seg_count = fixed[26] as usize;
        let lacing = self.read_at(offset + 27, seg_count)?;
        if lacing.len() < seg_count {
            return Err(LibzciError::Corrupt {
                detail: "truncated Ogg lacing table".into(),
            });
        }
        let body_len: u64 = lacing.iter().map(|&s| s as u64).sum();
        Ok(Some(PageEntry {
            offset,
            granule,
            serial,
            seq,
            header_type,
            header_len: (27 + seg_count) as u64,
            body_len,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::source::MemSource;

    fn page(granule: u64, seq: u32, lacing: &[u8], body: &[u8]) -> Vec<u8> {
        let mut header = vec![0u8; 27 + lacing.len()];
        header[0..4].copy_from_slice(b"OggS");
        header[5] = if seq == 0 { 0x02 } else { 0x00 };
        header[6..14].copy_from_slice(&granule.to_le_bytes());
        header[14..18].copy_from_slice(&1u32.to_le_bytes());
        header[18..22].copy_from_slice(&seq.to_le_bytes());
        header[26] = lacing.len() as u8;
        header[27..].copy_from_slice(lacing);
        let crc = ogg_crc(&header, body, 22);
        header[22..26].copy_from_slice(&crc.to_le_bytes());
        [header, body.to_vec()].concat()
    }

    #[test]
    fn pages_split_and_verify() {
        let body = b"hello world";
        let bytes = [page(0, 0, &[11], body), page(11, 1, &[5], b"abcde")].concat();
        let source: Arc<dyn RuntimeSource> = Arc::new(MemSource::new(bytes));
        let cancel = CancelFlag::default();
        let scanner = PageScanner::new(&source, &cancel);
        let first = scanner.read_page_entry(0).unwrap().unwrap();
        assert_eq!(first.granule, 0);
        assert_eq!(first.body_len, 11);
        let body_bytes = scanner.read_at(first.offset + first.header_len, 11).unwrap();
        let fixed = scanner.read_at(0, first.header_len as usize).unwrap();
        let stored = u32::from_le_bytes(fixed[22..26].try_into().unwrap());
        assert_eq!(ogg_crc(&fixed, &body_bytes, 22), stored);
        let mut carry = Vec::new();
        let packets = split_packets_with_carry(&body_bytes, &[11], &mut carry, 0).unwrap();
        assert_eq!(packets, vec![b"hello world".to_vec()]);
    }

    #[test]
    fn continued_without_flag_is_corrupt() {
        let mut carry = b"partial".to_vec();
        let err = split_packets_with_carry(b"tail", &[4], &mut carry, 0x00).unwrap_err();
        assert_eq!(err.kind(), "corrupt");
    }
}
