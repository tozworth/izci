//! Raw bridge to libopenmpt 0.8.4 (static).
//!
//! Only the module-lifecycle functions the provider needs are
//! declared. All calls are `unsafe`; the safe wrapper in
//! [`crate::openmpt`] owns one `openmpt_module_ext` per instance and
//! never shares it across threads. See
//! `libzci/vendor/dependencies.json` for the pin and
//! `libzci/scripts/acquire-module-deps.sh` for the reproducible build
//! (bundled miniz/minimp3/stb_vorbis, no mpg123 — the same feature set
//! the checked-in browser WASM reports).

use std::ffi::CStr;
use std::os::raw::{c_char, c_double, c_int};

/// Opaque standard module handle (borrowed from the ext handle).
#[allow(non_camel_case_types)]
pub enum openmpt_module {}

/// Opaque extension module handle (owned per instance).
#[allow(non_camel_case_types)]
pub enum openmpt_module_ext {}

/// Extension interface identifier for channel/volume interaction.
pub const INTERFACE_INTERACTIVE: &[u8] = b"interactive\0";

/// Render parameter indices (`libopenmpt.h`).
pub const RENDER_MASTERGAIN_MILLIBEL: c_int = 1;
pub const RENDER_STEREOSEPARATION_PERCENT: c_int = 2;
pub const RENDER_INTERPOLATIONFILTER_LENGTH: c_int = 3;
pub const RENDER_VOLUMERAMPING_STRENGTH: c_int = 4;

/// Error codes (`libopenmpt.h`).
pub const ERROR_OK: c_int = 0;
pub const ERROR_OUT_OF_MEMORY: c_int = 256 + 21;

/// Interactive interface in declaration order (`libopenmpt_ext.h`).
/// Function pointers are nullable; the provider checks them.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct InteractiveInterface {
    pub set_current_speed: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_int>,
    pub set_current_tempo: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_int>,
    pub set_tempo_factor: Option<extern "C" fn(*mut openmpt_module_ext, c_double) -> c_int>,
    pub get_tempo_factor: Option<extern "C" fn(*mut openmpt_module_ext) -> c_double>,
    pub set_pitch_factor: Option<extern "C" fn(*mut openmpt_module_ext, c_double) -> c_int>,
    pub get_pitch_factor: Option<extern "C" fn(*mut openmpt_module_ext) -> c_double>,
    pub set_global_volume: Option<extern "C" fn(*mut openmpt_module_ext, c_double) -> c_int>,
    pub get_global_volume: Option<extern "C" fn(*mut openmpt_module_ext) -> c_double>,
    pub set_channel_volume: Option<extern "C" fn(*mut openmpt_module_ext, i32, c_double) -> c_int>,
    pub get_channel_volume: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_double>,
    pub set_channel_mute_status:
        Option<extern "C" fn(*mut openmpt_module_ext, i32, c_int) -> c_int>,
    pub get_channel_mute_status: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_int>,
    pub set_instrument_mute_status:
        Option<extern "C" fn(*mut openmpt_module_ext, i32, c_int) -> c_int>,
    pub get_instrument_mute_status: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_int>,
    pub play_note:
        Option<extern "C" fn(*mut openmpt_module_ext, i32, i32, c_double, c_double) -> i32>,
    pub stop_note: Option<extern "C" fn(*mut openmpt_module_ext, i32) -> c_int>,
}

#[link(name = "openmpt")]
extern "C" {
    /// Load a module from memory. Input may be discarded afterwards.
    /// NULL log/err funcs select defaults; `error`/`error_message`
    /// report failures (message freed with `openmpt_free_string`).
    pub fn openmpt_module_ext_create_from_memory(
        filedata: *const std::os::raw::c_void,
        filesize: usize,
        logfunc: Option<extern "C" fn(*const c_char, *mut std::os::raw::c_void)>,
        loguser: *mut std::os::raw::c_void,
        errfunc: Option<extern "C" fn(c_int, *mut std::os::raw::c_void)>,
        erruser: *mut std::os::raw::c_void,
        error: *mut c_int,
        error_message: *mut *const c_char,
        ctls: *const std::os::raw::c_void,
    ) -> *mut openmpt_module_ext;
    /// Unload (also invalidates the borrowed `openmpt_module`).
    pub fn openmpt_module_ext_destroy(mod_ext: *mut openmpt_module_ext);
    /// Borrow the standard handle for render/transport calls.
    pub fn openmpt_module_ext_get_module(mod_ext: *mut openmpt_module_ext) -> *mut openmpt_module;
    /// Fill an extension interface struct; 1 on success.
    pub fn openmpt_module_ext_get_interface(
        mod_ext: *mut openmpt_module_ext,
        interface_id: *const c_char,
        interface: *mut std::os::raw::c_void,
        interface_size: usize,
    ) -> c_int;
    /// Free an error message from a failed create.
    pub fn openmpt_free_string(str: *const c_char);

    /// Render interleaved-separated float stereo; returns frames rendered (0 at EOF).
    pub fn openmpt_module_read_float_stereo(
        mod_: *mut openmpt_module,
        samplerate: i32,
        count: usize,
        left: *mut f32,
        right: *mut f32,
    ) -> usize;
    /// Current position in seconds.
    pub fn openmpt_module_get_position_seconds(mod_: *mut openmpt_module) -> c_double;
    /// Seek; returns the landed position in seconds.
    pub fn openmpt_module_set_position_seconds(
        mod_: *mut openmpt_module,
        seconds: c_double,
    ) -> c_double;
    /// Total duration in seconds (may be infinite for looping content).
    pub fn openmpt_module_get_duration_seconds(mod_: *mut openmpt_module) -> c_double;
    /// Channel count.
    pub fn openmpt_module_get_num_channels(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_get_current_order(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_get_current_pattern(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_get_current_row(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_get_pattern_num_rows(mod_: *mut openmpt_module, pattern: i32) -> i32;
    pub fn openmpt_module_get_pattern_row_channel_command(
        mod_: *mut openmpt_module,
        pattern: i32,
        row: i32,
        channel: i32,
        command: i32,
    ) -> u8;
    /// Subsong facts.
    pub fn openmpt_module_get_num_subsongs(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_get_selected_subsong(mod_: *mut openmpt_module) -> i32;
    pub fn openmpt_module_select_subsong(mod_: *mut openmpt_module, subsong: i32) -> i32;
    pub fn openmpt_module_get_subsong_name(
        mod_: *mut openmpt_module,
        subsong: i32,
    ) -> *const c_char;
    /// Repeat count (0 = play once, then EOF).
    pub fn openmpt_module_set_repeat_count(mod_: *mut openmpt_module, repeat_count: i32) -> i32;
    /// Render parameter (interpolation filter length, ...).
    pub fn openmpt_module_set_render_param(
        mod_: *mut openmpt_module,
        param: c_int,
        value: i32,
    ) -> c_int;
    /// Allocated metadata value for a key; release with openmpt_free_string.
    pub fn openmpt_module_get_metadata(
        mod_: *mut openmpt_module,
        key: *const c_char,
    ) -> *const c_char;
}

/// Error message from a failed create (takes ownership of the pointer).
///
/// # Safety
/// The pointer must be null or an unreleased string allocated by libopenmpt.
pub unsafe fn take_error_message(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return "libopenmpt load failed".into();
    }
    let message = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
    unsafe { openmpt_free_string(ptr) };
    message
}

/// Copy and free an allocated library string (empty on null).
///
/// # Safety
/// The pointer must be null or an unreleased string allocated by libopenmpt.
pub unsafe fn borrowed_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let value = unsafe { CStr::from_ptr(ptr).to_string_lossy().into_owned() };
    unsafe { openmpt_free_string(ptr) };
    value
}
