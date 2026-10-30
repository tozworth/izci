use libzci::{CancelFlag, LibzciError, MemSource, Result, RuntimeSource, SourceCaps, SourceId};
use libzci_native::lyrics::LyricsJob;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
fn wait(job: &LyricsJob) -> Result<Option<libzci::lyrics::LyricsDocument>> {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(result) = job.poll() {
            return result;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(1));
    }
}
#[test]
fn standalone_native_lyric_job_reads_transient_documents_without_providers_or_output() {
    let text = b"\x03eng\0[00:01]Native lyric";
    let mut frame = b"USLT".to_vec();
    frame.extend_from_slice(&(text.len() as u32).to_be_bytes());
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(text);
    let n = frame.len();
    let mut bytes = b"ID3\x03\0\0".to_vec();
    bytes.extend_from_slice(&[0, 0, (n >> 7) as u8, (n & 127) as u8]);
    bytes.extend(frame);
    let job =
        LyricsJob::from_source(Arc::new(MemSource::new(bytes)), &CancelFlag::default()).unwrap();
    let document = wait(&job).unwrap().unwrap();
    assert_eq!(document.lines[0].text, "Native lyric");
    assert_eq!(document.active(1.), Some(0..1));
}
#[derive(Debug)]
struct Held {
    id: SourceId,
    entered: Arc<AtomicBool>,
}
impl RuntimeSource for Held {
    fn id(&self) -> SourceId {
        self.id
    }
    fn revision(&self) -> u64 {
        1
    }
    fn caps(&self) -> SourceCaps {
        SourceCaps::seekable_stream(None)
    }
    fn read_at(&self, _: u64, _: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        self.entered.store(true, Ordering::Release);
        loop {
            cancel.check()?;
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}
#[test]
fn cancellation_reaches_a_held_source_and_does_not_prevent_an_independent_job() {
    let entered = Arc::new(AtomicBool::new(false));
    let job = LyricsJob::from_source(
        Arc::new(Held {
            id: SourceId::fresh(),
            entered: entered.clone(),
        }),
        &CancelFlag::default(),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while !entered.load(Ordering::Acquire) {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    let second = LyricsJob::from_source(
        Arc::new(MemSource::new(vec![0; 10])),
        &CancelFlag::default(),
    )
    .unwrap();
    assert!(wait(&second).unwrap().is_none());
    job.cancel();
    assert!(matches!(wait(&job), Err(LibzciError::Cancelled)));
}
