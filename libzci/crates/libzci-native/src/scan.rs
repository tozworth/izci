//! Bounded native enumeration/probe mechanism. The profile's scan API owns
//! membership/reconciliation. This job owns neither SQLite nor an audio output.
use crate::{source::native_reference, NativeFileSource, NativeRuntime};
use libzci::{
    catalog::{MediaInput, MediaKind, Metadata, ScanPlan},
    queue::SourceKind,
    *,
};
use std::{
    fs::{self, ReadDir},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError},
        Arc, Mutex,
    },
    time::Duration,
};

const DEPTH_LIMIT: usize = 64;
const VISIT_LIMIT: u64 = 1_000_000;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScanProgress {
    pub visited: u64,
    pub accepted: u64,
    pub ignored: u64,
}
pub enum ScanEvent {
    Media(MediaInput),
    Complete(ScanProgress),
    Failed(LibzciError),
}
pub struct NativeScanJob {
    cancel: CancelFlag,
    events: Receiver<ScanEvent>,
    terminal: bool,
}
impl NativeScanJob {
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
    pub fn poll(&mut self) -> Option<ScanEvent> {
        if self.terminal {
            return None;
        }
        match self.events.try_recv() {
            Ok(event) => {
                self.terminal = matches!(event, ScanEvent::Complete(_) | ScanEvent::Failed(_));
                Some(event)
            }
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => {
                self.terminal = true;
                Some(ScanEvent::Failed(LibzciError::Cancelled))
            }
        }
    }
}
impl Drop for NativeScanJob {
    fn drop(&mut self) {
        self.cancel();
    }
}
fn io_error(path: &Path, e: std::io::Error) -> LibzciError {
    let detail = format!("scan {}: {e}", path.display());
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        LibzciError::AccessRequired { detail }
    } else {
        LibzciError::Unavailable { detail }
    }
}
fn send<T>(tx: &SyncSender<T>, mut value: T, cancel: &CancelFlag) -> Result<()> {
    loop {
        cancel.check()?;
        match tx.try_send(value) {
            Ok(()) => return Ok(()),
            Err(TrySendError::Disconnected(_)) => return Err(LibzciError::Cancelled),
            Err(TrySendError::Full(v)) => {
                value = v;
                std::thread::sleep(Duration::from_millis(1));
            }
        }
    }
}
fn record(error: &Mutex<Option<LibzciError>>, cancel: &CancelFlag, e: LibzciError) {
    let mut first = error.lock().unwrap();
    if first.is_none() {
        *first = Some(e);
    }
    cancel.cancel();
}
fn enumerate(
    root: &Path,
    recursive: bool,
    tx: &SyncSender<PathBuf>,
    visited: &AtomicU64,
    cancel: &CancelFlag,
) -> Result<()> {
    let mut stack: Vec<ReadDir> = vec![fs::read_dir(root).map_err(|e| io_error(root, e))?];
    while let Some(dir) = stack.last_mut() {
        cancel.check()?;
        let Some(entry) = dir.next() else {
            stack.pop();
            continue;
        };
        let entry = entry.map_err(|e| io_error(root, e))?;
        if visited.fetch_add(1, Ordering::Relaxed) >= VISIT_LIMIT {
            return Err(LibzciError::ResourceExhausted {
                detail: "scan visited-entry budget exceeded".into(),
            });
        }
        let path = entry.path();
        let kind = entry.file_type().map_err(|e| io_error(&path, e))?;
        // Do not follow symlinks/junctions or special files: bounded recursion
        // and ownership must not wander outside the selected root or loop.
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() && recursive {
            if stack.len() >= DEPTH_LIMIT {
                return Err(LibzciError::ResourceExhausted {
                    detail: "scan directory depth exceeds 64".into(),
                });
            }
            stack.push(fs::read_dir(&path).map_err(|e| io_error(&path, e))?);
        } else if kind.is_file() {
            send(tx, path, cancel)?;
        }
    }
    Ok(())
}
fn inspect(
    path: &Path,
    registry: &ProviderRegistry,
    verify_unknown: bool,
    cancel: &CancelFlag,
) -> Result<Option<MediaInput>> {
    cancel.check()?;
    let hint = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let known = libzci::format::known_media_extension(&hint);
    if !known && !verify_unknown {
        return Ok(None);
    }
    let reference = native_reference(path)?;
    let source = Arc::new(NativeFileSource::open(Path::new(&reference.locator))?);
    let revision = source.revision_key();
    let mut header = [0; 32];
    let prefix = source.len().unwrap_or(32).min(32) as usize;
    source.read_exact_at(0, &mut header[..prefix], cancel)?;
    let (kind, metadata) = if known && libzci::artwork::raster_mime(&header[..prefix]).is_some() {
        return crate::images::inspect_native_image(path, cancel).map(Some);
    } else {
        let inspection = match registry.inspect(source, Some(&hint), verify_unknown, cancel) {
            Ok(facts) => facts,
            Err(LibzciError::Unsupported { .. }) if !known => return Ok(None),
            Err(e) => return Err(e),
        };
        let kind = if matches!(
            inspection.metadata.info.id,
            ProviderId::OPENMPT | ProviderId::HIVELY
        ) {
            MediaKind::Module
        } else {
            MediaKind::Audio
        };
        (
            kind,
            Metadata::from_provider(&inspection.metadata, &reference.display_path),
        )
    };
    cancel.check()?;
    let after = NativeFileSource::open(Path::new(&reference.locator))?;
    if after.revision_key() != revision {
        return Err(LibzciError::Unavailable {
            detail: format!("source changed during scan: {}", reference.display_path),
        });
    }
    Ok(Some(MediaInput {
        source: reference,
        source_revision: revision,
        kind,
        metadata,
    }))
}
impl NativeRuntime {
    pub fn start_root_scan(&self, plan: &ScanPlan, parent: &CancelFlag) -> Result<NativeScanJob> {
        if plan.root.config.source.kind != SourceKind::NativePath {
            return Err(LibzciError::InvalidArgument {
                detail: "native root scan requires a genuine native path".into(),
            });
        }
        let settings = plan.root.config.settings.clone();
        if !(1..=8).contains(&settings.probe_concurrency) {
            return Err(LibzciError::InvalidArgument {
                detail: "invalid scan concurrency".into(),
            });
        }
        parent.check()?;
        let root = PathBuf::from(&plan.root.config.source.locator);
        let registry = self.registry_snapshot();
        let cancel = CancelFlag::child_of(parent);
        let owner = cancel.clone();
        let (tx, events) = mpsc::sync_channel(settings.probe_concurrency as usize * 2);
        std::thread::Builder::new()
            .name("libzci-root-scan".into())
            .spawn(move || {
                let worker_cancel = CancelFlag::child_of(&owner);
                let error = Arc::new(Mutex::new(None));
                let visited = AtomicU64::new(0);
                let accepted = Arc::new(AtomicU64::new(0));
                let ignored = Arc::new(AtomicU64::new(0));
                let (paths, rx) =
                    mpsc::sync_channel::<PathBuf>(settings.probe_concurrency as usize * 2);
                let rx = Arc::new(Mutex::new(rx));
                let mut workers = vec![];
                for _ in 0..settings.probe_concurrency {
                    let rx = rx.clone();
                    let tx = tx.clone();
                    let registry = registry.clone();
                    let token = worker_cancel.clone();
                    let worker_error = error.clone();
                    let accepted = accepted.clone();
                    let ignored = ignored.clone();
                    let worker = std::thread::Builder::new()
                        .name("libzci-scan-probe".into())
                        .spawn(move || {
                            while token.check().is_ok() {
                                let path = match rx
                                    .lock()
                                    .unwrap()
                                    .recv_timeout(Duration::from_millis(20))
                                {
                                    Ok(p) => p,
                                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                                };
                                match inspect(&path, &registry, settings.verify_unknown, &token) {
                                    Ok(Some(media)) => {
                                        if let Err(e) = send(&tx, ScanEvent::Media(media), &token) {
                                            record(&worker_error, &token, e);
                                            break;
                                        }
                                        accepted.fetch_add(1, Ordering::Relaxed);
                                    }
                                    Ok(None) => {
                                        ignored.fetch_add(1, Ordering::Relaxed);
                                    }
                                    Err(e) => {
                                        record(&worker_error, &token, e);
                                        break;
                                    }
                                }
                            }
                        });
                    match worker {
                        Ok(w) => workers.push(w),
                        Err(e) => {
                            record(
                                &error,
                                &worker_cancel,
                                LibzciError::ResourceExhausted {
                                    detail: e.to_string(),
                                },
                            );
                            break;
                        }
                    }
                }
                if let Err(e) =
                    enumerate(&root, settings.recursive, &paths, &visited, &worker_cancel)
                {
                    record(&error, &worker_cancel, e);
                }
                drop(paths);
                for worker in workers {
                    if worker.join().is_err() {
                        record(
                            &error,
                            &worker_cancel,
                            LibzciError::DecoderFailure {
                                detail: "scan probe panicked".into(),
                            },
                        );
                    }
                }
                let result = error.lock().unwrap().take();
                let terminal = match result {
                    Some(e) => ScanEvent::Failed(e),
                    None => ScanEvent::Complete(ScanProgress {
                        visited: visited.load(Ordering::Relaxed),
                        accepted: accepted.load(Ordering::Relaxed),
                        ignored: ignored.load(Ordering::Relaxed),
                    }),
                };
                // Internal failure stops enumeration/probes; the terminal error can
                // still reach the live consumer. Dropping the job cancels this wait.
                let _ = send(&tx, terminal, &owner);
            })
            .map_err(|e| LibzciError::ResourceExhausted {
                detail: e.to_string(),
            })?;
        Ok(NativeScanJob {
            cancel,
            events,
            terminal: false,
        })
    }
}
