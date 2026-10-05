//! Raw bridge to the pinned reference libopus (1.5.2, static).
//!
//! Only the decoder functions the Opus provider needs are declared.
//! All calls are `unsafe`; the safe wrapper in [`crate::opus`] owns one
//! handle per provider instance and never shares it across threads.
//! See `libzci/vendor/dependencies.json` for the pin and
//! `libzci/scripts/acquire-media-deps.sh` for the reproducible build.

use std::ffi::CStr;
use std::os::raw::{c_char, c_int};

/// Opaque decoder state (owned per instance, see `OpusInstance`).
#[allow(non_camel_case_types)]
pub enum OpusDecoder {}

/// Success.
pub const OPUS_OK: c_int = 0;
/// One argument was invalid.
pub const OPUS_BAD_ARG: c_int = -1;
/// Output buffer too small (provider bug: frame capacity is fixed).
pub const OPUS_BUFFER_TOO_SMALL: c_int = -2;
/// Invalid compressed packet.
pub const OPUS_INVALID_PACKET: c_int = -4;

/// Application mode used for all provider decoders.
pub const OPUS_APPLICATION_AUDIO: c_int = 2049;

#[link(name = "opus")]
extern "C" {
    /// Library version string, e.g. `"libopus 1.5.2"`.
    pub fn opus_get_version_string() -> *const c_char;
    /// Bytes needed for a decoder with `channels` channels.
    pub fn opus_decoder_get_size(channels: c_int) -> c_int;
    /// Reset an existing decoder in place.
    pub fn opus_decoder_init(st: *mut OpusDecoder, fs: i32, channels: c_int) -> c_int;
    /// Allocate and initialize a decoder (`48000`, 1–2 channels here).
    pub fn opus_decoder_create(fs: i32, channels: c_int, error: *mut c_int) -> *mut OpusDecoder;
    /// Free a decoder created above.
    pub fn opus_decoder_destroy(st: *mut OpusDecoder);
    /// Decode up to `frame_size` frames of interleaved float PCM.
    /// `data.is_null()` performs packet-loss concealment for FEC gaps.
    pub fn opus_decode_float(
        st: *mut OpusDecoder,
        data: *const u8,
        len: i32,
        pcm: *mut f32,
        frame_size: c_int,
        decode_fec: c_int,
    ) -> c_int;
    /// Human-readable error for a negative return code.
    pub fn opus_strerror(error: c_int) -> *const c_char;
}

/// Library version string, or `"unknown"` when the pointer is null.
pub fn version_string() -> String {
    unsafe {
        let ptr = opus_get_version_string();
        if ptr.is_null() {
            return "unknown".into();
        }
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}

/// Error text for a negative libopus return code.
pub fn error_string(code: c_int) -> String {
    unsafe {
        let ptr = opus_strerror(code);
        if ptr.is_null() {
            return format!("libopus error {code}");
        }
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }
}
