/*
 * Instance-safe Hively (AHX/HVL) context wrapper for libzci.
 *
 * Unlike scripts/vendor/ahx/ahx-wrapper.c (single global tune), every
 * function here operates on an explicit `lz_hively_ctx` created by
 * `lz_hively_open`. Two contexts decode, seek, mute, and close
 * independently; the only shared state is the read-only waveform/pan
 * and interpolation tables, filled once by `lz_hively_init_tables`
 * (the Rust owner calls it under `std::sync::Once`, after which the
 * tables are immutable).
 *
 * Duration discovery and seeks are bounded steps (`probe_step`,
 * `seek_step`) so callers can yield for cancellation between batches:
 * a 30-minute scan is never one uncancellable call, and probing runs
 * on decode jobs, never on audio callbacks. Probing uses a separate
 * probe tune and never disturbs the live playback position.
 *
 * Units: positions and durations are franc-sized. One Hively frame is
 * 1/50 s (`frame_samples` output samples at the context rate).
 */
#ifndef LZ_HIVELY_CONTEXT_H
#define LZ_HIVELY_CONTEXT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Opaque per-instance context (pointer-sized native handle). */
typedef struct lz_hively_ctx lz_hively_ctx;

/* Cap for duration probing: 30 minutes of 1/50 s frames. */
#define LZ_HIVELY_MAX_DURATION_FRAMES (30u * 60u * 50u)

/* Fill waveform/pan/interpolation tables once. Not thread-safe itself;
 * the owner must synchronize (Rust `Once`). Idempotent. */
void lz_hively_init_tables(void);

/*
 * Open a context on a copy of `data[0..length)` at `sample_rate` Hz
 * (8000..192000, clamped to stereo output). Returns NULL on failure
 * with a short message in `errbuf` (always NUL-terminated):
 * "unsupported" (not AHX/HVL magic), "corrupt" (claims magic but does
 * not load), or "resource" (allocation failure). `length` above 64 MiB
 * is refused as "resource".
 */
lz_hively_ctx *lz_hively_open(const uint8_t *data, uint32_t length,
                              uint32_t sample_rate, char *errbuf,
                              size_t errlen);

/* Release a context and its tune, buffers, and file copy. */
void lz_hively_close(lz_hively_ctx *ctx);

/* Static facts (valid until close). */
uint32_t lz_hively_subsong_count(const lz_hively_ctx *ctx);
uint32_t lz_hively_channel_count(const lz_hively_ctx *ctx);
uint32_t lz_hively_frame_samples(const lz_hively_ctx *ctx);
/* Title bytes (not NUL-terminated); `len` receives the bound. */
const char *lz_hively_title(const lz_hively_ctx *ctx, uint32_t *len);
/* Current order/row position (pattern display, Phase 4 use). */
uint32_t lz_hively_order(const lz_hively_ctx *ctx);
uint32_t lz_hively_row(const lz_hively_ctx *ctx);
uint32_t lz_hively_pattern_rows(const lz_hively_ctx *ctx);
int lz_hively_pattern_cell(const lz_hively_ctx *ctx, uint32_t order, uint32_t row, uint32_t channel, uint8_t *out);

/*
 * Select a subsong: re-initializes the live tune, resets the position,
 * and restarts duration probing (durations are per subsong). Returns 1
 * on success, 0 when the subsong does not exist.
 */
int lz_hively_select_subsong(lz_hively_ctx *ctx, uint32_t subsong);

/*
 * Probe duration without disturbing playback: decode up to
 * `max_frames` Hively frames on the internal probe tune. Returns 1;
 * `out_rendered` counts this call's frames, `out_ended` reports song
 * end, and `out_duration` accumulates probed frames. When `out_ended`
 * is set, the subsong duration is `out_duration` frames (finite EOF).
 * Hitting the cap without end means "unknown, treat as unbounded".
 */
int lz_hively_probe_step(lz_hively_ctx *ctx, uint32_t max_frames,
                         uint32_t *out_rendered, int *out_ended,
                         uint32_t *out_duration);

/*
 * Bounded seek: re-initializes when `target_frame` precedes the
 * current position, then forward-decodes at most `max_discard` frames.
 * `out_position` is the reached frame; call again while it differs
 * from the target (callers yield between batches). Clamps to the
 * probed duration when known.
 */
int lz_hively_seek_step(lz_hively_ctx *ctx, uint32_t target_frame,
                        uint32_t max_discard, uint32_t *out_position);

/*
 * Render up to `frames` interleaved stereo float samples into `out`
 * (exactly `frames * 2` floats). Returns rendered frames; 0 means end
 * of stream (`lz_hively_ended` set). Applies channel mutes and the
 * selected interpolation taps.
 */
uint32_t lz_hively_render_float(lz_hively_ctx *ctx, float *out,
                                uint32_t frames);

/* Audible position in output samples (frames * frame_samples). */
uint32_t lz_hively_position_samples(const lz_hively_ctx *ctx);
/* Not-yet-emitted sub-frame spill included in the position above. */
uint32_t lz_hively_spill_frames(const lz_hively_ctx *ctx);
/* Nonzero once the live tune reaches song end. */
int lz_hively_ended(const lz_hively_ctx *ctx);
/* Probed finite duration in output samples, or 0 when unknown. */
uint32_t lz_hively_duration_samples(const lz_hively_ctx *ctx);

/* Per-instance channel mute (1 = muted). Out-of-range channels fail. */
int lz_hively_set_channel_mute(lz_hively_ctx *ctx, uint32_t channel,
                               int muted);
/* Current mute state (0/1, -1 when out of range). */
int lz_hively_channel_mute(const lz_hively_ctx *ctx, uint32_t channel);
/* Currently selected subsong. */
uint32_t lz_hively_subsong(const lz_hively_ctx *ctx);
/* Interpolation taps: 2, 4, or 8; anything else selects stock (1). */
void lz_hively_set_interpolation(lz_hively_ctx *ctx, uint32_t taps);

#ifdef __cplusplus
}
#endif

#endif /* LZ_HIVELY_CONTEXT_H */
