use libzci::*;
use libzci_symphonia::SymphoniaFactory;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
};
#[derive(Debug)]
struct Source {
    inner: MemSource,
    max: AtomicUsize,
    denied: AtomicBool,
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
    fn read_at(&self, p: u64, b: &mut [u8], c: &CancelFlag) -> Result<usize> {
        self.max.fetch_max(b.len(), Ordering::Relaxed);
        if self.denied.load(Ordering::Acquire) {
            return Err(LibzciError::AccessRequired {
                detail: "test source access revoked".into(),
            });
        }
        self.inner.read_at(p, b, c)
    }
}
fn source(name: &str) -> Arc<Source> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/m1")
        .join(name);
    Arc::new(Source {
        inner: MemSource::new(
            std::fs::read(&path)
                .unwrap_or_else(|_| panic!("generate M1 fixtures: {}", path.display())),
        ),
        max: AtomicUsize::new(0),
        denied: AtomicBool::new(false),
    })
}
#[test]
fn access_loss_and_superseded_tokens_remain_typed() {
    let src = source("48000-2.wav");
    let old = CancelFlag::default();
    let mut d = SymphoniaFactory.open(src.clone(), &old).unwrap();
    old.cancel();
    let replacement = CancelFlag::default();
    // A seek's new token replaces the cancelled open token for future reads.
    d.seek_to_frame(30000, &replacement).unwrap();
    let mut buf = [0.; 8192];
    assert!(d.decode_into(&mut buf, &replacement).unwrap() > 0);
    src.denied.store(true, Ordering::Release);
    for _ in 0..200 {
        match d.decode_into(&mut buf, &replacement) {
            Err(e) => {
                assert_eq!(e.kind(), "access-required");
                return;
            }
            Ok(0) => panic!("access loss became EOF"),
            _ => (),
        }
    }
    panic!("source read never reported revoked access");
}
fn decode(d: &mut dyn DecoderInstance, c: &CancelFlag) -> Vec<f32> {
    let mut all = Vec::new();
    let mut buf = [0.; 1372];
    loop {
        let n = d.decode_into(&mut buf, c).unwrap();
        if n == 0 {
            break;
        }
        all.extend_from_slice(&buf[..n]);
        assert!(all.len() < 2_000_000);
    }
    all
}
#[test]
fn formats_seek_trim_eof_instances_and_bounded_reads() {
    for rate in [44100, 48000] {
        let channels = if rate == 44100 { 1 } else { 2 };
        for ext in ["wav", "mp3", "flac", "ogg"] {
            let src = source(&format!("{rate}-{channels}.{ext}"));
            let c = CancelFlag::default();
            let mut reg = ProviderRegistry::new();
            reg.register(Arc::new(SymphoniaFactory)).unwrap();
            let mut a = reg.open_best(src.clone(), Some(ext), &c).unwrap().1;
            let mut b = reg.open_best(src.clone(), None, &c).unwrap().1;
            let full = decode(a.as_mut(), &c);
            let total = (full.len() / channels) as u64;
            assert!(full.iter().any(|x| x.abs() > 0.05), "silent {ext}");
            assert!(
                (total as f64 / rate as f64 - 2.500125).abs() < 0.002,
                "{ext} {rate} frames {total}"
            );
            if let Some(n) = a.total_frames() {
                assert_eq!(total, n, "{ext} total");
            }
            assert_eq!(b.position_frames(), 0);
            let target = (rate / 2 + 3) as u64;
            b.seek_to_frame(target, &c).unwrap();
            assert_eq!(
                decode(b.as_mut(), &c),
                full[target as usize * channels..],
                "{ext} seek suffix"
            );
            b.seek_to_frame(0, &c).unwrap();
            assert_eq!(decode(b.as_mut(), &c), full, "{ext} rewind");
            assert_eq!(b.seek_to_frame(total, &c).unwrap(), total);
            assert!(decode(b.as_mut(), &c).is_empty());
            assert!(src.max.load(Ordering::Relaxed) <= 32768);
            assert_eq!(
                b.decode_into(&mut [0.; 8], &CancelFlag::cancelled())
                    .unwrap_err(),
                LibzciError::Cancelled
            );
        }
    }
}

#[test]
fn high_rates_and_unknown_duration_keep_exact_seek_suffixes() {
    for (name, rate, channels) in [
        ("96000-2.wav", 96000, 2),
        ("192000-1.wav", 192000, 1),
        ("no-duration.flac", 48000, 2),
    ] {
        let cancel = CancelFlag::default();
        let mut decoder = SymphoniaFactory.open(source(name), &cancel).unwrap();
        assert_eq!(decoder.layout().sample_rate, rate);
        if name == "no-duration.flac" {
            assert_eq!(decoder.total_frames(), None);
        }
        let full = decode(decoder.as_mut(), &cancel);
        let target = rate as u64 / 4;
        assert_eq!(decoder.seek_to_frame(target, &cancel).unwrap(), target);
        assert_eq!(
            decode(decoder.as_mut(), &cancel),
            full[target as usize * channels..]
        );
    }
}
