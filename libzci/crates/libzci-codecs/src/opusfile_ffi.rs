//! Minimal ABI from pinned opusfile 0.12's include/opusfile.h.
use std::ffi::{c_char, c_int, c_void};
pub enum OggOpusFile {}
#[repr(C)]
pub struct OpusFileCallbacks {
    pub read: Option<unsafe extern "C" fn(*mut c_void, *mut u8, c_int) -> c_int>,
    pub seek: Option<unsafe extern "C" fn(*mut c_void, i64, c_int) -> c_int>,
    pub tell: Option<unsafe extern "C" fn(*mut c_void) -> i64>,
    pub close: Option<unsafe extern "C" fn(*mut c_void) -> c_int>,
}
#[repr(C)]
pub struct OpusHead {
    pub version: c_int,
    pub channel_count: c_int,
    pub pre_skip: u32,
    pub input_sample_rate: u32,
    pub output_gain: c_int,
    pub mapping_family: c_int,
    pub stream_count: c_int,
    pub coupled_count: c_int,
    pub mapping: [u8; 255],
}
#[repr(C)]
pub struct OpusTags {
    pub user_comments: *mut *mut c_char,
    pub comment_lengths: *mut c_int,
    pub comments: c_int,
    pub vendor: *mut c_char,
}
extern "C" {
    pub fn op_open_callbacks(
        source: *mut c_void,
        callbacks: *const OpusFileCallbacks,
        initial: *const u8,
        initial_len: usize,
        error: *mut c_int,
    ) -> *mut OggOpusFile;
    pub fn op_free(file: *mut OggOpusFile);
    pub fn op_link_count(file: *const OggOpusFile) -> c_int;
    pub fn op_head(file: *const OggOpusFile, link: c_int) -> *const OpusHead;
    pub fn op_tags(file: *const OggOpusFile, link: c_int) -> *const OpusTags;
    pub fn op_pcm_total(file: *const OggOpusFile, link: c_int) -> i64;
    pub fn op_pcm_tell(file: *const OggOpusFile) -> i64;
    pub fn op_pcm_seek(file: *mut OggOpusFile, position: i64) -> c_int;
    pub fn op_read_float(
        file: *mut OggOpusFile,
        out: *mut f32,
        size: c_int,
        link: *mut c_int,
    ) -> c_int;
    pub fn op_read_float_stereo(file: *mut OggOpusFile, out: *mut f32, size: c_int) -> c_int;
    pub fn op_set_gain_offset(file: *mut OggOpusFile, gain_type: c_int, offset: c_int) -> c_int;
}
pub const OP_HEADER_GAIN: c_int = 0;
