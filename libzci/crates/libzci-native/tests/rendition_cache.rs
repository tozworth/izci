use libzci::{images::*, *};
use libzci_native::{rendition_cache::RenditionCache, NativeFileSource};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("libzci-cache-{}", SessionId::fresh().0));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
#[derive(Debug)]
struct CountSource {
    inner: MemSource,
    reads: AtomicUsize,
}
impl RuntimeSource for CountSource {
    fn id(&self) -> SourceId {
        self.inner.id()
    }
    fn revision(&self) -> u64 {
        self.inner.revision()
    }
    fn caps(&self) -> SourceCaps {
        self.inner.caps()
    }
    fn read_at(&self, p: u64, b: &mut [u8], c: &CancelFlag) -> Result<usize> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.read_at(p, b, c)
    }
}
fn source() -> CountSource {
    let bytes = include_bytes!("fixtures/cache-source.png").to_vec();
    CountSource {
        inner: MemSource::new(bytes),
        reads: AtomicUsize::new(0),
    }
}
fn request() -> ImageJobRequest {
    ImageJobRequest::Image {
        spec: RenditionSpec { max_edge: 64 },
    }
}
fn rendered(result: ImageJobResult) -> ImageRendition {
    match result {
        ImageJobResult::Rendition(Some(r)) => r,
        _ => panic!("missing rendition"),
    }
}
#[test]
fn separate_cache_reopens_avoids_original_reads_and_recovers_corrupt_payloads() {
    let dir = Temp::new();
    let source = source();
    let cancel = CancelFlag::default();
    let cache = RenditionCache::open(&dir.0, Default::default()).unwrap();
    let a = rendered(cache.run(&source, "image", request(), &cancel).unwrap());
    assert!(source.reads.load(Ordering::SeqCst) > 0);
    drop(cache);
    source.reads.store(0, Ordering::SeqCst);
    let cache = RenditionCache::open(&dir.0, Default::default()).unwrap();
    let b = rendered(cache.run(&source, "image", request(), &cancel).unwrap());
    assert_eq!(a.rgba, b.rgba);
    assert_eq!(a.source, b.source);
    assert_eq!(source.reads.load(Ordering::SeqCst), 0);
    assert_eq!(cache.stats().hits, 1);
    let db = rusqlite::Connection::open(dir.0.join("artwork-cache-v1.sqlite3")).unwrap();
    db.execute("UPDATE renditions SET png=zeroblob(bytes)", [])
        .unwrap();
    let c = rendered(cache.run(&source, "image", request(), &cancel).unwrap());
    assert_eq!(a.png, c.png);
    assert!(source.reads.load(Ordering::SeqCst) > 0);
    assert_eq!(cache.stats().failures, 1);
    source.reads.store(0, Ordering::SeqCst);
    cache.run(&source, "image", request(), &cancel).unwrap();
    assert_eq!(source.reads.load(Ordering::SeqCst), 0);
    cache.clear().unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM renditions", [], |r| r
            .get::<_, u64>(0))
            .unwrap(),
        0
    );
    assert!(!dir.0.join("profile.sqlite3").exists());
}
#[test]
fn concurrent_admission_is_bounded_and_cache_write_failure_keeps_job_useful() {
    let dir = Temp::new();
    let source = Arc::new(source());
    let cache = Arc::new(
        RenditionCache::open(
            &dir.0,
            CacheBudget {
                bytes: 128 * 1024,
                entries: 2,
            },
        )
        .unwrap(),
    );
    std::thread::scope(|scope| {
        for n in 0..8 {
            let c = cache.clone();
            let s = source.clone();
            scope.spawn(move || {
                c.run(
                    s.as_ref(),
                    &format!("image{n}"),
                    request(),
                    &CancelFlag::default(),
                )
                .unwrap();
            });
        }
    });
    let db = rusqlite::Connection::open(dir.0.join("artwork-cache-v1.sqlite3")).unwrap();
    let (count, bytes): (u64, u64) = db
        .query_row("SELECT count(*),sum(bytes) FROM renditions", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(count, 2);
    assert!(bytes <= 128 * 1024);
    db.execute_batch("CREATE TRIGGER fail_cache BEFORE INSERT ON renditions BEGIN SELECT RAISE(ABORT,'test quota'); END;").unwrap();
    let r = rendered(
        cache
            .run(
                source.as_ref(),
                "uncached",
                request(),
                &CancelFlag::default(),
            )
            .unwrap(),
    );
    assert_eq!(r.width, 64);
    assert_eq!(cache.stats().failures, 1);
    assert!(matches!(
        cache.run(
            source.as_ref(),
            "cancelled",
            request(),
            &CancelFlag::cancelled()
        ),
        Err(LibzciError::Cancelled)
    ));
}
#[test]
fn changed_or_unavailable_native_source_cannot_serve_cached_pixels() {
    let dir = Temp::new();
    let original = source();
    let path = dir.0.join("image.png");
    let mut bytes = vec![0; original.len().unwrap() as usize];
    original
        .read_exact_at(0, &mut bytes, &CancelFlag::default())
        .unwrap();
    std::fs::write(&path, &bytes).unwrap();
    let cache = RenditionCache::open(&dir.0, Default::default()).unwrap();
    let opened = NativeFileSource::open(&path).unwrap();
    cache
        .run(&opened, "source", request(), &CancelFlag::default())
        .unwrap();
    std::fs::write(&path, b"changed source").unwrap();
    assert!(cache
        .run(&opened, "source", request(), &CancelFlag::default())
        .is_err());
    let changed = NativeFileSource::open(&path).unwrap();
    assert!(cache
        .run(&changed, "source", request(), &CancelFlag::default())
        .is_err());
    assert_eq!(cache.stats().hits, 0);
    std::fs::remove_file(&path).unwrap();
    assert!(NativeFileSource::open(&path).is_err());
}
