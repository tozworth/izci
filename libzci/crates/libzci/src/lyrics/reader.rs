//! Lyrics selection over the shared bounded container walker.
use super::{LyricsDocument, MAX_LYRICS_BYTES};
use crate::embedded_metadata::{budget, corrupt, MetadataVisitor};
use crate::{CancelFlag, LibzciError, Result, RuntimeSource};
#[cfg(test)]
const TAG_LIMIT: usize = 4 * 1024 * 1024;
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

#[derive(Default)]
struct LyricsVisitor {
    plain: Option<LyricsDocument>,
    timed: Option<LyricsDocument>,
}
impl MetadataVisitor for LyricsVisitor {
    fn id3(
        &mut self,
        name: &[u8],
        size: usize,
        _version: u8,
        supported: bool,
        read: &dyn Fn(usize) -> Result<Vec<u8>>,
    ) -> Result<bool> {
        let custom = name == b"TXXX" || name == b"TXX";
        if name != b"USLT" && name != b"ULT" && !custom {
            return Ok(false);
        }
        if !supported {
            if custom {
                return Ok(false);
            }
            return Err(LibzciError::Unsupported {
                detail: "compressed/encrypted embedded lyrics".into(),
            });
        }
        if custom {
            let prefix = read(size.min(8208))?;
            let Some(&encoding) = prefix.first() else {
                return Ok(false);
            };
            if encoding > 3 {
                return Ok(false);
            }
            let Ok(end) = description(&prefix[1..], encoding) else {
                return Ok(false);
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
                return Ok(false);
            }
        }
        if size > MAX_LYRICS_BYTES + 8192 + 8 {
            return Err(budget("embedded lyric frame exceeds budget"));
        }
        let payload = read(size)?;
        let prefix = if custom { 1 } else { 4 };
        if payload.len() < prefix {
            return Err(corrupt("truncated USLT header"));
        }
        let encoding = payload[0];
        let start = prefix + description(&payload[prefix..], encoding)?;
        let document = LyricsDocument::parse(&text(&payload[start..], encoding)?)?;
        if !document.lines.is_empty() {
            self.timed = Some(document);
            return Ok(true);
        }
        if !document.plain.is_empty() && self.plain.is_none() {
            self.plain = Some(document);
        }
        Ok(false)
    }
    fn comment(&mut self, key: &[u8], value: &[u8]) -> Result<bool> {
        let key = String::from_utf8_lossy(key);
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
            return Ok(false);
        }
        let document = LyricsDocument::parse(&text(value, 3)?)?;
        if !document.lines.is_empty() {
            self.timed = Some(document);
            return Ok(true);
        }
        if !document.plain.is_empty() && self.plain.is_none() {
            self.plain = Some(document);
        }
        Ok(false)
    }
}
pub fn read_embedded_lyrics(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
) -> Result<Option<LyricsDocument>> {
    let mut visitor = LyricsVisitor::default();
    crate::embedded_metadata::scan(source, cancel, &mut visitor)?;
    Ok(visitor.timed.or(visitor.plain))
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
