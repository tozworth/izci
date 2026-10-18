//! Production reference Opus provider. libopusfile owns demux, seek, pre-skip,
//! end trim and mandatory header gain. R128/ReplayGain comments are reported only.
//! Only mapping-family-0 mono/stereo links are accepted; mixed chains are stereo.
use crate::opusfile_ffi as ffi;
use libzci::*;
use std::{ffi::c_void, ptr::NonNull, sync::Arc};

pub const OPUS_VERSION: &str = "libopusfile-0.12/libopus-1.5.2/r3";
#[derive(Clone, Copy, Debug)]
pub struct OpusLimits {
    pub max_source_bytes: u64,
    pub max_links: usize,
    pub max_comment_bytes: usize,
}
impl Default for OpusLimits {
    fn default() -> Self {
        Self {
            max_source_bytes: 1 << 30,
            max_links: 1024,
            max_comment_bytes: 65536,
        }
    }
}
#[derive(Clone, Copy, Debug, Default)]
pub struct OpusFactory {
    limits: OpusLimits,
}
impl OpusFactory {
    pub fn with_limits(limits: OpusLimits) -> Self {
        Self { limits }
    }
    pub fn limits(&self) -> OpusLimits {
        self.limits
    }
}
fn info() -> ProviderInfo {
    ProviderInfo {
        id: ProviderId::OPUS,
        version: OPUS_VERSION,
        display_name: "Reference Opus (libopusfile)",
    }
}
impl ProviderFactory for OpusFactory {
    fn info(&self) -> ProviderInfo {
        info()
    }
    fn probe(&self, input: &ProbeInput<'_>) -> ProbeScore {
        if input.header.windows(8).take(300).any(|v| v == b"OpusHead")
            && input.header.starts_with(b"OggS")
        {
            ProbeScore::Magic
        } else if input.extension_hint == Some("opus") {
            ProbeScore::Hint
        } else {
            ProbeScore::No
        }
    }
    fn open(
        &self,
        source: Arc<dyn RuntimeSource>,
        cancel: &CancelFlag,
    ) -> Result<Box<dyn DecoderInstance>> {
        Ok(Box::new(OpusInstance::open(source, self.limits, cancel)?))
    }
}
struct Context {
    source: Arc<dyn RuntimeSource>,
    position: u64,
    len: u64,
    cancel: CancelFlag,
    error: Option<LibzciError>,
    closed: bool,
}
impl Context {
    fn callback<T>(&mut self, failure: T, f: impl FnOnce(&mut Self) -> Result<T>) -> T {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(self))) {
            Ok(Ok(value)) => value,
            Ok(Err(error)) => {
                self.error = Some(error);
                failure
            }
            Err(_) => {
                self.error = Some(LibzciError::DecoderFailure {
                    detail: "source callback panicked".into(),
                });
                failure
            }
        }
    }
}
unsafe extern "C" fn read(ctx: *mut c_void, out: *mut u8, len: i32) -> i32 {
    let ctx = &mut *ctx.cast::<Context>();
    ctx.callback(-1, |c| {
        c.cancel.check()?;
        if len < 0 || out.is_null() {
            return Err(corrupt("invalid opusfile read"));
        }
        let len = (len as usize).min(32 * 1024);
        let slice = std::slice::from_raw_parts_mut(out, len);
        let n = c.source.read_at(c.position, slice, &c.cancel)?;
        if n > len {
            return Err(corrupt("source exceeded callback buffer"));
        }
        c.position += n as u64;
        Ok(n as i32)
    })
}
unsafe extern "C" fn seek(ctx: *mut c_void, offset: i64, whence: i32) -> i32 {
    let ctx = &mut *ctx.cast::<Context>();
    ctx.callback(-1, |c| {
        c.cancel.check()?;
        let base = match whence {
            0 => 0,
            1 => c.position,
            2 => c.len,
            _ => return Err(corrupt("invalid seek origin")),
        };
        let target = base as i128 + offset as i128;
        if target < 0 || target > c.len as i128 {
            return Err(corrupt("seek outside source"));
        }
        c.position = target as u64;
        Ok(0)
    })
}
unsafe extern "C" fn tell(ctx: *mut c_void) -> i64 {
    (*ctx.cast::<Context>()).position as i64
}
unsafe extern "C" fn close(ctx: *mut c_void) -> i32 {
    (*ctx.cast::<Context>()).closed = true;
    0
}
static CALLBACKS: ffi::OpusFileCallbacks = ffi::OpusFileCallbacks {
    read: Some(read),
    seek: Some(seek),
    tell: Some(tell),
    close: Some(close),
};

pub struct OpusInstance {
    handle: NonNull<ffi::OggOpusFile>,
    context: Box<Context>,
    layout: PcmLayout,
    total: u64,
    declared_channels: u16,
    comments: Vec<(String, String)>,
    at_eof: bool,
}
// SAFETY: the owned handle and stable boxed callbacks are used sequentially by
// one decoder worker. No pointer or borrow escapes a method; instances share no C state.
unsafe impl Send for OpusInstance {}
impl OpusInstance {
    pub fn linked_version() -> String {
        unsafe { std::ffi::CStr::from_ptr(crate::opus_ffi::opus_get_version_string()) }
            .to_string_lossy()
            .into_owned()
    }
    pub fn open(
        source: Arc<dyn RuntimeSource>,
        limits: OpusLimits,
        cancel: &CancelFlag,
    ) -> Result<Self> {
        cancel.check()?;
        let caps = source.caps();
        let len = caps.len.ok_or_else(|| LibzciError::Unsupported {
            detail: "reference Opus requires a finite source length".into(),
        })?;
        if !caps.seekable {
            return Err(LibzciError::Unsupported {
                detail: "reference Opus requires ranged seekable reads".into(),
            });
        }
        if len > limits.max_source_bytes || len > i64::MAX as u64 {
            return Err(LibzciError::ResourceExhausted {
                detail: "Opus source exceeds byte budget".into(),
            });
        }
        let mut context = Box::new(Context {
            source,
            position: 0,
            len,
            cancel: cancel.clone(),
            error: None,
            closed: false,
        });
        let mut error = 0;
        let handle = unsafe {
            ffi::op_open_callbacks(
                (&mut *context as *mut Context).cast(),
                &CALLBACKS,
                std::ptr::null(),
                0,
                &mut error,
            )
        };
        let handle = NonNull::new(handle).ok_or_else(|| {
            context
                .error
                .take()
                .unwrap_or_else(|| code_error("open", error))
        })?;
        // Install ownership before any fallible metadata work so every error frees it.
        let mut instance = Self {
            handle,
            context,
            layout: PcmLayout::mono48k(),
            total: 0,
            declared_channels: 1,
            comments: Vec::new(),
            at_eof: false,
        };
        let links = unsafe { ffi::op_link_count(handle.as_ptr()) };
        if links <= 0 || links as usize > limits.max_links {
            return Err(LibzciError::ResourceExhausted {
                detail: "Opus chain exceeds link budget".into(),
            });
        }
        let mut channels = None;
        let mut mixed = false;
        let mut comment_bytes = 0usize;
        for link in 0..links {
            cancel.check()?;
            let head = unsafe { ffi::op_head(handle.as_ptr(), link).as_ref() }
                .ok_or_else(|| corrupt("missing OpusHead"))?;
            if head.mapping_family != 0 || !(1..=2).contains(&head.channel_count) {
                return Err(LibzciError::Unsupported {
                    detail: "Opus supports mapping-family-0 mono/stereo links only".into(),
                });
            }
            instance.declared_channels = instance.declared_channels.max(head.channel_count as u16);
            mixed |= channels.is_some_and(|n| n != head.channel_count);
            channels = Some(head.channel_count);
            let tags = unsafe { ffi::op_tags(handle.as_ptr(), link).as_ref() }
                .ok_or_else(|| corrupt("missing OpusTags"))?;
            if tags.comments < 0 || tags.comments as usize > limits.max_comment_bytes {
                return Err(corrupt("invalid Opus comment count"));
            }
            for i in 0..tags.comments as usize {
                let size = unsafe { *tags.comment_lengths.add(i) };
                if size < 0 {
                    return Err(corrupt("invalid comment length"));
                }
                comment_bytes = comment_bytes
                    .checked_add(size as usize)
                    .ok_or_else(|| corrupt("comment size overflow"))?;
                if comment_bytes > limits.max_comment_bytes {
                    return Err(LibzciError::ResourceExhausted {
                        detail: "Opus comments exceed byte budget".into(),
                    });
                }
                let bytes = unsafe {
                    std::slice::from_raw_parts(
                        (*tags.user_comments.add(i)).cast::<u8>(),
                        size as usize,
                    )
                };
                let text = String::from_utf8_lossy(bytes);
                if let Some((key, value)) = text.split_once('=') {
                    instance
                        .comments
                        .push((key.to_ascii_uppercase(), value.to_owned()));
                }
            }
        }
        instance.layout = PcmLayout::new(
            if mixed || channels == Some(2) {
                ChannelLayout::Stereo
            } else {
                ChannelLayout::Mono
            },
            48_000,
        )?;
        let total = unsafe { ffi::op_pcm_total(handle.as_ptr(), -1) };
        if total < 0 {
            return Err(code_error("total", total as i32));
        }
        instance.total = total as u64;
        let code = unsafe { ffi::op_set_gain_offset(handle.as_ptr(), ffi::OP_HEADER_GAIN, 0) };
        if code != 0 {
            return Err(code_error("header gain", code));
        }
        cancel.check()?;
        Ok(instance)
    }
    pub fn comments(&self) -> &[(String, String)] {
        &self.comments
    }
    fn prepare(&mut self, cancel: &CancelFlag) -> Result<()> {
        cancel.check()?;
        self.context.cancel = cancel.clone();
        self.context.error = None;
        Ok(())
    }
    fn checked(&mut self, operation: &str, code: i32) -> Result<i32> {
        if let Some(error) = self.context.error.take() {
            return Err(error);
        }
        if code < 0 {
            Err(code_error(operation, code))
        } else {
            Ok(code)
        }
    }
}
impl DecoderInstance for OpusInstance {
    fn info(&self) -> ProviderInfo {
        info()
    }
    fn layout(&self) -> PcmLayout {
        self.layout
    }
    fn total_frames(&self) -> Option<u64> {
        Some(self.total)
    }
    fn position_frames(&self) -> u64 {
        if self.at_eof {
            return self.total;
        }
        unsafe { ffi::op_pcm_tell(self.handle.as_ptr()) }.max(0) as u64
    }
    fn decode_into(&mut self, out: &mut [f32], cancel: &CancelFlag) -> Result<usize> {
        self.prepare(cancel)?;
        if self.at_eof {
            return Ok(0);
        }
        let channels = self.layout.layout.channels() as usize;
        let len = out.len().min(8192) / channels * channels;
        if len == 0 {
            return Err(LibzciError::InvalidArgument {
                detail: "Opus output buffer holds no frame".into(),
            });
        }
        let code = unsafe {
            if channels == 2 {
                ffi::op_read_float_stereo(self.handle.as_ptr(), out.as_mut_ptr(), len as i32)
            } else {
                ffi::op_read_float(
                    self.handle.as_ptr(),
                    out.as_mut_ptr(),
                    len as i32,
                    std::ptr::null_mut(),
                )
            }
        };
        let frames = self.checked("decode", code)? as usize;
        cancel.check()?;
        Ok(frames * channels)
    }
    fn seek_to_frame(&mut self, frame: u64, cancel: &CancelFlag) -> Result<u64> {
        self.prepare(cancel)?;
        if frame >= self.total {
            self.at_eof = true;
            return Ok(self.total);
        }
        self.at_eof = false;
        let code = unsafe { ffi::op_pcm_seek(self.handle.as_ptr(), frame.min(self.total) as i64) };
        self.checked("seek", code)?;
        cancel.check()?;
        Ok(self.position_frames())
    }
    fn metadata(&self) -> ProviderMetadata {
        ProviderMetadata {
            info: info(),
            layout: self.layout,
            total_frames: Some(self.total),
            declared_channels: self.declared_channels,
            comments: self.comments.clone(),
            applied: AppliedAdjustments {
                trimmed_preskip: true,
                trimmed_end: true,
                applied_header_gain: true,
            },
        }
    }
}
impl Drop for OpusInstance {
    fn drop(&mut self) {
        unsafe {
            ffi::op_free(self.handle.as_ptr());
        }
        debug_assert!(self.context.closed);
    }
}
fn corrupt(detail: &str) -> LibzciError {
    LibzciError::Corrupt {
        detail: detail.into(),
    }
}
fn code_error(operation: &str, code: i32) -> LibzciError {
    let detail = format!("libopusfile {operation} returned {code}");
    match code {
        -130 | -134 => LibzciError::Unsupported { detail },
        _ => LibzciError::Corrupt { detail },
    }
}
