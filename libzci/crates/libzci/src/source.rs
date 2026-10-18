//! Runtime sources.
//!
//! A runtime source handle is an *opened* readable byte range (native
//! file, browser File snapshot, in-memory test bytes). It is not a
//! Library record and not a durable profile entry; durable
//! source-reference IDs arrive with storage in Phase 3.
//!
//! Rules enforced here:
//!
//! - Reads are bounded: `read_at` serves one caller-supplied slice.
//!   Providers must not copy whole ordinary audio files to start
//!   streaming. Module providers that need a complete buffer declare
//!   it via [`SourceCaps::requires_full_buffer`] plus a maximum size.
//! - Offsets are absolute; out-of-range reads return `Ok(0)` (EOF)
//!   rather than an error.
//! - Cancellation is cooperative: implementations check `cancel`
//!   before doing work and return [`LibzciError::Cancelled`].
//! - Native paths keep their case (`NativeFileSource` never
//!   lowercases); identity comparison follows platform rules later.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use crate::error::{LibzciError, Result};
use crate::ids::SourceId;

/// Cooperative cancellation flag shared between control and decode jobs.
#[derive(Clone, Debug, Default)]
pub struct CancelFlag {
    local: Arc<AtomicBool>,
    parent: Option<Arc<CancelFlag>>,
}

impl CancelFlag {
    /// A flag that is already cancelled (for tests and disposal paths).
    pub fn cancelled() -> Self {
        let flag = Self::default();
        flag.cancel();
        flag
    }

    /// A job can be cancelled independently or by its caller.
    pub fn child_of(parent: &Self) -> Self {
        Self {
            local: Arc::new(AtomicBool::new(false)),
            parent: Some(Arc::new(parent.clone())),
        }
    }
    /// Signal cancellation.
    pub fn cancel(&self) {
        self.local.store(true, Ordering::SeqCst);
    }

    /// `true` if cancellation was signalled.
    pub fn is_cancelled(&self) -> bool {
        self.local.load(Ordering::SeqCst) || self.parent.as_ref().is_some_and(|p| p.is_cancelled())
    }

    /// Return [`LibzciError::Cancelled`] when signalled.
    pub fn check(&self) -> Result<()> {
        if self.is_cancelled() {
            Err(LibzciError::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// What a source can do, reported up front so providers can select
/// streaming versus buffered strategies and enforce limits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SourceCaps {
    /// Total length in bytes, when known.
    pub len: Option<u64>,
    /// Whether absolute `read_at` offsets are supported.
    pub seekable: bool,
    /// Module-style providers may need the whole input. When `true`,
    /// `max_buffer_bytes` bounds the copy.
    pub requires_full_buffer: bool,
    /// Upper bound for a full-buffer copy. `None` means the provider
    /// must stream (used with `requires_full_buffer == false`).
    pub max_buffer_bytes: Option<u64>,
}

impl SourceCaps {
    /// Ordinary seekable stream (native files, browser snapshots).
    pub fn seekable_stream(len: Option<u64>) -> Self {
        Self {
            len,
            seekable: true,
            requires_full_buffer: false,
            max_buffer_bytes: None,
        }
    }
}

/// An opened, readable byte source.
///
/// Implementations must be `Send + Sync`: decode jobs run off the
/// control thread and may read concurrently with control messages.
pub trait RuntimeSource: Send + Sync + std::fmt::Debug {
    /// Handle identity for diagnostics and registry bookkeeping.
    fn id(&self) -> SourceId;
    /// Source revision (mtime generation, snapshot epoch). Bumping it
    /// invalidates decoder preparation and derived caches without
    /// becoming a new rating/favorite identity (later phase).
    fn revision(&self) -> u64;
    /// Capabilities for provider selection and limit enforcement.
    fn caps(&self) -> SourceCaps;
    /// Read up to `buf.len()` bytes at absolute `offset`.
    /// Returns the number of bytes written (`0` at EOF).
    fn read_at(&self, offset: u64, buf: &mut [u8], cancel: &CancelFlag) -> Result<usize>;
    /// Convenience: total length when known.
    fn len(&self) -> Option<u64> {
        self.caps().len
    }

    /// Read exactly `buf.len()` bytes unless EOF or cancellation.
    /// Providers needing a complete bounded buffer use this after
    /// checking [`SourceCaps::max_buffer_bytes`].
    fn read_exact_at(
        &self,
        mut offset: u64,
        mut buf: &mut [u8],
        cancel: &CancelFlag,
    ) -> Result<()> {
        while !buf.is_empty() {
            cancel.check()?;
            let n = self.read_at(offset, buf, cancel)?;
            if n == 0 {
                return Err(LibzciError::Corrupt {
                    detail: format!("unexpected EOF at offset {offset}"),
                });
            }
            offset += n as u64;
            buf = &mut buf[n..];
        }
        Ok(())
    }
}

/// In-memory source for unit tests and the fake provider.
///
/// Production commands never report success *using* the fake provider;
/// this type only carries bytes for tests and the bounded-read checks.
#[derive(Debug)]
pub struct MemSource {
    id: SourceId,
    revision: u64,
    data: Vec<u8>,
    requires_full_buffer: bool,
}

impl MemSource {
    /// Create a streaming test source.
    pub fn new(data: Vec<u8>) -> Self {
        Self {
            id: SourceId::fresh(),
            revision: 1,
            data,
            requires_full_buffer: false,
        }
    }

    /// Create a source that declares a full-buffer requirement,
    /// exercising the module-provider path with an explicit bound.
    pub fn buffered(data: Vec<u8>, max_buffer_bytes: u64) -> (Self, u64) {
        let src = Self {
            id: SourceId::fresh(),
            revision: 1,
            data,
            requires_full_buffer: true,
        };
        let _ = max_buffer_bytes;
        (src, max_buffer_bytes)
    }

    /// Raw bytes (tests only).
    pub fn data(&self) -> &[u8] {
        &self.data
    }
}

impl RuntimeSource for MemSource {
    fn id(&self) -> SourceId {
        self.id
    }

    fn revision(&self) -> u64 {
        self.revision
    }

    fn caps(&self) -> SourceCaps {
        SourceCaps {
            len: Some(self.data.len() as u64),
            seekable: true,
            requires_full_buffer: self.requires_full_buffer,
            max_buffer_bytes: self.requires_full_buffer.then(|| self.data.len() as u64),
        }
    }

    fn read_at(&self, offset: u64, buf: &mut [u8], cancel: &CancelFlag) -> Result<usize> {
        cancel.check()?;
        if buf.is_empty() {
            return Ok(0);
        }
        let offset: usize = offset
            .try_into()
            .map_err(|_| LibzciError::InvalidArgument {
                detail: "offset out of range".into(),
            })?;
        if offset >= self.data.len() {
            return Ok(0);
        }
        let available = &self.data[offset..];
        let n = available.len().min(buf.len());
        buf[..n].copy_from_slice(&available[..n]);
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_reads_serve_slices_without_whole_copy() {
        let data: Vec<u8> = (0..=255u8).cycle().take(65536).collect();
        let src = MemSource::new(data.clone());
        let cancel = CancelFlag::default();
        let mut head = [0u8; 16];
        let mut tail = [0u8; 16];
        assert_eq!(src.read_at(0, &mut head, &cancel).unwrap(), 16);
        assert_eq!(src.read_at(65520, &mut tail, &cancel).unwrap(), 16);
        assert_eq!(&head, &data[..16]);
        assert_eq!(&tail, &data[65520..]);
        let mut eof = [0u8; 8];
        assert_eq!(src.read_at(1 << 20, &mut eof, &cancel).unwrap(), 0);
    }

    #[test]
    fn cancelled_reads_report_cancelled() {
        let src = MemSource::new(vec![1, 2, 3]);
        let mut buf = [0u8; 3];
        assert_eq!(
            src.read_at(0, &mut buf, &CancelFlag::cancelled()),
            Err(LibzciError::Cancelled)
        );
    }
}
