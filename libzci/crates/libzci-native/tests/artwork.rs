use libzci::*;
use libzci_native::{artwork::ArtworkJob, NativeRuntime};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
fn wait(job: &ArtworkJob) -> Result<Option<libzci::artwork::EncodedArtwork>> {
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
fn output_free_jobs_are_independent_and_typed() {
    let runtime = NativeRuntime::new();
    let source = runtime.insert_source(Arc::new(MemSource::new(vec![0; 10])));
    let job = runtime
        .start_artwork(source, &CancelFlag::default())
        .unwrap();
    assert!(wait(&job).unwrap().is_none());
    assert_eq!(
        runtime
            .start_artwork(source, &CancelFlag::cancelled())
            .err()
            .unwrap()
            .kind(),
        "cancelled"
    );
    runtime.release_source(source);
    assert_eq!(
        runtime
            .start_artwork(source, &CancelFlag::default())
            .err()
            .unwrap()
            .kind(),
        "unavailable"
    );
}
#[cfg(feature = "provider-tests")]
#[test]
fn real_artwork_and_lyrics_jobs_match_source_and_audio_stays_playable_without_payload_facts() {
    let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.local/libzci/media/m3");
    let expected = std::fs::read(root.join("artwork.png"))
        .expect("run crude-pwa test/artwork.mjs to generate fixtures");
    for ext in ["mp3", "flac", "ogg", "opus"] {
        let path = root.join(format!("artwork.{ext}"));
        let art = wait(&ArtworkJob::from_path(&path, &CancelFlag::default()).unwrap())
            .unwrap()
            .unwrap();
        assert_eq!(art.bytes, expected);
        assert_eq!(art.mime, "image/png");
        assert_eq!(art.picture_type, 3);
        let lyrics = libzci::lyrics::read_embedded_lyrics(
            &libzci_native::NativeFileSource::open(&path).unwrap(),
            &CancelFlag::default(),
        )
        .unwrap()
        .unwrap();
        assert_eq!(lyrics.lines[0].text, "with art");
        let runtime = NativeRuntime::new();
        runtime
            .register_provider(Arc::new(libzci_codecs::OpusFactory::default()))
            .unwrap();
        runtime
            .register_provider(Arc::new(libzci_symphonia::SymphoniaFactory))
            .unwrap();
        let source = runtime.insert_source(Arc::new(
            libzci_native::NativeFileSource::open(&path).unwrap(),
        ));
        let session = runtime.create_session();
        runtime
            .load(session, source, Some(ext), &CancelFlag::default())
            .unwrap();
        let snapshot = runtime.snapshot(session).unwrap();
        assert!(!snapshot
            .metadata
            .unwrap()
            .comments
            .iter()
            .any(|(key, _)| libzci::provider::is_embedded_payload_key(key)));
        let mut job = runtime
            .start_render(
                source,
                Some(ext),
                Default::default(),
                &CancelFlag::default(),
            )
            .unwrap();
        let mut frames = 0;
        loop {
            match job.next_step().unwrap() {
                libzci_native::render::RenderStep::Data { samples, .. } => {
                    assert!(samples.iter().all(|v| v.is_finite()));
                    frames += samples.len() / 2;
                }
                libzci_native::render::RenderStep::Pending => (),
                libzci_native::render::RenderStep::Complete(result) => {
                    assert_eq!(frames as u64, result.output_frames);
                    break;
                }
            }
        }
        assert!(frames > 3 * 48000);
        runtime.dispose_session(session);
    }
}
