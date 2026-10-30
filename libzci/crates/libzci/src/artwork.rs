//! On-demand bounded artwork extraction. Encoded originals are transient;
//! only rebuildable renditions may enter the separate artwork cache.
//! Framing follows ID3v2 APIC/PIC and RFC 9639 §8.8 (FLAC PICTURE),
//! including base64 METADATA_BLOCK_PICTURE comments in Vorbis/Opus.
use crate::embedded_metadata::{budget, corrupt, MetadataVisitor};
use crate::{CancelFlag, Result, RuntimeSource};
use base64::Engine;
pub const MAX_ARTWORK_BYTES: usize = 16 * 1024 * 1024;
const HEADER_BYTES: usize = 8448;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncodedArtwork {
    pub mime: &'static str,
    pub picture_type: u32,
    pub bytes: Vec<u8>,
}
/// Content identification only; dimensions, pixel budgets and decoding are
/// checked by the image provider before any surface or rendition is created.
pub fn raster_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"BM") {
        Some("image/bmp")
    } else if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        Some("image/tiff")
    } else if bytes.starts_with(b"\xff\x0a") || bytes.starts_with(b"\0\0\0\x0cJXL \r\n\x87\n") {
        Some("image/jxl")
    } else if bytes.get(4..8) == Some(b"ftyp")
        && bytes
            .get(8..12)
            .is_some_and(|b| b == b"avif" || b == b"avis")
    {
        Some("image/avif")
    } else {
        None
    }
}
fn terminator(data: &[u8], encoding: u8) -> Result<usize> {
    let end = match encoding {
        0 | 3 => data.iter().position(|b| *b == 0).map(|n| n + 1),
        1 | 2 => data
            .chunks_exact(2)
            .position(|b| b == [0, 0])
            .map(|n| 2 * n + 2),
        _ => return Err(corrupt("invalid artwork description encoding")),
    };
    end.filter(|n| *n <= 8192)
        .ok_or_else(|| corrupt("unterminated/oversized artwork description"))
}
fn be32(data: &[u8], at: &mut usize) -> Result<u32> {
    let value = data
        .get(*at..*at + 4)
        .ok_or_else(|| corrupt("truncated picture field"))?;
    *at += 4;
    Ok(u32::from_be_bytes(value.try_into().unwrap()))
}
fn field<'a>(data: &'a [u8], at: &mut usize, limit: usize) -> Result<&'a [u8]> {
    let length = be32(data, at)? as usize;
    if length > limit {
        return Err(budget("picture field exceeds budget"));
    }
    let end = at
        .checked_add(length)
        .filter(|n| *n <= data.len())
        .ok_or_else(|| corrupt("truncated picture field"))?;
    let value = &data[*at..end];
    *at = end;
    Ok(value)
}
fn picture_header(data: &[u8]) -> Result<Option<(u32, usize, usize)>> {
    let mut at = 0;
    let kind = be32(data, &mut at)?;
    if kind > 20 {
        return Err(corrupt("invalid picture type"));
    }
    let mime = field(data, &mut at, 128)?;
    if mime == b"-->" {
        return Ok(None);
    }
    let _description = field(data, &mut at, 8192)?;
    // Embedded dimensions are hints only; trust the image decoder's facts.
    for _ in 0..4 {
        be32(data, &mut at)?;
    }
    let length = be32(data, &mut at)? as usize;
    if length > MAX_ARTWORK_BYTES {
        return Err(budget("picture data exceeds 16 MiB"));
    }
    Ok(Some((kind, at, length)))
}
#[derive(Default)]
struct ArtworkVisitor {
    selected: Option<EncodedArtwork>,
    payload_reads: usize,
}
impl ArtworkVisitor {
    fn candidate(&self, kind: u32) -> bool {
        self.selected.is_none() || kind == 3
    }
    fn reserve(&mut self, size: usize) -> Result<()> {
        self.payload_reads = self
            .payload_reads
            .checked_add(size)
            .ok_or_else(|| budget("artwork read budget"))?;
        if self.payload_reads > MAX_ARTWORK_BYTES * 2 {
            return Err(budget("artwork payload reads exceed 32 MiB"));
        }
        Ok(())
    }
    fn select(&mut self, kind: u32, data: &[u8]) -> Result<bool> {
        if data.len() > MAX_ARTWORK_BYTES {
            return Err(budget("artwork exceeds 16 MiB"));
        }
        if !data.is_empty() && self.candidate(kind) {
            if let Some(mime) = raster_mime(data) {
                self.selected = Some(EncodedArtwork {
                    mime,
                    picture_type: kind,
                    bytes: data.to_vec(),
                });
                return Ok(kind == 3);
            }
        }
        Ok(false)
    }
    fn picture_data(&mut self, data: &[u8]) -> Result<bool> {
        let Some((kind, at, len)) = picture_header(data)? else {
            return Ok(false);
        };
        let bytes = data
            .get(
                at..at
                    .checked_add(len)
                    .ok_or_else(|| corrupt("picture range overflow"))?,
            )
            .ok_or_else(|| corrupt("truncated picture data"))?;
        if at + len != data.len() {
            return Err(corrupt("trailing picture block data"));
        }
        self.select(kind, bytes)
    }
}
impl MetadataVisitor for ArtworkVisitor {
    fn block_limit(&self) -> usize {
        24 * 1024 * 1024
    }
    fn id3(
        &mut self,
        name: &[u8],
        size: usize,
        version: u8,
        supported: bool,
        read: &dyn Fn(usize) -> Result<Vec<u8>>,
    ) -> Result<bool> {
        if !supported || (name != b"APIC" && name != b"PIC") {
            return Ok(false);
        }
        let prefix = read(size.min(HEADER_BYTES))?;
        let encoding = *prefix.first().ok_or_else(|| corrupt("truncated APIC"))?;
        let (mime, mut at) = if version == 2 {
            (
                prefix
                    .get(1..4)
                    .ok_or_else(|| corrupt("truncated PIC format"))?,
                4,
            )
        } else {
            let end = prefix
                .get(1..)
                .and_then(|s| s.iter().take(129).position(|b| *b == 0))
                .ok_or_else(|| corrupt("invalid APIC MIME"))?
                + 1;
            (&prefix[1..end], end + 1)
        };
        if mime == b"-->" {
            return Ok(false);
        }
        let kind = *prefix
            .get(at)
            .ok_or_else(|| corrupt("missing picture type"))? as u32;
        at += 1;
        if kind > 20 {
            return Err(corrupt("invalid picture type"));
        }
        if !self.candidate(kind) {
            return Ok(false);
        }
        at += terminator(
            prefix
                .get(at..)
                .ok_or_else(|| corrupt("missing picture description"))?,
            encoding,
        )?;
        if size.saturating_sub(at) > MAX_ARTWORK_BYTES {
            return Err(budget("encoded APIC data exceeds 16 MiB"));
        }
        if size > MAX_ARTWORK_BYTES + HEADER_BYTES {
            return Err(budget("APIC frame exceeds budget"));
        }
        self.reserve(size)?;
        let payload = read(size)?;
        self.select(
            kind,
            payload
                .get(at..)
                .ok_or_else(|| corrupt("truncated picture data"))?,
        )
    }
    fn picture(&mut self, size: usize, read: &dyn Fn(usize) -> Result<Vec<u8>>) -> Result<bool> {
        let prefix = read(size.min(HEADER_BYTES))?;
        let Some((kind, _, _)) = picture_header(&prefix)? else {
            return Ok(false);
        };
        if !self.candidate(kind) {
            return Ok(false);
        }
        if size > MAX_ARTWORK_BYTES + HEADER_BYTES {
            return Err(budget("picture block exceeds budget"));
        }
        self.reserve(size)?;
        self.picture_data(&read(size)?)
    }
    fn comment(&mut self, key: &[u8], value: &[u8]) -> Result<bool> {
        if !key.eq_ignore_ascii_case(b"METADATA_BLOCK_PICTURE") {
            return Ok(false);
        }
        if value.len() > (MAX_ARTWORK_BYTES + HEADER_BYTES).div_ceil(3) * 4 {
            return Err(budget("base64 picture exceeds budget"));
        }
        // Bound total candidate decoding as well as retained output. Never fetch
        // external picture links and never use an untrusted MIME for output.
        self.reserve(value.len().saturating_mul(3) / 4)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(value.trim_ascii())
            .map_err(|_| corrupt("invalid base64 picture"))?;
        self.picture_data(&bytes)
    }
}
pub fn read_embedded_artwork(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
) -> Result<Option<EncodedArtwork>> {
    let mut visitor = ArtworkVisitor::default();
    crate::embedded_metadata::scan(source, cancel, &mut visitor)?;
    cancel.check()?;
    Ok(visitor.selected)
}
