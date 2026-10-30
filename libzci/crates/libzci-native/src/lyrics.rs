//! Independent bounded source reads; no provider instance or output is needed.
use crate::{NativeFileSource, NativeRuntime};
use libzci::{
    lyrics::{read_embedded_lyrics, LyricsDocument},
    *,
};
use std::{
    path::Path,
    sync::{
        mpsc::{self, Receiver, TryRecvError},
        Arc,
    },
};
pub struct LyricsJob {
    cancel: CancelFlag,
    result: Receiver<Result<Option<LyricsDocument>>>,
}
impl LyricsJob {
    pub fn from_source(source: Arc<dyn RuntimeSource>, parent: &CancelFlag) -> Result<Self> {
        parent.check()?;
        let cancel = CancelFlag::child_of(parent);
        let worker = cancel.clone();
        let (tx, result) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("libzci-lyrics".into())
            .spawn(move || {
                let _ = tx.send(read_embedded_lyrics(source.as_ref(), &worker));
            })
            .map_err(|e| LibzciError::ResourceExhausted {
                detail: e.to_string(),
            })?;
        Ok(Self { cancel, result })
    }
    pub fn from_path(path: &Path, parent: &CancelFlag) -> Result<Self> {
        Self::from_source(Arc::new(NativeFileSource::open(path)?), parent)
    }
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
    pub fn poll(&self) -> Option<Result<Option<LyricsDocument>>> {
        match self.result.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(LibzciError::Cancelled)),
        }
    }
}
impl Drop for LyricsJob {
    fn drop(&mut self) {
        self.cancel();
    }
}
impl NativeRuntime {
    pub fn start_lyrics(&self, source: SourceId, parent: &CancelFlag) -> Result<LyricsJob> {
        LyricsJob::from_source(
            self.get_source(source)
                .ok_or_else(|| LibzciError::Unavailable {
                    detail: "unknown lyric source".into(),
                })?,
            parent,
        )
    }
}
