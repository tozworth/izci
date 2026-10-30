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
