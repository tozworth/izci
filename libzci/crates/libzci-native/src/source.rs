//! Native file source: bounded seekable reads over real paths.
//!
//! Case is preserved exactly: the path is stored and reported as given
//! and reads use the OS path verbatim (Linux identities are
//! case-sensitive). Missing files report [`LibzciError::Unavailable`],
//! permission failures report [`LibzciError::AccessRequired`], and all
//! reads are bounded slices — never whole-file copies.

use std::fmt;
use std::fs::File;
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::os::unix::fs::FileExt;
#[cfg(windows)]
use std::os::windows::fs::FileExt;

use libzci::{CancelFlag, LibzciError, Result, RuntimeSource, SourceCaps, SourceId};

/// Seekable native file opened as a runtime source.
#[derive(Debug)]
pub struct NativeFileSource {
    id: SourceId,
    /// Canonical persisted/display path target. Stored verbatim; no
    /// lowercasing or second folder-path cache (see contracts §1).
    path: PathBuf,
    file: File,
    len: u64,
    revision: u64,
}

impl NativeFileSource {
    /// Open the file at `path` for bounded random reads.
    pub fn open(path: &Path) -> Result<Self> {
        let file = File::open(path).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => LibzciError::Unavailable {
                detail: format!("missing file: {}", path.display()),
            },
            std::io::ErrorKind::PermissionDenied => LibzciError::AccessRequired {
                detail: format!("permission denied: {}", path.display()),
            },
            _ => LibzciError::Unavailable {
                detail: format!("cannot open {}: {e}", path.display()),
            },
        })?;
        let len = file
            .metadata()
            .map(|m| m.len())
            .map_err(|e| LibzciError::Unavailable {
                detail: format!("cannot stat {}: {e}", path.display()),
            })?;
        // Revision from mtime (nanos) when available, else length.
        // Stable enough to invalidate preparation/caches; durable
        // identity stays path-based in later catalog phases.
        let revision = file
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(len.wrapping_add(1));
        Ok(Self {
            id: SourceId::fresh(),
            path: path.to_path_buf(),
            file,
            len,
            revision,
        })
    }

    /// Verbatim path this source was opened from.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Display path (same verbatim string; no parallel cache).
    pub fn display_path(&self) -> String {
        self.path.display().to_string()
    }
}

impl RuntimeSource for NativeFileSource {
    fn id(&self) -> SourceId {
        self.id
    }

    fn revision(&self) -> u64 {
        self.revision
    }

    fn caps(&self) -> SourceCaps {
        SourceCaps::seekable_stream(Some(self.len))
    }

    fn read_at(&self, offset: u64, buf: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if buf.is_empty() || offset >= self.len {
            return Ok(0);
        }
        // Clamp to EOF so providers observe a finite stream.
        let max = (self.len - offset).min(buf.len() as u64) as usize;
        #[cfg(unix)]
        let read = self.file.read_at(&mut buf[..max], offset);
        #[cfg(windows)]
        let read = self.file.seek_read(&mut buf[..max], offset);
        let n = read.map_err(|e| match e.kind() {
            std::io::ErrorKind::PermissionDenied => LibzciError::AccessRequired {
                detail: format!("permission denied reading {}: {e}", self.path.display()),
            },
            _ => LibzciError::Unavailable {
                detail: format!("read failed at {offset}: {e}"),
            },
        })?;
        Ok(n)
    }
}

impl fmt::Display for NativeFileSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.path.display())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use libzci::CancelFlag;

    fn write_temp(bytes: &[u8]) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "libzci-native-test-{}-{}.bin",
            std::process::id(),
            fastrandish()
        ));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn fastrandish() -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        std::time::SystemTime::now().hash(&mut h);
        std::thread::current().id().hash(&mut h);
        h.finish()
    }

    #[test]
    fn bounded_reads_and_case_preserved() {
        let data: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
        let path = write_temp(&data);
        let src = NativeFileSource::open(&path).unwrap();
        // Verbatim path: no lowercasing.
        assert_eq!(src.path(), &path);
        let cancel = CancelFlag::default();
        let mut head = [0u8; 16];
        let mut tail = [0u8; 32];
        assert_eq!(src.read_at(0, &mut head, &cancel).unwrap(), 16);
        assert_eq!(src.read_at(4064, &mut tail, &cancel).unwrap(), 32);
        assert_eq!(&head, &data[..16]);
        assert_eq!(&tail, &data[4064..]);
        let mut eof = [0u8; 8];
        assert_eq!(src.read_at(1 << 30, &mut eof, &cancel).unwrap(), 0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn missing_reports_unavailable_not_unsupported() {
        let missing = Path::new("/nonexistent-libzci-probe/missing.bin");
        match NativeFileSource::open(missing) {
            Err(LibzciError::Unavailable { .. }) => {}
            other => panic!("expected Unavailable, got {other:?}"),
        }
    }
}
