use libzci::{
    images::{ImageJobRequest, ImageJobResult, RenditionSpec},
    *,
};
use libzci_native::{images::ImageJob, NativeFileSource, NativeRuntime};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
fn wait(job: &ImageJob) -> Result<ImageJobResult> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(result) = job.poll() {
            return result;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
}
#[test]
fn native_snapshot_verification_refuses_a_modified_open_file() {
    let path = std::env::temp_dir().join(format!(
        "libzci-image-source-{}-{}",
        std::process::id(),
        RequestId::fresh().0
    ));
    std::fs::write(&path, b"original").unwrap();
    let source = NativeFileSource::open(&path).unwrap();
    source.verify_snapshot().unwrap();
    std::fs::write(&path, b"modified contents").unwrap();
    assert_eq!(source.verify_snapshot().unwrap_err().kind(), "unavailable");
    drop(source);
    std::fs::remove_file(path).unwrap();
}
#[test]
fn request_validation_and_cancellation_do_not_need_a_provider_or_output() {
    let runtime = NativeRuntime::new();
    let source = runtime.insert_source(Arc::new(MemSource::new(vec![0; 10])));
    assert_eq!(
        runtime
            .start_image_job(
                source,
                ImageJobRequest::Image {
                    spec: RenditionSpec { max_edge: 0 }
                },
                &CancelFlag::default()
            )
            .err()
            .unwrap()
            .kind(),
        "invalid-argument"
    );
    assert_eq!(
        runtime
            .start_image_job(source, ImageJobRequest::Inspect, &CancelFlag::cancelled())
            .err()
            .unwrap()
            .kind(),
        "cancelled"
    );
    assert_eq!(
        wait(
            &runtime
                .start_image_job(source, ImageJobRequest::Inspect, &CancelFlag::default())
                .unwrap()
        )
        .err()
        .unwrap()
        .kind(),
        "unsupported"
    );
}
#[cfg(feature = "provider-tests")]
#[test]
fn real_visual_jobs_share_renditions_and_do_not_mutate_the_music_session() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/m3");
    let runtime = NativeRuntime::new();
    runtime
        .register_provider(Arc::new(libzci::provider::FakeFactory::new(
            480000,
            PcmLayout::mono48k(),
        )))
        .unwrap();
    let music = runtime.insert_source(Arc::new(MemSource::new(b"FAKE".to_vec())));
    let session = runtime.create_session();
    runtime
        .load(session, music, None, &CancelFlag::default())
        .unwrap();
    let before = runtime.snapshot(session).unwrap();
    let image = runtime.insert_source(Arc::new(
        NativeFileSource::open(&root.join("artwork.png")).unwrap(),
    ));
    let inspection = wait(
        &runtime
            .start_image_job(image, ImageJobRequest::Inspect, &CancelFlag::default())
            .unwrap(),
    )
    .unwrap();
    assert_eq!(inspection.facts().unwrap().width, 256);
    let ImageJobResult::Rendition(Some(direct)) = wait(
        &runtime
            .start_image_job(
                image,
                ImageJobRequest::Image {
                    spec: RenditionSpec { max_edge: 64 },
                },
                &CancelFlag::default(),
            )
            .unwrap(),
    )
    .unwrap() else {
        panic!("expected image rendition")
    };
    assert_eq!((direct.width, direct.height), (64, 64));
    for ext in ["mp3", "flac", "ogg", "opus"] {
        let ImageJobResult::Rendition(Some(embedded)) = wait(
            &ImageJob::from_path(
                &root.join(format!("artwork.{ext}")),
                ImageJobRequest::Artwork {
                    spec: RenditionSpec { max_edge: 64 },
                },
                &CancelFlag::default(),
            )
            .unwrap(),
        )
        .unwrap() else {
            panic!("expected artwork rendition")
        };
        assert_eq!(direct.png, embedded.png);
    }
    let after = runtime.snapshot(session).unwrap();
    assert_eq!(before.revision, after.revision);
    assert_eq!(before.generation, after.generation);
    assert_eq!(before.position_frames, after.position_frames);
    assert_eq!(before.state, after.state);
    runtime.dispose_session(session);
}
