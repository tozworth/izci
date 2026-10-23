#[path = "support/raw_opus.rs"]
#[allow(dead_code)]
mod raw_opus;
// Generated media has separate R3 provenance; test-owned full sinks are intentional.
use libzci::*;
use libzci_codecs::{OpusInstance, OpusLimits};
use std::{path::PathBuf, sync::Arc};
fn media(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/r3")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|_| {
        panic!(
            "missing {}; run python libzci/tests/generate-r3-media.py",
            path.display()
        )
    })
}
fn open(bytes: Vec<u8>) -> OpusInstance {
    OpusInstance::open(
        Arc::new(MemSource::new(bytes)),
        OpusLimits::default(),
        &CancelFlag::default(),
    )
    .unwrap()
}
fn decode(d: &mut dyn DecoderInstance) -> Vec<f32> {
    let mut pcm = Vec::new();
    let mut scratch = [0.0; 514];
    loop {
        let n = d.decode_into(&mut scratch, &CancelFlag::default()).unwrap();
        if n == 0 {
            return pcm;
        }
        pcm.extend_from_slice(&scratch[..n]);
    }
}
#[test]
fn exact_trim_timeline_real_long_reference_and_seek_tails() {
    assert!(OpusInstance::linked_version().starts_with("libopus 1.5.2"));
    for name in ["mono", "stereo", "long"] {
        let mut d = open(media(&format!("{name}.opus")));
        let channels = d.layout().layout.channels() as usize;
        let total = d.total_frames().unwrap();
        let pcm = decode(&mut d);
        assert_eq!(pcm.len(), total as usize * channels);
        assert_eq!(d.position_frames(), total);
        assert_eq!(
            total,
            match name {
                "mono" => 12006,
                "stereo" => 60006,
                _ => 1440006,
            }
        );
        let reference: Vec<f32> = media(&format!("{name}.f32"))
            .as_chunks::<4>()
            .0
            .iter()
            .map(|bytes| f32::from_le_bytes(*bytes))
            .collect();
        assert_eq!(reference.len(), pcm.len());
        let error = pcm
            .iter()
            .zip(&reference)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        eprintln!("{name}: {total} frames, reference max sample difference {error}");
        assert!(error < 0.00003);
        for target in [0, total / 2, total - 1, total, total + 100] {
            let landed = d.seek_to_frame(target, &CancelFlag::default()).unwrap();
            assert_eq!(landed, target.min(total));
            assert_eq!(decode(&mut d).len(), (total - landed) as usize * channels);
        }
    }
}
fn fix_page_crc(bytes: &mut [u8], offset: usize) {
    let count = bytes[offset + 26] as usize;
    let size = 27
        + count
        + bytes[offset + 27..offset + 27 + count]
            .iter()
            .map(|v| *v as usize)
            .sum::<usize>();
    bytes[offset + 22..offset + 26].fill(0);
    let crc = ogg_crc(&bytes[offset..offset + size], &[], 22);
    bytes[offset + 22..offset + 26].copy_from_slice(&crc.to_le_bytes());
}
#[test]
fn independent_instances_header_gain_once_and_reported_tags() {
    let bytes = media("stereo.opus");
    let mut a = open(bytes.clone());
    let mut b = open(bytes.clone());
    assert!(a
        .metadata()
        .comments
        .iter()
        .any(|(k, v)| k == "R128_TRACK_GAIN" && v == "256"));
    assert!(a
        .metadata()
        .comments
        .iter()
        .any(|(k, _)| k == "REPLAYGAIN_TRACK_GAIN"));
    let baseline = decode(&mut a);
    assert_eq!(b.position_frames(), 0);
    drop(a);
    b.seek_to_frame(1000, &CancelFlag::default()).unwrap();
    assert_eq!(decode(&mut b).len(), (60006 - 1000) * 2);
    let mut gain = bytes;
    let header = gain.windows(8).position(|s| s == b"OpusHead").unwrap();
    gain[header + 16..header + 18].copy_from_slice(&(-6i16 * 256).to_le_bytes());
    fix_page_crc(&mut gain, 0);
    let mut d = open(gain);
    let boosted = decode(&mut d);
    let factor = 10.0f32.powf(-6.0 / 20.0);
    assert!(baseline
        .iter()
        .zip(boosted)
        .all(|(a, b)| (a * factor - b).abs() < 0.000001));
    let applied = d.metadata().applied;
    assert!(applied.trimmed_preskip && applied.trimmed_end && applied.applied_header_gain);
}
#[test]
fn chains_normalize_mixed_layout_and_seek_across_links() {
    let mono = media("mono.opus");
    let mut stereo = media("stereo.opus");
    let mut offset = 0;
    while offset < stereo.len() {
        stereo[offset + 14..offset + 18].copy_from_slice(&42u32.to_le_bytes());
        fix_page_crc(&mut stereo, offset);
        let n = stereo[offset + 26] as usize;
        offset += 27
            + n
            + stereo[offset + 27..offset + 27 + n]
                .iter()
                .map(|v| *v as usize)
                .sum::<usize>();
    }
    let mut chain = mono;
    chain.extend(stereo);
    let mut d = open(chain);
    assert_eq!(d.layout().layout, ChannelLayout::Stereo);
    assert_eq!(d.total_frames(), Some(72012));
    assert_eq!(decode(&mut d).len(), 72012 * 2);
    d.seek_to_frame(13000, &CancelFlag::default()).unwrap();
    assert_eq!(decode(&mut d).len(), (72012 - 13000) * 2);
}
#[test]
fn corrupt_truncated_channel_map_and_cancellation_are_typed() {
    for bytes in [b"nonsense".to_vec(), media("stereo.opus")[..100].to_vec()] {
        assert!(OpusInstance::open(
            Arc::new(MemSource::new(bytes)),
            OpusLimits::default(),
            &CancelFlag::default()
        )
        .is_err());
    }
    let mut d = open(media("stereo.opus"));
    assert!(matches!(
        d.seek_to_frame(1, &CancelFlag::cancelled()),
        Err(LibzciError::Cancelled)
    ));
    assert!(matches!(
        d.decode_into(&mut [0.0; 512], &CancelFlag::cancelled()),
        Err(LibzciError::Cancelled)
    ));
    let mut bytes = media("stereo.opus");
    let header = bytes.windows(8).position(|v| v == b"OpusHead").unwrap();
    bytes[header + 18] = 255;
    fix_page_crc(&mut bytes, 0);
    assert!(OpusInstance::open(
        Arc::new(MemSource::new(bytes)),
        OpusLimits::default(),
        &CancelFlag::default()
    )
    .is_err());
}
#[test]
fn callback_reads_are_bounded() {
    #[derive(Debug)]
    struct Counting {
        data: MemSource,
        max: std::sync::atomic::AtomicUsize,
    }
    impl RuntimeSource for Counting {
        fn id(&self) -> SourceId {
            self.data.id()
        }
        fn revision(&self) -> u64 {
            1
        }
        fn caps(&self) -> SourceCaps {
            self.data.caps()
        }
        fn read_at(&self, offset: u64, buf: &mut [u8], c: &CancelFlag) -> Result<usize> {
            self.max
                .fetch_max(buf.len(), std::sync::atomic::Ordering::Relaxed);
            self.data.read_at(offset, buf, c)
        }
    }
    let source = Arc::new(Counting {
        data: MemSource::new(media("long.opus")),
        max: Default::default(),
    });
    let mut d = OpusInstance::open(
        source.clone(),
        OpusLimits::default(),
        &CancelFlag::default(),
    )
    .unwrap();
    let mut buf = [0.0; 1024];
    while d.decode_into(&mut buf, &CancelFlag::default()).unwrap() > 0 {}
    assert!(source.max.load(std::sync::atomic::Ordering::Relaxed) <= 32768);
}
#[test]
fn raw_packet_path_matches_reference_trim_gain_and_pcm() {
    for name in ["mono", "stereo", "long"] {
        let bytes = media(&format!("{name}.opus"));
        let mut baseline = open(bytes.clone());
        let mut raw = raw_opus::OpusFactory::default()
            .open(Arc::new(MemSource::new(bytes)), &CancelFlag::default())
            .unwrap();
        let a = decode(&mut baseline);
        let b = decode(&mut *raw);
        assert_eq!(a.len(), b.len());
        assert!(a.iter().zip(b).all(|(a, b)| (a - b).abs() < 0.000001));
    }
}
#[test]
fn cancellation_inside_real_source_callbacks_and_source_errors_survive_ffi() {
    use std::sync::atomic::{AtomicBool, Ordering};
    #[derive(Debug)]
    struct Source {
        inner: MemSource,
        cancel_next: AtomicBool,
        deny: AtomicBool,
    }
    impl RuntimeSource for Source {
        fn id(&self) -> SourceId {
            self.inner.id()
        }
        fn revision(&self) -> u64 {
            1
        }
        fn caps(&self) -> SourceCaps {
            self.inner.caps()
        }
        fn read_at(&self, offset: u64, buf: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
            if self.deny.load(Ordering::Acquire) {
                return Err(LibzciError::AccessRequired {
                    detail: "test grant revoked".into(),
                });
            }
            if self.cancel_next.swap(false, Ordering::AcqRel) {
                cancel.cancel();
            }
            self.inner.read_at(offset, buf, cancel)
        }
    }
    let source = Arc::new(Source {
        inner: MemSource::new(media("long.opus")),
        cancel_next: AtomicBool::new(true),
        deny: AtomicBool::new(false),
    });
    assert!(matches!(
        OpusInstance::open(source.clone(), Default::default(), &CancelFlag::default()),
        Err(LibzciError::Cancelled)
    ));
    let mut instance =
        OpusInstance::open(source.clone(), Default::default(), &CancelFlag::default()).unwrap();
    source.cancel_next.store(true, Ordering::Release);
    assert!(matches!(
        instance.seek_to_frame(720_000, &CancelFlag::default()),
        Err(LibzciError::Cancelled)
    ));
    instance.seek_to_frame(0, &CancelFlag::default()).unwrap();
    source.cancel_next.store(true, Ordering::Release);
    let mut scratch = [0.0; 4096];
    let mut interrupted = false;
    for _ in 0..1000 {
        match instance.decode_into(&mut scratch, &CancelFlag::default()) {
            Err(LibzciError::Cancelled) => {
                interrupted = true;
                break;
            }
            Ok(_) => (),
            other => panic!("unexpected {other:?}"),
        }
    }
    assert!(interrupted);
    drop(instance);
    assert_eq!(Arc::strong_count(&source), 1);
    source.deny.store(true, Ordering::Release);
    assert!(matches!(
        OpusInstance::open(source.clone(), Default::default(), &CancelFlag::default()),
        Err(LibzciError::AccessRequired { .. })
    ));
    assert_eq!(Arc::strong_count(&source), 1);
}
