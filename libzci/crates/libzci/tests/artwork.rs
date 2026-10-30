use base64::Engine;
use libzci::{artwork::*, *};
use std::sync::atomic::{AtomicUsize, Ordering};
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixture";
fn safe(n: usize) -> [u8; 4] {
    [
        (n >> 21) as u8 & 127,
        (n >> 14) as u8 & 127,
        (n >> 7) as u8 & 127,
        n as u8 & 127,
    ]
}
fn frame(version: u8, name: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = name.to_vec();
    if version == 2 {
        out.extend_from_slice(&[
            (data.len() >> 16) as u8,
            (data.len() >> 8) as u8,
            data.len() as u8,
        ]);
    } else {
        out.extend_from_slice(&if version == 4 {
            safe(data.len())
        } else {
            (data.len() as u32).to_be_bytes()
        });
        out.extend([0, 0]);
    }
    out.extend(data);
    out
}
fn tag(version: u8, frames: &[u8]) -> Vec<u8> {
    let mut out = b"ID3".to_vec();
    out.extend([version, 0, 0]);
    out.extend(safe(frames.len()));
    out.extend(frames);
    out
}
fn apic(version: u8, encoding: u8, kind: u8, bytes: &[u8]) -> Vec<u8> {
    let mut data = vec![encoding];
    data.extend(if version == 2 {
        b"PNG".as_slice()
    } else {
        b"image/jpeg\0".as_slice()
    });
    data.push(kind);
    data.extend(if encoding == 1 || encoding == 2 {
        b"\0\0".as_slice()
    } else {
        b"\0".as_slice()
    });
    data.extend(bytes);
    frame(version, if version == 2 { b"PIC" } else { b"APIC" }, &data)
}
fn picture(kind: u32, mime: &[u8], bytes: &[u8]) -> Vec<u8> {
    let mut out = kind.to_be_bytes().to_vec();
    for field in [mime, b"test"] {
        out.extend((field.len() as u32).to_be_bytes());
        out.extend(field);
    }
    for n in [9000u32, 8000, 32, 0, bytes.len() as u32] {
        out.extend(n.to_be_bytes());
    }
    out.extend(bytes);
    out
}
fn flac(blocks: &[(u8, Vec<u8>)]) -> Vec<u8> {
    let mut out = b"fLaC".to_vec();
    for (i, (kind, data)) in blocks.iter().enumerate() {
        out.push(*kind | if i == blocks.len() - 1 { 128 } else { 0 });
        out.extend([
            (data.len() >> 16) as u8,
            (data.len() >> 8) as u8,
            data.len() as u8,
        ]);
        out.extend(data);
    }
    out
}
fn comments(values: &[(&str, String)]) -> Vec<u8> {
    let mut out = 0u32.to_le_bytes().to_vec();
    out.extend((values.len() as u32).to_le_bytes());
    for (key, value) in values {
        let value = format!("{key}={value}");
        out.extend((value.len() as u32).to_le_bytes());
        out.extend(value.as_bytes());
    }
    out
}
fn page(sequence: u32, flags: u8, laces: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = vec![0; 27];
    out[..4].copy_from_slice(b"OggS");
    out[5] = flags;
    out[14..18].copy_from_slice(&17u32.to_le_bytes());
    out[18..22].copy_from_slice(&sequence.to_le_bytes());
    out[26] = laces.len() as u8;
    out.extend(laces);
    let crc = ogg_crc(&out, data, 22);
    out[22..26].copy_from_slice(&crc.to_le_bytes());
    out.extend(data);
    out
}
#[derive(Debug)]
struct Short {
    inner: MemSource,
    read: AtomicUsize,
}
impl Short {
    fn new(data: Vec<u8>) -> Self {
        Self {
            inner: MemSource::new(data),
            read: AtomicUsize::new(0),
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
    fn read_at(&self, offset: u64, buffer: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        assert!(buffer.len() <= 32768);
        let n = buffer.len().min(13);
        let got = self.inner.read_at(offset, &mut buffer[..n], cancel)?;
        self.read.fetch_add(got, Ordering::Relaxed);
        Ok(got)
    }
}
fn read(bytes: Vec<u8>) -> Option<EncodedArtwork> {
    read_embedded_artwork(&Short::new(bytes), &CancelFlag::default()).unwrap()
}
#[test]
fn all_id3_versions_select_front_cover_by_content_and_skip_unrequested_fields() {
    for version in 2..=4 {
        for encoding in 0..=3 {
            let mut frames = frame(
                version,
                if version == 2 { b"TXX" } else { b"TXXX" },
                &vec![1; 1024 * 1024],
            );
            frames.extend(apic(version, encoding, 4, b"\xff\xd8\xffback"));
            frames.extend(apic(version, encoding, 3, PNG));
            let source = Short::new(tag(version, &frames));
            let art = read_embedded_artwork(&source, &CancelFlag::default())
                .unwrap()
                .unwrap();
            assert_eq!(art.picture_type, 3);
            assert_eq!(art.mime, "image/png");
            assert_eq!(art.bytes, PNG);
            assert!(source.read.load(Ordering::Relaxed) < 1000);
        }
    }
    let fallback = read(tag(3, &apic(3, 0, 4, PNG))).unwrap();
    assert_eq!(fallback.picture_type, 4);
    let mut linked = b"\x03-->\0\x03\0https://example.invalid/cover.png".to_vec();
    assert!(read(tag(4, &frame(4, b"APIC", &linked))).is_none());
    linked.clear();
    // Global v2.3 and frame-level v2.4 unsynchronization preserve binary bytes.
    let jpeg = b"\xff\xd8\xff\xe0data";
    let raw = apic(3, 0, 3, jpeg);
    let mut unsynced = vec![];
    for &byte in &raw {
        unsynced.push(byte);
        if byte == 255 {
            unsynced.push(0);
        }
    }
    let mut bytes = tag(3, &unsynced);
    bytes[5] = 128;
    assert_eq!(read(bytes).unwrap().bytes, jpeg);
    let raw = apic(4, 0, 3, jpeg);
    let mut payload = vec![];
    for &byte in &raw[10..] {
        payload.push(byte);
        if byte == 255 {
            payload.push(0);
        }
    }
    let mut encoded = frame(4, b"APIC", &payload);
    encoded[9] = 2;
    assert_eq!(read(tag(4, &encoded)).unwrap().bytes, jpeg);
}
#[test]
fn flac_and_continued_ogg_share_picture_selection_without_lyrics_or_audio_decoding() {
    let payload = picture(3, b"image/jpeg", PNG);
    let source = flac(&[
        (4, comments(&[("LYRICS", "[00:01]song".into())])),
        (6, picture(4, b"image/png", b"\xff\xd8\xffback")),
        (6, payload.clone()),
    ]);
    assert_eq!(read(source.clone()).unwrap().bytes, PNG);
    assert_eq!(
        libzci::lyrics::read_embedded_lyrics(&Short::new(source), &CancelFlag::default())
            .unwrap()
            .unwrap()
            .lines[0]
            .text,
        "song"
    );
    for (head, tag) in [
        (b"OpusHead".as_slice(), b"OpusTags".as_slice()),
        (b"\x01vorbis".as_slice(), b"\x03vorbis".as_slice()),
    ] {
        let mut packet = tag.to_vec();
        packet.extend(comments(&[
            ("TITLE", "x".repeat(280)),
            (
                "METADATA_BLOCK_PICTURE",
                base64::engine::general_purpose::STANDARD.encode(&payload),
            ),
        ]));
        let mut data = page(0, 2, &[head.len() as u8], head);
        data.extend(page(1, 0, &[255], &packet[..255]));
        data.extend(page(2, 1, &[(packet.len() - 255) as u8], &packet[255..]));
        assert_eq!(read(data.clone()).unwrap().bytes, PNG);
        *data.last_mut().unwrap() ^= 1;
        assert_eq!(
            read_embedded_artwork(&Short::new(data), &CancelFlag::default())
                .unwrap_err()
                .kind(),
            "corrupt"
        );
    }
    assert!(read(flac(&[(6, picture(3, b"-->", b"https://example.invalid"))])).is_none());
}
#[test]
fn malformed_lengths_budgets_and_cancellation_are_typed_without_partial_output() {
    let mut bad = picture(3, b"image/png", PNG);
    bad.pop();
    for bytes in [
        flac(&[(6, bad)]),
        flac(&[(4, comments(&[("METADATA_BLOCK_PICTURE", "invalid".into())]))]),
        tag(4, &apic(4, 9, 3, PNG)),
    ] {
        assert_eq!(
            read_embedded_artwork(&Short::new(bytes), &CancelFlag::default())
                .unwrap_err()
                .kind(),
            "corrupt"
        );
    }
    let source = Short::new(tag(4, &apic(4, 3, 3, &vec![1; MAX_ARTWORK_BYTES + 1])));
    assert_eq!(
        read_embedded_artwork(&source, &CancelFlag::default())
            .unwrap_err()
            .kind(),
        "resource-exhausted"
    );
    assert!(
        source.read.load(Ordering::Relaxed) < 32768,
        "reject oversized raw artwork before reading it"
    );
    let source = Short::new(tag(4, &apic(4, 3, 3, PNG)));
    assert_eq!(
        read_embedded_artwork(&source, &CancelFlag::cancelled())
            .unwrap_err()
            .kind(),
        "cancelled"
    );
    assert_eq!(source.read.load(Ordering::Relaxed), 0);
    assert!(read(b"no artwork".to_vec()).is_none());
}
