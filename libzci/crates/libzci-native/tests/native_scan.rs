use libzci::{catalog::*, profile::Profile, CancelFlag};
use libzci_native::{
    profile::NativeDatabase,
    scan::{NativeScanJob, ScanEvent},
    source::native_reference,
    NativeRuntime,
};
use std::{
    path::Path,
    sync::Arc,
    time::{Duration, Instant},
};
struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "libzci-native-scan-{}-{}",
            std::process::id(),
            libzci::RequestId::fresh().0
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn wave(path: &Path) {
    let mut b = vec![];
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&236u32.to_le_bytes());
    b.extend_from_slice(b"WAVEfmt ");
    b.extend_from_slice(&16u32.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&1u16.to_le_bytes());
    b.extend_from_slice(&48000u32.to_le_bytes());
    b.extend_from_slice(&96000u32.to_le_bytes());
    b.extend_from_slice(&2u16.to_le_bytes());
    b.extend_from_slice(&16u16.to_le_bytes());
    b.extend_from_slice(b"data");
    b.extend_from_slice(&200u32.to_le_bytes());
    for n in 0..100i16 {
        b.extend_from_slice(&(n * 100).to_le_bytes());
    }
    std::fs::write(path, b).unwrap();
}
fn next(job: &mut NativeScanJob) -> ScanEvent {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(event) = job.poll() {
            return event;
        }
        assert!(Instant::now() < deadline, "scan timed out");
        std::thread::sleep(Duration::from_millis(1));
    }
}
#[cfg(feature = "provider-tests")]
#[test]
fn images_scan_as_catalog_media_preserve_facts_and_cannot_enter_the_queue() {
    use libzci::queue::QueueCommand;
    let files = Temp::new();
    let profile = Temp::new();
    let fixture = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/m3/artwork.png");
    std::fs::copy(&fixture, files.0.join("cover.png")).unwrap();
    std::fs::copy(&fixture, files.0.join("picture.wav")).unwrap();
    std::fs::copy(&fixture, files.0.join("unknown.bytes")).unwrap();
    wave(&files.0.join("audio.jpg"));
    let runtime = NativeRuntime::new();
    runtime
        .register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
        .unwrap();
    let mut db = NativeDatabase::open(&profile.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let root = p
        .catalog_request(
            CatalogCommand::Root {
                root: RootInput {
                    source: native_reference(&files.0).unwrap(),
                    settings: ScanSettings {
                        verify_unknown: false,
                        ..Default::default()
                    },
                },
            },
            None,
            &mut db,
        )
        .unwrap()
        .root
        .unwrap();
    let scan = |p: &mut Profile, db: &mut NativeDatabase| {
        let plan = p.begin_scan(root, db).unwrap();
        let mut job = runtime
            .start_root_scan(&plan, &CancelFlag::default())
            .unwrap();
        loop {
            match next(&mut job) {
                ScanEvent::Media(media) => {
                    p.stage_scan(&plan.token, vec![media], db).unwrap();
                }
                ScanEvent::Complete(progress) => {
                    assert_eq!((progress.accepted, progress.ignored), (3, 1));
                    p.catalog_request(CatalogCommand::FinishScan { token: plan.token }, None, db)
                        .unwrap();
                    return;
                }
                ScanEvent::Failed(error) => panic!("{error}"),
            }
        }
    };
    scan(&mut p, &mut db);
    let images = p
        .catalog_query(
            &CatalogQuery {
                kind: Some(MediaKind::Image),
                ..Default::default()
            },
            &mut db,
        )
        .unwrap();
    assert_eq!(images.total, 2);
    let cover = images
        .rows
        .iter()
        .find(|r| r.source.display_path.ends_with("cover.png"))
        .unwrap();
    assert_eq!(cover.metadata.image.as_ref().unwrap().width, 256);
    assert_eq!(cover.metadata.duration_seconds, None);
    let disguised = images
        .rows
        .iter()
        .find(|r| r.source.display_path.ends_with("picture.wav"))
        .unwrap();
    let before = p.snapshot().clone();
    assert_eq!(
        p.command(
            QueueCommand::Append {
                sources: vec![disguised.source.clone()]
            },
            Some(&mut db)
        )
        .unwrap_err()
        .kind(),
        "unsupported"
    );
    assert_eq!(&before, p.snapshot());
    p.catalog_request(
        CatalogCommand::Favorite {
            media: cover.id,
            subsong: None,
            favorite: true,
        },
        None,
        &mut db,
    )
    .unwrap();
    scan(&mut p, &mut db);
    let favorites = p
        .catalog_query(
            &CatalogQuery {
                collection: Collection::Favorites,
                ..Default::default()
            },
            &mut db,
        )
        .unwrap();
    assert_eq!(favorites.rows[0].id, cover.id);
    let audio = p
        .catalog_query(
            &CatalogQuery {
                kind: Some(MediaKind::Audio),
                ..Default::default()
            },
            &mut db,
        )
        .unwrap();
    assert_eq!(audio.total, 1);
    assert!(audio.rows[0].metadata.image.is_none());
    drop(db);
    let mut native = libzci_native::profile::NativeProfile::open(&profile.0).unwrap();
    let before = native.core.snapshot().clone();
    assert_eq!(
        native
            .append_paths(&[files.0.join("cover.png")])
            .unwrap_err()
            .kind(),
        "unsupported"
    );
    assert_eq!(native.core.snapshot(), &before);
    assert_eq!(
        native
            .catalog_query(&CatalogQuery {
                kind: Some(MediaKind::Image),
                ..Default::default()
            })
            .unwrap()
            .total,
        2
    );
}
#[test]
fn real_folder_probe_reopen_rescan_and_nonrecursive_settings_use_same_catalog_api_without_output() {
    let files = Temp::new();
    let profile = Temp::new();
    std::fs::create_dir(files.0.join("nested")).unwrap();
    wave(&files.0.join("root.wav"));
    wave(&files.0.join("nested/child.wav"));
    std::fs::write(files.0.join("ignored.txt"), "non-media").unwrap();
    let runtime = NativeRuntime::new();
    runtime
        .register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
        .unwrap();
    let mut db = NativeDatabase::open(&profile.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let root = RootInput {
        source: native_reference(&files.0).unwrap(),
        settings: ScanSettings {
            verify_unknown: false,
            ..Default::default()
        },
    };
    let id = p
        .catalog_request(CatalogCommand::Root { root: root.clone() }, None, &mut db)
        .unwrap()
        .root
        .unwrap();
    let plan = p.begin_scan(id, &mut db).unwrap();
    let mut job = runtime
        .start_root_scan(&plan, &CancelFlag::default())
        .unwrap();
    let mut accepted = 0;
    loop {
        match next(&mut job) {
            ScanEvent::Media(media) => {
                assert_eq!(media.kind, MediaKind::Audio);
                assert!(media.metadata.duration_seconds.unwrap() > 0.);
                p.stage_scan(&plan.token, vec![media], &mut db).unwrap();
                accepted += 1;
            }
            ScanEvent::Complete(progress) => {
                assert_eq!((progress.accepted, progress.ignored), (2, 1));
                break;
            }
            ScanEvent::Failed(e) => panic!("{e}"),
        }
    }
    assert_eq!(accepted, 2);
    p.catalog_request(
        CatalogCommand::FinishScan { token: plan.token },
        None,
        &mut db,
    )
    .unwrap();
    let page = p.catalog_query(&CatalogQuery::default(), &mut db).unwrap();
    assert_eq!(page.total, 2);
    let root_media = page
        .rows
        .iter()
        .find(|r| r.metadata.title == "root")
        .unwrap()
        .id;
    p.catalog_request(
        CatalogCommand::Rate {
            media: root_media,
            subsong: None,
            rating: 9,
        },
        None,
        &mut db,
    )
    .unwrap();
    drop(db);
    let mut db = NativeDatabase::open(&profile.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let mut root = root;
    root.settings.recursive = false;
    p.catalog_request(CatalogCommand::Root { root }, None, &mut db)
        .unwrap();
    let plan = p.begin_scan(id, &mut db).unwrap();
    let mut job = runtime
        .start_root_scan(&plan, &CancelFlag::default())
        .unwrap();
    loop {
        match next(&mut job) {
            ScanEvent::Media(media) => {
                p.stage_scan(&plan.token, vec![media], &mut db).unwrap();
            }
            ScanEvent::Complete(_) => break,
            ScanEvent::Failed(e) => panic!("{e}"),
        }
    }
    let result = p
        .catalog_request(
            CatalogCommand::FinishScan { token: plan.token },
            None,
            &mut db,
        )
        .unwrap();
    assert_eq!(result.scan.unwrap().removed, 1);
    let page = p.catalog_query(&CatalogQuery::default(), &mut db).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.rows[0].id, root_media);
    assert_eq!(page.rows[0].facts.rating, 9);
}
#[test]
fn unavailable_corrupt_and_cancelled_native_jobs_never_claim_successful_enumeration() {
    let files = Temp::new();
    let profile = Temp::new();
    let runtime = NativeRuntime::new();
    runtime
        .register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
        .unwrap();
    let mut db = NativeDatabase::open(&profile.0).unwrap();
    let mut p = Profile::open(&mut db).unwrap();
    let root = RootInput {
        source: native_reference(&files.0).unwrap(),
        settings: ScanSettings {
            verify_unknown: false,
            ..Default::default()
        },
    };
    let id = p
        .catalog_request(CatalogCommand::Root { root }, None, &mut db)
        .unwrap()
        .root
        .unwrap();
    std::fs::write(files.0.join("broken.wav"), "broken").unwrap();
    let plan = p.begin_scan(id, &mut db).unwrap();
    let mut job = runtime
        .start_root_scan(&plan, &CancelFlag::default())
        .unwrap();
    assert!(matches!(next(&mut job), ScanEvent::Failed(_)));
    p.cancel_scan(&plan.token, &mut db).unwrap();
    std::fs::remove_file(files.0.join("broken.wav")).unwrap();
    for n in 0..200 {
        wave(&files.0.join(format!("{n}.wav")));
    }
    let plan = p.begin_scan(id, &mut db).unwrap();
    let mut job = runtime
        .start_root_scan(&plan, &CancelFlag::default())
        .unwrap();
    // Let the bounded event queue fill without consuming, then cancel. The
    // worker's send loop and directory producer must release their waits.
    std::thread::sleep(Duration::from_millis(30));
    job.cancel();
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        assert!(
            Instant::now() < deadline,
            "cancel blocked on full event queue"
        );
        match next(&mut job) {
            ScanEvent::Media(_) => {}
            ScanEvent::Failed(_) => break,
            ScanEvent::Complete(_) => panic!("cancelled scan completed"),
        }
    }
    p.cancel_scan(&plan.token, &mut db).unwrap();
    assert_eq!(
        p.catalog_query(&CatalogQuery::default(), &mut db)
            .unwrap()
            .total,
        0
    );
    let plan = p.begin_scan(id, &mut db).unwrap();
    std::fs::remove_dir_all(&files.0).unwrap();
    let mut job = runtime
        .start_root_scan(&plan, &CancelFlag::default())
        .unwrap();
    assert!(matches!(
        next(&mut job),
        ScanEvent::Failed(libzci::LibzciError::Unavailable { .. })
    ));
}
