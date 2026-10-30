//! Ranged on-demand readers for ID3 USLT and FLAC/Ogg lyric comments. No media
//! decoder, output, artwork payload or persistent catalog record is created.
use super::{LyricsDocument, MAX_LYRICS_BYTES};
use crate::{CancelFlag, LibzciError, Result, RuntimeSource};
const TAG_LIMIT: usize = 4 * 1024 * 1024;
const SCAN_LIMIT: u64 = 64 * 1024 * 1024;
fn corrupt(detail: &str) -> LibzciError {
    LibzciError::Corrupt {
        detail: detail.into(),
    }
}
fn budget(detail: &str) -> LibzciError {
    LibzciError::ResourceExhausted {
        detail: detail.into(),
    }
}
fn exact(
    source: &dyn RuntimeSource,
    offset: u64,
    length: usize,
    cancel: &CancelFlag,
) -> Result<Vec<u8>> {
    if length > TAG_LIMIT {
        return Err(budget("lyric metadata block exceeds 4 MiB"));
    }
    let end = offset
        .checked_add(length as u64)
        .ok_or_else(|| corrupt("metadata range overflow"))?;
    if source.len().is_some_and(|len| end > len) {
        return Err(corrupt("truncated lyric metadata"));
    }
    let mut data = vec![0; length];
    let mut filled = 0;
    while filled < length {
        cancel.check()?;
        let end = (filled + 32768).min(length);
        let n = source.read_at(offset + filled as u64, &mut data[filled..end], cancel)?;
        if n == 0 || n > end - filled {
            return Err(corrupt("short lyric metadata read"));
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
fn text(data: &[u8], encoding: u8) -> Result<String> {
    if data.len() > MAX_LYRICS_BYTES {
        return Err(budget("encoded lyrics exceed 256 KiB"));
    }
    let value = match encoding {
        0 => data.iter().map(|b| char::from(*b)).collect(),
        3 => String::from_utf8_lossy(data).into_owned(),
        1 | 2 => {
            let (data, little) = if data.starts_with(&[255, 254]) {
                (&data[2..], true)
            } else if data.starts_with(&[254, 255]) {
                (&data[2..], false)
            } else {
                (data, false)
            };
            if data.len() % 2 != 0 {
                return Err(corrupt("odd UTF-16 lyric length"));
            }
            let words = data
                .as_chunks::<2>()
                .0
                .iter()
                .map(|pair| {
                    if little {
                        u16::from_le_bytes(*pair)
                    } else {
                        u16::from_be_bytes(*pair)
                    }
                })
                .collect::<Vec<_>>();
            String::from_utf16_lossy(&words)
        }
        _ => return Err(corrupt("unknown ID3 lyric encoding")),
    };
    if value.len() > MAX_LYRICS_BYTES {
        return Err(budget("decoded lyrics exceed 256 KiB"));
    }
    Ok(value.trim_end_matches('\0').into())
}
fn description(data: &[u8], encoding: u8) -> Result<usize> {
    let end = if matches!(encoding, 1 | 2) {
        data.as_chunks::<2>()
            .0
            .iter()
            .position(|b| *b == [0, 0])
            .map(|n| n * 2 + 2)
    } else {
        data.iter().position(|b| *b == 0).map(|n| n + 1)
    };
    end.filter(|n| *n <= 8192)
        .ok_or_else(|| corrupt("unterminated/oversized lyric description"))
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
        .ok_or_else(|| corrupt("truncated ID3 lyric flags"))
}
fn id3(
    source: &dyn RuntimeSource,
    header: &[u8],
    cancel: &CancelFlag,
) -> Result<Option<LyricsDocument>> {
    if header.len() < 10 {
        return Err(corrupt("truncated ID3 header"));
    }
    let version = header[3];
    if !(2..=4).contains(&version) {
        return Err(LibzciError::Unsupported {
            detail: "unsupported ID3 lyric version".into(),
        });
    }
    if version == 2 && header[5] & 0x40 != 0 {
        return Err(LibzciError::Unsupported {
            detail: "compressed ID3v2.2 lyrics".into(),
        });
    }
    let declared = synchsafe(&header[6..10])?;
    if declared as u64 > SCAN_LIMIT {
        return Err(budget("ID3 lyric metadata span exceeds 64 MiB"));
    }
    if source.len().is_some_and(|len| len < 10 + declared as u64) {
        return Err(corrupt("ID3 tag exceeds source"));
    }
    // Ordinary frames are ranged individually so a large APIC is skipped.
    // Global ID3v2.2/2.3 unsynchronization changes physical frame offsets and
    // therefore uses the separately bounded 4 MiB tag-buffer fallback.
    let body = if version < 4 && header[5] & 0x80 != 0 {
        Some(unsync(&exact(source, 10, declared, cancel)?))
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
            None => exact(source, 10 + offset as u64, length, cancel),
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
    let mut plain = None;
    for _ in 0..4096 {
        cancel.check()?;
        if cursor == body_len || read(cursor, 1)?[0] == 0 {
            return Ok(plain);
        }
        let frame = read(cursor, width)?;
        if version == 4 && frame.starts_with(b"3DI") {
            return Ok(plain);
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
        let custom = name == b"TXXX" || name == b"TXX";
        if name != b"USLT" && name != b"ULT" && !custom {
            continue;
        }
        if (version == 3 && flags & 0xc0 != 0) || (version == 4 && flags & 0x0c != 0) {
            if custom {
                continue;
            }
            return Err(LibzciError::Unsupported {
                detail: "compressed/encrypted embedded lyrics".into(),
            });
        }
        if custom {
            let prefix = frame_payload(read(start, size.min(8208))?, version, flags, header[5])?;
            let Some(&encoding) = prefix.first() else {
                continue;
            };
            if encoding > 3 {
                continue;
            }
            let Ok(end) = description(&prefix[1..], encoding) else {
                continue;
            };
            let key = text(&prefix[1..1 + end], encoding)?;
            if ![
                "uslt",
                "lyrics",
                "unsyncedlyrics",
                "unsynced lyrics",
                "syncedlyrics",
                "synced lyrics",
            ]
            .iter()
            .any(|k| key.trim().eq_ignore_ascii_case(k))
            {
                continue;
            }
        }
        if size > MAX_LYRICS_BYTES + 8192 + 8 {
            return Err(budget("embedded lyric frame exceeds budget"));
        }
        let payload = frame_payload(read(start, size)?, version, flags, header[5])?;
        let prefix = if custom { 1 } else { 4 };
        if payload.len() < prefix {
            return Err(corrupt("truncated USLT header"));
        }
        let encoding = payload[0];
        let start = prefix + description(&payload[prefix..], encoding)?;
        let document = LyricsDocument::parse(&text(&payload[start..], encoding)?)?;
        if !document.lines.is_empty() {
            return Ok(Some(document));
        }
        if !document.plain.is_empty() && plain.is_none() {
            plain = Some(document);
        }
    }
    Err(budget("ID3 lyric frame count exceeds 4096"))
}
fn le32(data: &[u8], cursor: &mut usize) -> Result<usize> {
    let bytes = data
        .get(*cursor..*cursor + 4)
        .ok_or_else(|| corrupt("truncated lyric comment length"))?;
    *cursor += 4;
    Ok(u32::from_le_bytes(bytes.try_into().unwrap()) as usize)
}
fn comments(data: &[u8], cancel: &CancelFlag) -> Result<Option<LyricsDocument>> {
    let mut cursor = 0;
    let vendor = le32(data, &mut cursor)?;
    cursor = cursor
        .checked_add(vendor)
        .filter(|n| *n <= data.len())
        .ok_or_else(|| corrupt("invalid lyric comment vendor length"))?;
    let count = le32(data, &mut cursor)?;
    if count > 65536 {
        return Err(budget("lyric comment count exceeds 65536"));
    }
    let mut plain = None;
    for _ in 0..count {
        cancel.check()?;
        let length = le32(data, &mut cursor)?;
        let end = cursor
            .checked_add(length)
            .filter(|n| *n <= data.len())
            .ok_or_else(|| corrupt("lyric comment exceeds packet"))?;
        let comment = &data[cursor..end];
        cursor = end;
        let Some(separator) = comment.iter().take(128).position(|b| *b == b'=') else {
            continue;
        };
        let key = String::from_utf8_lossy(&comment[..separator]);
        if ![
            "lyrics",
            "unsyncedlyrics",
            "unsynced lyrics",
            "syncedlyrics",
            "synced lyrics",
        ]
        .iter()
        .any(|k| key.eq_ignore_ascii_case(k))
        {
            continue;
        }
        let document = LyricsDocument::parse(&text(&comment[separator + 1..], 3)?)?;
        if !document.lines.is_empty() {
            return Ok(Some(document));
        }
        if !document.plain.is_empty() && plain.is_none() {
            plain = Some(document);
        }
    }
    Ok(plain)
}
fn flac(source: &dyn RuntimeSource, cancel: &CancelFlag) -> Result<Option<LyricsDocument>> {
    let mut offset = 4;
    for _ in 0..4096 {
        if offset > SCAN_LIMIT {
            return Err(budget("FLAC lyric metadata scan exceeds 64 MiB"));
        }
        let header = exact(source, offset, 4, cancel)?;
        offset += 4;
        let length =
            ((header[1] as usize) << 16) | ((header[2] as usize) << 8) | header[3] as usize;
        if header[0] & 0x7f == 4 {
            return comments(&exact(source, offset, length, cancel)?, cancel);
        }
        offset += length as u64;
        if source.len().is_some_and(|len| offset > len) {
            return Err(corrupt("FLAC metadata block exceeds source"));
        }
        if header[0] & 0x80 != 0 {
            return Ok(None);
        }
    }
    Err(budget("FLAC metadata block count exceeds 4096"))
}
fn ogg(source: &dyn RuntimeSource, cancel: &CancelFlag) -> Result<Option<LyricsDocument>> {
    let mut offset = 0;
    let mut packet = vec![];
    let mut serial = None;
    let mut sequence = 0;
    let mut packets = 0;
    for _ in 0..4096 {
        if offset > SCAN_LIMIT {
            return Err(budget("Ogg lyric header scan exceeds 64 MiB"));
        }
        let mut header = exact(source, offset, 27, cancel)?;
        if &header[..4] != b"OggS" || header[4] != 0 || header[5] & !7 != 0 {
            return Err(corrupt("invalid Ogg lyric header"));
        }
        let stream = u32::from_le_bytes(header[14..18].try_into().unwrap());
        let seq = u32::from_le_bytes(header[18..22].try_into().unwrap());
        let lacing = exact(source, offset + 27, header[26] as usize, cancel)?;
        let length = lacing.iter().map(|n| *n as usize).sum();
        let body = exact(source, offset + 27 + lacing.len() as u64, length, cancel)?;
        header.extend_from_slice(&lacing);
        if crate::ogg_crc(&header, &body, 22)
            != u32::from_le_bytes(header[22..26].try_into().unwrap())
        {
            return Err(corrupt("Ogg lyric page checksum"));
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
            return Err(corrupt("Ogg lyric packet continuity"));
        }
        sequence = sequence.wrapping_add(1);
        let mut at = 0;
        for length in lacing {
            let end = at + length as usize;
            if packet.len() + length as usize > TAG_LIMIT {
                return Err(budget("Ogg lyric packet exceeds 4 MiB"));
            }
            packet.extend_from_slice(&body[at..end]);
            at = end;
            if length == 255 {
                continue;
            }
            if let Some(data) = packet.strip_prefix(b"OpusTags") {
                return comments(data, cancel);
            }
            if let Some(data) = packet.strip_prefix(b"\x03vorbis") {
                return comments(data, cancel);
            }
            if packets > 0
                || (!packet.starts_with(b"OpusHead") && !packet.starts_with(b"\x01vorbis"))
            {
                return Ok(None);
            }
            packets += 1;
            packet.clear();
        }
        if header[5] & 4 != 0 {
            return Ok(None);
        }
    }
    Err(budget("Ogg lyric page count exceeds 4096"))
}
pub fn read_embedded_lyrics(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
) -> Result<Option<LyricsDocument>> {
    cancel.check()?;
    let mut header = [0; 10];
    let mut read = 0;
    while read < header.len() {
        let n = source.read_at(read as u64, &mut header[read..], cancel)?;
        if n == 0 {
            break;
        }
        if n > header.len() - read {
            return Err(corrupt("invalid lyric source read"));
        }
        read += n;
    }
    let header = &header[..read];
    if header.starts_with(b"ID3") {
        id3(source, header, cancel)
    } else if header.starts_with(b"fLaC") {
        flac(source, cancel)
    } else if header.starts_with(b"OggS") {
        ogg(source, cancel)
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MemSource, SourceCaps, SourceId};
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Debug)]
    struct Short {
        inner: MemSource,
        bytes: AtomicUsize,
    }
    impl Short {
        fn new(bytes: Vec<u8>) -> Self {
            Self {
                inner: MemSource::new(bytes),
                bytes: AtomicUsize::new(0),
            }
        }
    }
    impl RuntimeSource for Short {
        fn id(&self) -> SourceId {
            self.inner.id()
        }
        fn revision(&self) -> u64 {
            1
        }
        fn caps(&self) -> SourceCaps {
            self.inner.caps()
        }
        fn read_at(&self, offset: u64, out: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
            assert!(out.len() <= 32768);
            let n = out.len().min(7);
            let read = self.inner.read_at(offset, &mut out[..n], cancel)?;
            self.bytes.fetch_add(read, Ordering::Relaxed);
            Ok(read)
        }
    }
    fn safe(n: usize) -> [u8; 4] {
        [
            ((n >> 21) & 127) as u8,
            ((n >> 14) & 127) as u8,
            ((n >> 7) & 127) as u8,
            (n & 127) as u8,
        ]
    }
    fn frame(version: u8, name: &[u8], payload: &[u8]) -> Vec<u8> {
        let mut out = name.to_vec();
        if version == 2 {
            let n = payload.len();
            out.extend_from_slice(&[(n >> 16) as u8, (n >> 8) as u8, n as u8]);
        } else {
            out.extend_from_slice(&if version == 4 {
                safe(payload.len())
            } else {
                (payload.len() as u32).to_be_bytes()
            });
            out.extend_from_slice(&[0, 0]);
        }
        out.extend_from_slice(payload);
        out
    }
    fn tag(version: u8, frames: &[u8]) -> Vec<u8> {
        let mut out = b"ID3".to_vec();
        out.extend_from_slice(&[version, 0, 0]);
        out.extend_from_slice(&safe(frames.len()));
        out.extend_from_slice(frames);
        out
    }
    fn packet(vendor: &[u8], lyrics: &str) -> Vec<u8> {
        let mut out = vec![];
        out.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        out.extend_from_slice(vendor);
        out.extend_from_slice(&1u32.to_le_bytes());
        let text = format!("LYRICS={lyrics}");
        out.extend_from_slice(&(text.len() as u32).to_le_bytes());
        out.extend_from_slice(text.as_bytes());
        out
    }
    fn page(sequence: u32, flags: u8, lacing: &[u8], body: &[u8]) -> Vec<u8> {
        let mut header = vec![0; 27];
        header[..4].copy_from_slice(b"OggS");
        header[5] = flags;
        header[14..18].copy_from_slice(&17u32.to_le_bytes());
        header[18..22].copy_from_slice(&sequence.to_le_bytes());
        header[26] = lacing.len() as u8;
        header.extend_from_slice(lacing);
        let crc = crate::ogg_crc(&header, body, 22);
        header[22..26].copy_from_slice(&crc.to_le_bytes());
        header.extend_from_slice(body);
        header
    }
    #[test]
    fn reads_all_id3_versions_encodings_and_skips_large_artwork_with_short_range_reads() {
        for (version, encoding, encoded) in [
            (2, 0, vec![0xe9]),
            (3, 1, vec![255, 254, 0xf2, 0x66]),
            (4, 3, "曲".as_bytes().to_vec()),
            (4, 2, vec![0x66, 0xf2]),
        ] {
            let mut payload = vec![encoding, b'e', b'n', b'g'];
            if matches!(encoding, 1 | 2) {
                payload.extend_from_slice(&[0, 0]);
            } else {
                payload.push(0);
            }
            payload.extend(encoded);
            let frames = frame(
                version,
                if version == 2 { b"ULT" } else { b"USLT" },
                &payload,
            );
            let source = Short::new(tag(version, &frames));
            let doc = read_embedded_lyrics(&source, &CancelFlag::default())
                .unwrap()
                .unwrap();
            assert_eq!(doc.plain, if encoding == 0 { "é" } else { "曲" });
        }
        let mut frames = frame(3, b"APIC", &vec![1; TAG_LIMIT + 1024]);
        let mut payload = b"\x03eng\0".to_vec();
        payload.extend_from_slice(b"[00:01]bounded");
        frames.extend(frame(3, b"USLT", &payload));
        let source = Short::new(tag(3, &frames));
        let doc = read_embedded_lyrics(&source, &CancelFlag::default())
            .unwrap()
            .unwrap();
        assert_eq!(doc.lines[0].time_ms, 1000);
        assert!(
            source.bytes.load(Ordering::Relaxed) < 100,
            "lyric lookup must not read skipped artwork"
        );
    }
    #[test]
    fn reads_flac_and_continued_ogg_comment_packets_and_rejects_corrupt_crc() {
        let comments = packet(&[], "[00:01.25]Çığ");
        let mut flac = b"fLaC".to_vec();
        flac.extend_from_slice(&[0, 0, 0, 34]);
        flac.extend([0; 34]);
        let n = comments.len();
        flac.extend_from_slice(&[0x84, (n >> 16) as u8, (n >> 8) as u8, n as u8]);
        flac.extend(comments.clone());
        assert_eq!(
            read_embedded_lyrics(&Short::new(flac), &CancelFlag::default())
                .unwrap()
                .unwrap()
                .lines[0]
                .text,
            "Çığ"
        );
        let mut tags = b"OpusTags".to_vec();
        tags.extend(packet(&vec![b'x'; 300], "[00:01]continued"));
        let mut opus = page(0, 2, &[8], b"OpusHead");
        opus.extend(page(1, 0, &[255], &tags[..255]));
        opus.extend(page(2, 1, &[(tags.len() - 255) as u8], &tags[255..]));
        assert_eq!(
            read_embedded_lyrics(&Short::new(opus.clone()), &CancelFlag::default())
                .unwrap()
                .unwrap()
                .lines[0]
                .text,
            "continued"
        );
        *opus.last_mut().unwrap() ^= 1;
        assert!(matches!(
            read_embedded_lyrics(&Short::new(opus), &CancelFlag::default()),
            Err(LibzciError::Corrupt { .. })
        ));
        let mut vorbis = page(0, 2, &[7], b"\x01vorbis");
        let mut tags = b"\x03vorbis".to_vec();
        tags.extend(comments);
        vorbis.extend(page(1, 0, &[tags.len() as u8], &tags));
        assert_eq!(
            read_embedded_lyrics(&Short::new(vorbis), &CancelFlag::default())
                .unwrap()
                .unwrap()
                .lines[0]
                .time_ms,
            1250
        );
    }
    #[test]
    fn malformed_lengths_and_cancellation_stay_bounded_and_typed() {
        let source = Short::new(b"ID3\x04\0\0\x7f\x7f\x7f\x7f".to_vec());
        assert!(matches!(
            read_embedded_lyrics(&source, &CancelFlag::default()),
            Err(LibzciError::ResourceExhausted { .. })
        ));
        let mut frames = frame(4, b"USLT", b"\x03eng\0text");
        frames[4..8].copy_from_slice(&safe(10000));
        assert!(
            read_embedded_lyrics(&Short::new(tag(4, &frames)), &CancelFlag::default()).is_err()
        );
        let source = Short::new(vec![0; 100]);
        assert!(matches!(
            read_embedded_lyrics(&source, &CancelFlag::cancelled()),
            Err(LibzciError::Cancelled)
        ));
        assert_eq!(source.bytes.load(Ordering::Relaxed), 0);
        assert!(
            read_embedded_lyrics(&Short::new(vec![0; 10]), &CancelFlag::default())
                .unwrap()
                .is_none()
        );
    }
}
