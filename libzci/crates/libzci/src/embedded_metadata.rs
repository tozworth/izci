//! Shared ranged ID3/FLAC/Ogg framing. Visitors select only requested payloads;
//! scanning never opens a decoder, creates output, or mutates persistent state.
use crate::{CancelFlag, LibzciError, Result, RuntimeSource};

const SCAN_LIMIT: u64 = 64 * 1024 * 1024;
pub(crate) fn corrupt(detail: &str) -> LibzciError {
    LibzciError::Corrupt {
        detail: detail.into(),
    }
}
pub(crate) fn budget(detail: &str) -> LibzciError {
    LibzciError::ResourceExhausted {
        detail: detail.into(),
    }
}
fn exact(
    source: &dyn RuntimeSource,
    offset: u64,
    length: usize,
    cancel: &CancelFlag,
    limit: usize,
) -> Result<Vec<u8>> {
    if length > limit {
        return Err(budget("embedded metadata block exceeds budget"));
    }
    let end = offset
        .checked_add(length as u64)
        .ok_or_else(|| corrupt("metadata range overflow"))?;
    if source.len().is_some_and(|len| end > len) {
        return Err(corrupt("truncated embedded metadata"));
    }
    let mut data = vec![0; length];
    let mut filled = 0;
    while filled < length {
        cancel.check()?;
        let end = (filled + 32768).min(length);
        let n = source.read_at(offset + filled as u64, &mut data[filled..end], cancel)?;
        if n == 0 || n > end - filled {
            return Err(corrupt("short embedded metadata read"));
        }
        filled += n;
    }
    Ok(data)
}
fn synchsafe(b: &[u8]) -> Result<usize> {
    if b.len() != 4 || b.iter().any(|n| n & 0x80 != 0) {
        return Err(corrupt("invalid ID3 synchsafe size"));
    }
    Ok(b.iter().fold(0, |n, b| (n << 7) | *b as usize))
}
fn unsync(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        out.push(data[i]);
        if data[i] == 255 && data.get(i + 1) == Some(&0) {
            i += 1;
        }
        i += 1;
    }
    out
}
pub(crate) trait MetadataVisitor {
    fn block_limit(&self) -> usize {
        4 * 1024 * 1024
    }
    fn id3(
        &mut self,
        _name: &[u8],
        _size: usize,
        _version: u8,
        _supported: bool,
        _read: &dyn Fn(usize) -> Result<Vec<u8>>,
    ) -> Result<bool> {
        Ok(false)
    }
    fn comment(&mut self, _key: &[u8], _value: &[u8]) -> Result<bool> {
        Ok(false)
    }
    fn picture(&mut self, _size: usize, _read: &dyn Fn(usize) -> Result<Vec<u8>>) -> Result<bool> {
        Ok(false)
    }
}
fn frame_payload(payload: Vec<u8>, version: u8, flags: u8, tag_flags: u8) -> Result<Vec<u8>> {
    let payload = if version == 4 && (flags & 2 != 0 || tag_flags & 0x80 != 0) {
        unsync(&payload)
    } else {
        payload
    };
    let mut skip = if (version == 3 && flags & 0x20 != 0) || (version == 4 && flags & 0x40 != 0) {
        1
    } else {
        0
    };
    if version == 4 && flags & 1 != 0 {
        skip += 4;
    }
    payload
        .get(skip..)
        .map(<[u8]>::to_vec)
        .ok_or_else(|| corrupt("truncated ID3 embedded flags"))
}
fn id3(
    source: &dyn RuntimeSource,
    header: &[u8],
    cancel: &CancelFlag,
    visitor: &mut impl MetadataVisitor,
) -> Result<()> {
    let limit = visitor.block_limit();
    if header.len() < 10 {
        return Err(corrupt("truncated ID3 header"));
    }
    let version = header[3];
    if !(2..=4).contains(&version) {
        return Err(LibzciError::Unsupported {
            detail: "unsupported ID3 embedded version".into(),
        });
    }
    if version == 2 && header[5] & 0x40 != 0 {
        return Err(LibzciError::Unsupported {
            detail: "compressed ID3v2.2 metadata".into(),
        });
    }
    let declared = synchsafe(&header[6..10])?;
    if declared as u64 > SCAN_LIMIT {
        return Err(budget("ID3 embedded metadata span exceeds 64 MiB"));
    }
    if source.len().is_some_and(|len| len < 10 + declared as u64) {
        return Err(corrupt("ID3 tag exceeds source"));
    }
    // Ordinary frames are ranged individually so a large APIC is skipped.
    // Global ID3v2.2/2.3 unsynchronization changes physical frame offsets and
    // therefore uses the visitor's separately bounded tag-buffer fallback.
    let body = if version < 4 && header[5] & 0x80 != 0 {
        Some(unsync(&exact(source, 10, declared, cancel, limit)?))
    } else {
        None
    };
    let body_len = body.as_ref().map_or(declared, Vec::len);
    let read = |offset: usize, length: usize| -> Result<Vec<u8>> {
        let end = offset
            .checked_add(length)
            .filter(|end| *end <= body_len)
            .ok_or_else(|| corrupt("ID3 frame exceeds tag"))?;
        match &body {
            Some(body) => Ok(body[offset..end].to_vec()),
            None => exact(source, 10 + offset as u64, length, cancel, limit),
        }
    };
    let mut cursor = 0;
    if version >= 3 && header[5] & 0x40 != 0 {
        let size = read(0, 4)?;
        cursor = if version == 4 {
            synchsafe(&size)?
        } else {
            (u32::from_be_bytes(size.as_slice().try_into().unwrap()) as usize)
                .checked_add(4)
                .ok_or_else(|| corrupt("ID3 extended header overflow"))?
        };
        if cursor < 4 || cursor > body_len {
            return Err(corrupt("invalid ID3 extended header size"));
        }
    }
    let width = if version == 2 { 6 } else { 10 };
    for _ in 0..4096 {
        cancel.check()?;
        if cursor == body_len || read(cursor, 1)?[0] == 0 {
            return Ok(());
        }
        let frame = read(cursor, width)?;
        if version == 4 && frame.starts_with(b"3DI") {
            return Ok(());
        }
        let (name, size, flags) = if version == 2 {
            (
                &frame[..3],
                ((frame[3] as usize) << 16) | ((frame[4] as usize) << 8) | frame[5] as usize,
                0,
            )
        } else {
            (
                &frame[..4],
                if version == 4 {
                    synchsafe(&frame[4..8])?
                } else {
                    u32::from_be_bytes(frame[4..8].try_into().unwrap()) as usize
                },
                frame[9],
            )
        };
        if !name
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            return Err(corrupt("invalid ID3 frame identity"));
        }
        cursor += width;
        let end = cursor
            .checked_add(size)
            .filter(|end| *end <= body_len)
            .ok_or_else(|| corrupt("ID3 frame exceeds tag"))?;
        let start = cursor;
        cursor = end;
        let supported =
            !((version == 3 && flags & 0xc0 != 0) || (version == 4 && flags & 0x0c != 0));
        if visitor.id3(name, size, version, supported, &|length| {
            if !supported {
                return Err(LibzciError::Unsupported {
                    detail: "compressed/encrypted embedded metadata".into(),
                });
            }
            frame_payload(read(start, length.min(size))?, version, flags, header[5])
        })? {
            return Ok(());
        }
    }
    Err(budget("ID3 frame count exceeds 4096"))
}
fn le32(data: &[u8], cursor: &mut usize) -> Result<usize> {
    let bytes = data
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| corrupt("truncated embedded comment length"))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(bytes.try_into().unwrap()) as usize)
}
fn comments(data: &[u8], cancel: &CancelFlag, visitor: &mut impl MetadataVisitor) -> Result<bool> {
    let mut cursor = 0;
    let vendor = le32(data, &mut cursor)?;
    cursor = cursor
        .checked_add(vendor)
        .filter(|n| *n <= data.len())
        .ok_or_else(|| corrupt("invalid embedded comment vendor length"))?;
    let count = le32(data, &mut cursor)?;
    if count > 65536 {
        return Err(budget("embedded comment count exceeds 65536"));
    }
    for _ in 0..count {
        cancel.check()?;
        let length = le32(data, &mut cursor)?;
        let end = cursor
            .checked_add(length)
            .filter(|n| *n <= data.len())
            .ok_or_else(|| corrupt("embedded comment exceeds packet"))?;
        let comment = &data[cursor..end];
        cursor = end;
        let Some(separator) = comment.iter().take(128).position(|b| *b == b'=') else {
            continue;
        };
        if visitor.comment(&comment[..separator], &comment[separator + 1..])? {
            return Ok(true);
        }
    }
    Ok(false)
}
fn flac(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
    visitor: &mut impl MetadataVisitor,
) -> Result<()> {
    let limit = visitor.block_limit();
    let mut offset = 4;
    for _ in 0..4096 {
        if offset > SCAN_LIMIT {
            return Err(budget("FLAC embedded metadata scan exceeds 64 MiB"));
        }
        let header = exact(source, offset, 4, cancel, limit)?;
        offset += 4;
        let length =
            ((header[1] as usize) << 16) | ((header[2] as usize) << 8) | header[3] as usize;
        if header[0] & 0x7f == 4 {
            if comments(
                &exact(source, offset, length, cancel, limit)?,
                cancel,
                visitor,
            )? {
                return Ok(());
            }
        } else if header[0] & 0x7f == 6 {
            if visitor.picture(length, &|size| {
                exact(source, offset, size.min(length), cancel, limit)
            })? {
                return Ok(());
            }
        }
        offset += length as u64;
        if source.len().is_some_and(|len| offset > len) {
            return Err(corrupt("FLAC metadata block exceeds source"));
        }
        if header[0] & 0x80 != 0 {
            return Ok(());
        }
    }
    Err(budget("FLAC metadata block count exceeds 4096"))
}
fn ogg(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
    visitor: &mut impl MetadataVisitor,
) -> Result<()> {
    let limit = visitor.block_limit();
    let mut offset = 0;
    let mut packet = vec![];
    let mut serial = None;
    let mut sequence = 0;
    let mut packets = 0;
    for _ in 0..4096 {
        if offset > SCAN_LIMIT {
            return Err(budget("Ogg embedded header scan exceeds 64 MiB"));
        }
        let mut header = exact(source, offset, 27, cancel, limit)?;
        if &header[..4] != b"OggS" || header[4] != 0 || header[5] & !7 != 0 {
            return Err(corrupt("invalid Ogg embedded header"));
        }
        let stream = u32::from_le_bytes(header[14..18].try_into().unwrap());
        let seq = u32::from_le_bytes(header[18..22].try_into().unwrap());
        let lacing = exact(source, offset + 27, header[26] as usize, cancel, limit)?;
        let length = lacing.iter().map(|n| *n as usize).sum();
        let body = exact(
            source,
            offset + 27 + lacing.len() as u64,
            length,
            cancel,
            limit,
        )?;
        header.extend_from_slice(&lacing);
        if crate::ogg_crc(&header, &body, 22)
            != u32::from_le_bytes(header[22..26].try_into().unwrap())
        {
            return Err(corrupt("Ogg embedded page checksum"));
        }
        offset += header.len() as u64 + body.len() as u64;
        if serial.is_none() {
            serial = Some(stream);
            sequence = seq;
        }
        if serial != Some(stream) {
            continue;
        }
        if seq != sequence || (!packet.is_empty()) != (header[5] & 1 != 0) {
            return Err(corrupt("Ogg embedded packet continuity"));
        }
        sequence = sequence.wrapping_add(1);
        let mut at = 0;
        for length in lacing {
            let end = at + length as usize;
            if packet.len() + length as usize > limit {
                return Err(budget("Ogg embedded packet exceeds 4 MiB"));
            }
            packet.extend_from_slice(&body[at..end]);
            at = end;
            if length == 255 {
                continue;
            }
            if let Some(data) = packet.strip_prefix(b"OpusTags") {
                comments(data, cancel, visitor)?;
                return Ok(());
            }
            if let Some(data) = packet.strip_prefix(b"\x03vorbis") {
                comments(data, cancel, visitor)?;
                return Ok(());
            }
            if packets > 0
                || (!packet.starts_with(b"OpusHead") && !packet.starts_with(b"\x01vorbis"))
            {
                return Ok(());
            }
            packets += 1;
            packet.clear();
        }
        if header[5] & 4 != 0 {
            return Ok(());
        }
    }
    Err(budget("Ogg embedded page count exceeds 4096"))
}
pub(crate) fn scan(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
    visitor: &mut impl MetadataVisitor,
) -> Result<()> {
    cancel.check()?;
    let mut header = [0; 10];
    let mut read = 0;
    while read < header.len() {
        let n = source.read_at(read as u64, &mut header[read..], cancel)?;
        if n == 0 {
            break;
        }
        if n > header.len() - read {
            return Err(corrupt("invalid embedded source read"));
        }
        read += n;
    }
    let header = &header[..read];
    if header.starts_with(b"ID3") {
        id3(source, header, cancel, visitor)
    } else if header.starts_with(b"fLaC") {
        flac(source, cancel, visitor)
    } else if header.starts_with(b"OggS") {
        ogg(source, cancel, visitor)
    } else {
        Ok(())
    }
}
