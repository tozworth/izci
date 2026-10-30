//! Native scheduling for shared visual work. No SQL or audio session ownership.
use crate::{NativeFileSource, NativeRuntime};
use libzci::{
    images::{run_image_job, ImageJobRequest, ImageJobResult},
    *,
};
use std::{
    path::Path,
    sync::{
        mpsc::{self, Receiver, TryRecvError},
        Arc,
    },
};
pub struct ImageJob {
    cancel: CancelFlag,
    result: Receiver<Result<ImageJobResult>>,
}
impl ImageJob {
    pub fn from_source(
        source: Arc<dyn RuntimeSource>,
        request: ImageJobRequest,
        parent: &CancelFlag,
    ) -> Result<Self> {
        parent.check()?;
        request.validate()?;
        let cancel = CancelFlag::child_of(parent);
        let worker = cancel.clone();
        let (tx, result) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("libzci-image".into())
            .spawn(move || {
                let _ = tx.send(run_image_job(source.as_ref(), request, &worker));
            })
            .map_err(|e| LibzciError::ResourceExhausted {
                detail: e.to_string(),
            })?;
        Ok(Self { cancel, result })
    }
    pub fn from_path(path: &Path, request: ImageJobRequest, parent: &CancelFlag) -> Result<Self> {
        Self::from_source(Arc::new(NativeFileSource::open(path)?), request, parent)
    }
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
    pub fn poll(&self) -> Option<Result<ImageJobResult>> {
        match self.result.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(LibzciError::Cancelled)),
        }
    }
}
impl Drop for ImageJob {
    fn drop(&mut self) {
        self.cancel();
    }
}
impl NativeRuntime {
    pub fn start_image_job(
        &self,
        source: SourceId,
        request: ImageJobRequest,
        parent: &CancelFlag,
    ) -> Result<ImageJob> {
        ImageJob::from_source(
            self.get_source(source)
                .ok_or_else(|| LibzciError::Unavailable {
                    detail: "unknown image source".into(),
                })?,
            request,
            parent,
        )
    }
}
