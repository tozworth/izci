//! Raw bridge to the instance-safe Hively context wrapper
//! (`c/hively_context.{c,h}` over upstream `hvl2wav/replay.c`).
//!
//! All calls are `unsafe`; the safe wrapper in [`crate::hively`] owns
//! one context per instance. Table initialization is synchronized by
//! the Rust owner (`std::sync::Once`); afterwards tables are
//! read-only. See `libzci/vendor/dependencies.json` for the upstream
//! pin and `libzci/scripts/acquire-module-deps.sh` for the build.

use std::os::raw::{c_char, c_int};

/// Opaque per-instance context (pointer-sized native handle).
#[allow(non_camel_case_types)]
pub enum lz_hively_ctx {}

/// Duration probe cap in 1/50 s frames (30 minutes).
pub const MAX_DURATION_FRAMES: u32 = 30 * 60 * 50;

#[link(name = "hivelycontext")]
extern "C" {
    /// Fill shared tables once (owner-synchronized, idempotent).
    pub fn lz_hively_init_tables();
    /// Open on a copy of `data`; NULL on failure with `errbuf` set to
    /// "unsupported" | "corrupt" | "resource".
    pub fn lz_hively_open(
        data: *const u8,
        length: u32,
        sample_rate: u32,
        errbuf: *mut c_char,
        errlen: usize,
    ) -> *mut lz_hively_ctx;
    /// Release the context and everything it owns.
    pub fn lz_hively_close(ctx: *mut lz_hively_ctx);
    /// Static facts.
    pub fn lz_hively_subsong_count(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_channel_count(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_frame_samples(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_title(ctx: *const lz_hively_ctx, len: *mut u32) -> *const c_char;
    pub fn lz_hively_order(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_row(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_pattern_rows(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_pattern_cell(
        ctx: *const lz_hively_ctx,
        order: u32,
        row: u32,
        channel: u32,
        out: *mut u8,
    ) -> c_int;
    pub fn lz_hively_subsong(ctx: *const lz_hively_ctx) -> u32;
    pub fn lz_hively_channel_mute(ctx: *const lz_hively_ctx, channel: u32) -> c_int;
    /// Select a subsong (resets position and duration probe).
    pub fn lz_hively_select_subsong(ctx: *mut lz_hively_ctx, subsong: u32) -> c_int;
    /// Bounded duration probe on the internal probe tune.
    pub fn lz_hively_probe_step(
        ctx: *mut lz_hively_ctx,
        max_frames: u32,
        out_rendered: *mut u32,
        out_ended: *mut c_int,
        out_duration: *mut u32,
    ) -> c_int;
    /// Bounded seek on the live tune.
    pub fn lz_hively_seek_step(
        ctx: *mut lz_hively_ctx,
        target_frame: u32,
        max_discard: u32,
        out_position: *mut u32,
    ) -> c_int;
    /// Render interleaved stereo float; returns rendered frames.
    pub fn lz_hively_render_float(ctx: *mut lz_hively_ctx, out: *mut f32, frames: u32) -> u32;
    /// Decoded position (includes seek-discards and spill; the Rust
    /// owner tracks emitted position separately).
    pub fn lz_hively_position_samples(ctx: *const lz_hively_ctx) -> u32;
    /// Not-yet-emitted spill included above.
    pub fn lz_hively_spill_frames(ctx: *const lz_hively_ctx) -> u32;
    /// Song end reached on the live tune.
    pub fn lz_hively_ended(ctx: *const lz_hively_ctx) -> c_int;
    /// Probed finite duration in samples (0 when unknown).
    pub fn lz_hively_duration_samples(ctx: *const lz_hively_ctx) -> u32;
    /// Per-instance mute (1 = muted).
    pub fn lz_hively_set_channel_mute(ctx: *mut lz_hively_ctx, channel: u32, muted: c_int)
        -> c_int;
    /// Interpolation taps (2/4/8, else stock).
    pub fn lz_hively_set_interpolation(ctx: *mut lz_hively_ctx, taps: u32);
}

/// Call once per process before any open (idempotent helper).
pub fn ensure_tables() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe { lz_hively_init_tables() });
}
