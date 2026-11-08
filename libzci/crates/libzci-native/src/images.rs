//! Native scheduling for shared visual work. No SQL or audio session ownership.
use crate::{NativeFileSource, NativeRuntime};
use libzci::{
    catalog::{MediaInput, MediaKind, Metadata},
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
/// Inspect one native raster path into a catalog input without opening audio
/// output or retaining the encoded source. Shared image limits/facts remain
/// authoritative; the adapter only supplies a live file source and revision.
pub fn inspect_native_image(path: &Path, cancel: &CancelFlag) -> Result<MediaInput> {
    cancel.check()?;
    let reference = crate::source::native_reference(path)?;
    let source = Arc::new(NativeFileSource::open(Path::new(&reference.locator))?);
    let revision = source.revision_key();
    let mut header = [0; 32];
    let prefix = source.len().unwrap_or(32).min(32) as usize;
    source.read_exact_at(0, &mut header[..prefix], cancel)?;
    if libzci::artwork::raster_mime(&header[..prefix]).is_none() {
        return Err(LibzciError::Unsupported {
            detail: "ordinary Open did not identify a raster image".into(),
        });
    }
    let facts = libzci::images::inspect_image(source.as_ref(), cancel)?;
    let after = NativeFileSource::open(Path::new(&reference.locator))?;
    if after.revision_key() != revision {
        return Err(LibzciError::Unavailable {
            detail: format!(
                "source changed during image inspection: {}",
                reference.display_path
            ),
        });
    }
    Ok(MediaInput {
        source: reference.clone(),
        source_revision: revision,
        kind: MediaKind::Image,
        metadata: Metadata::from_image(facts, &reference.display_path)?,
    })
}

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
        Self::from_source_cached(source, request, parent, None)
    }
    pub fn from_source_cached(
        source: Arc<dyn RuntimeSource>,
        request: ImageJobRequest,
        parent: &CancelFlag,
        cache: Option<(Arc<crate::rendition_cache::RenditionCache>, String)>,
    ) -> Result<Self> {
        parent.check()?;
        request.validate()?;
        let cancel = CancelFlag::child_of(parent);
        let worker = cancel.clone();
        let (tx, result) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("libzci-image".into())
            .spawn(move || {
                let result = if let Some((cache, key)) = cache {
                    cache.run(source.as_ref(), &key, request, &worker)
                } else {
                    run_image_job(source.as_ref(), request, &worker)
                };
                let _ = tx.send(result);
            })
            .map_err(|e| LibzciError::ResourceExhausted {
                detail: e.to_string(),
            })?;
        Ok(Self { cancel, result })
    }
    pub fn from_path(path: &Path, request: ImageJobRequest, parent: &CancelFlag) -> Result<Self> {
        Self::from_source(Arc::new(NativeFileSource::open(path)?), request, parent)
    }
    pub fn from_path_cached(
        path: &Path,
        request: ImageJobRequest,
        parent: &CancelFlag,
        cache: Option<Arc<crate::rendition_cache::RenditionCache>>,
    ) -> Result<Self> {
        let reference = crate::source::native_reference(path)?;
        Self::from_source_cached(
            Arc::new(NativeFileSource::open(path)?),
            request,
            parent,
            cache.map(|c| (c, reference.key)),
        )
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
