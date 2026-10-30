//! Adapter-free ranged Read/Seek over a source; preserve original typed failures.
use super::*;
use std::{
    cell::RefCell,
    io::{self, BufReader, Read, SeekFrom},
    rc::Rc,
};
pub(super) struct Cursor<'a> {
    source: &'a dyn RuntimeSource,
    cancel: &'a CancelFlag,
    position: u64,
    length: u64,
    error: Rc<RefCell<Option<LibzciError>>>,
}
impl Cursor<'_> {
    fn fail<T>(&self, error: LibzciError) -> io::Result<T> {
        *self.error.borrow_mut() = Some(error);
        Err(io::Error::other("image source access failed"))
    }
}
impl Read for Cursor<'_> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if let Err(error) = self.cancel.check() {
            return self.fail(error);
        }
        let length = out
            .len()
            .min(32768)
            .min(self.length.saturating_sub(self.position) as usize);
        if length == 0 {
            return Ok(0);
        }
        match self
            .source
            .read_at(self.position, &mut out[..length], self.cancel)
        {
            Ok(n) if n <= length => {
                self.position += n as u64;
                Ok(n)
            }
            Ok(_) => self.fail(LibzciError::Corrupt {
                detail: "invalid image source read".into(),
            }),
            Err(error) => self.fail(error),
        }
    }
}
impl Seek for Cursor<'_> {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        if let Err(error) = self.cancel.check() {
            return self.fail(error);
        }
        let len = self.length;
        let position = match from {
            SeekFrom::Start(n) => Some(n),
            SeekFrom::Current(n) => self.position.checked_add_signed(n),
            SeekFrom::End(n) => len.checked_add_signed(n),
        };
        if let Some(position) = position.filter(|n| *n <= len) {
            self.position = position;
            Ok(position)
        } else {
            Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "image seek outside source",
            ))
        }
    }
}
pub(super) fn with_source<T>(
    source: &dyn RuntimeSource,
    cancel: &CancelFlag,
    run: impl FnOnce(BufReader<Cursor<'_>>, &str) -> Result<T>,
) -> Result<T> {
    cancel.check()?;
    let len = source
        .len()
        .ok_or_else(|| unsupported("image source requires a known length"))?;
    if len > MAX_IMAGE_SOURCE_BYTES {
        return Err(budget("encoded image exceeds 64 MiB"));
    }
    let revision = source.revision();
    let mut header = [0; 32];
    let header_length = len.min(header.len() as u64) as usize;
    let mut filled = 0;
    while filled < header_length {
        let n = source.read_at(filled as u64, &mut header[filled..header_length], cancel)?;
        if n == 0 {
            break;
        }
        if n > header_length - filled {
            return Err(LibzciError::Corrupt {
                detail: "invalid image header read".into(),
            });
        }
        filled += n;
    }
    let mime = crate::artwork::raster_mime(&header[..filled])
        .ok_or_else(|| unsupported("unrecognized raster image"))?;
    let error = Rc::new(RefCell::new(None));
    let cursor = Cursor {
        source,
        cancel,
        position: 0,
        length: len,
        error: error.clone(),
    };
    let result = run(BufReader::with_capacity(32768, cursor), mime);
    let failure = error.borrow_mut().take();
    if let Some(error) = failure {
        return Err(error);
    }
    cancel.check()?;
    if source.revision() != revision {
        return Err(LibzciError::Unavailable {
            detail: "image source changed during reading".into(),
        });
    }
    result
}
