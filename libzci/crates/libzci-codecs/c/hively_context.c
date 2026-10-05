/*
 * Instance-safe Hively context wrapper. See hively_context.h.
 *
 * Ownership: each context owns its file copy, live tune, probe tune,
 * mix buffer, mutes, and position. Upstream replay state lives only in
 * those tunes. The waveform/pan tables (upstream `hvl_InitReplayer`)
 * and the interpolation tables below are filled once by
 * `lz_hively_init_tables` and never written afterwards; the Rust owner
 * serializes that call with `std::sync::Once`.
 */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "hively_context.h"

#include "types.h"
#include "replay.h"

#define LZ_FRAMES_PER_SECOND 50
#define LZ_WAVE_SAMPLES 0x280
#define LZ_WAVE_POSITION_LIMIT (LZ_WAVE_SAMPLES << 16)
#define LZ_INTERPOLATION_PHASES 256
#define LZ_INTERPOLATION_COEFFICIENT_SCALE 16384
#define LZ_MAX_SOURCE_BYTES (64u * 1024u * 1024u)

struct lz_hively_ctx {
  uint8_t *file_data;
  uint32_t file_length;
  struct hvl_tune *tune;
  struct hvl_tune *probe;
  int8_t *mix_buffer;
  float *spill;
  uint32_t spill_frames;
  uint32_t sample_rate;
  uint32_t frame_samples;
  uint32_t current_frame;
  uint32_t probed_frames;
  int probe_ended;
  uint32_t subsong;
  uint32_t interpolation_taps;
  uint8_t channel_muted[MAX_CHANNELS];
  uint32_t display_order;
  uint32_t display_row;
};

extern void hvl_play_irq(struct hvl_tune *tune);
extern void hvl_mixchunk(struct hvl_tune *tune, uint32_t samples,
                         int8_t *left, int8_t *right, int32_t stride);

static int32_t lz_interp_4tap[LZ_INTERPOLATION_PHASES][4];
static int32_t lz_interp_8tap[LZ_INTERPOLATION_PHASES][8];

static double lz_normalized_sinc(double value) {
  const double pi = 3.14159265358979323846;
  if (fabs(value) < 0.0000001) {
    return 1.0;
  }
  return sin(pi * value) / (pi * value);
}

void lz_hively_init_tables(void) {
  uint32_t phase;
  hvl_InitReplayer();
  for (phase = 0; phase < LZ_INTERPOLATION_PHASES; phase++) {
    const double fraction = (double)phase / LZ_INTERPOLATION_PHASES;
    const double squared = fraction * fraction;
    const double cubed = squared * fraction;
    const double cubic[4] = {
      -0.5 * fraction + squared - 0.5 * cubed,
      1.0 - 2.5 * squared + 1.5 * cubed,
      0.5 * fraction + 2.0 * squared - 1.5 * cubed,
      -0.5 * squared + 0.5 * cubed
    };
    int32_t cubic_sum = 0;
    uint32_t tap;
    for (tap = 0; tap < 4; tap++) {
      lz_interp_4tap[phase][tap] =
        (int32_t)lround(cubic[tap] * LZ_INTERPOLATION_COEFFICIENT_SCALE);
      cubic_sum += lz_interp_4tap[phase][tap];
    }
    lz_interp_4tap[phase][1] += LZ_INTERPOLATION_COEFFICIENT_SCALE - cubic_sum;
    {
      double lanczos[8];
      double lanczos_sum = 0.0;
      int32_t fixed_sum = 0;
      for (tap = 0; tap < 8; tap++) {
        const double distance = fraction - ((int32_t)tap - 3);
        lanczos[tap] =
          lz_normalized_sinc(distance) * lz_normalized_sinc(distance / 4.0);
        lanczos_sum += lanczos[tap];
      }
      for (tap = 0; tap < 8; tap++) {
        lz_interp_8tap[phase][tap] = (int32_t)lround(
          lanczos[tap] * LZ_INTERPOLATION_COEFFICIENT_SCALE / lanczos_sum);
        fixed_sum += lz_interp_8tap[phase][tap];
      }
      lz_interp_8tap[phase][3] += LZ_INTERPOLATION_COEFFICIENT_SCALE - fixed_sum;
    }
  }
}

static uint32_t lz_wrap_sample_index(int32_t index) {
  if (index < 0) {
    return (uint32_t)(index + LZ_WAVE_SAMPLES);
  }
  if (index >= LZ_WAVE_SAMPLES) {
    return (uint32_t)(index - LZ_WAVE_SAMPLES);
  }
  return (uint32_t)index;
}

static int32_t lz_interpolated_sample(const lz_hively_ctx *ctx,
                                      const int8_t *source,
                                      uint32_t position) {
  const int32_t index = (int32_t)(position >> 16);
  const uint32_t phase = (position >> 8) & 0xff;
  uint32_t tap;

  if (ctx->interpolation_taps == 2) {
    const int32_t current = source[index];
    const int32_t next = source[lz_wrap_sample_index(index + 1)];
    return current * (LZ_INTERPOLATION_PHASES - (int32_t)phase) +
           next * (int32_t)phase;
  }
  if (ctx->interpolation_taps == 4) {
    int32_t value = 0;
    for (tap = 0; tap < 4; tap++) {
      value += source[lz_wrap_sample_index(index + (int32_t)tap - 1)] *
               lz_interp_4tap[phase][tap];
    }
    return value / (LZ_INTERPOLATION_COEFFICIENT_SCALE >> 8);
  }
  {
    int32_t value = 0;
    for (tap = 0; tap < 8; tap++) {
      value += source[lz_wrap_sample_index(index + (int32_t)tap - 3)] *
               lz_interp_8tap[phase][tap];
    }
    return value / (LZ_INTERPOLATION_COEFFICIENT_SCALE >> 8);
  }
}

static void lz_mix_interpolated_chunk(lz_hively_ctx *ctx, uint32_t samples,
                                      int8_t *left_buffer,
                                      int8_t *right_buffer,
                                      int32_t buffer_stride) {
  const int8_t *source[MAX_CHANNELS];
  const int8_t *ring_source[MAX_CHANNELS];
  uint32_t delta[MAX_CHANNELS];
  uint32_t ring_delta[MAX_CHANNELS];
  int32_t volume[MAX_CHANNELS];
  uint32_t position[MAX_CHANNELS];
  uint32_t ring_position[MAX_CHANNELS];
  int32_t pan_left[MAX_CHANNELS];
  int32_t pan_right[MAX_CHANNELS];
  const uint32_t channels = (uint32_t)ctx->tune->ht_Channels;
  uint32_t channel;
  uint32_t sample;

  for (channel = 0; channel < channels; channel++) {
    const struct hvl_voice *voice = &ctx->tune->ht_Voices[channel];
    source[channel] = voice->vc_MixSource;
    ring_source[channel] = voice->vc_RingMixSource;
    delta[channel] = voice->vc_Delta;
    ring_delta[channel] = voice->vc_RingDelta;
    volume[channel] =
      ctx->channel_muted[channel] ? 0 : voice->vc_VoiceVolume;
    position[channel] = voice->vc_SamplePos;
    ring_position[channel] = voice->vc_RingSamplePos;
    pan_left[channel] = voice->vc_PanMultLeft;
    pan_right[channel] = voice->vc_PanMultRight;
  }

  for (sample = 0; sample < samples; sample++) {
    int64_t left = 0;
    int64_t right = 0;
    for (channel = 0; channel < channels; channel++) {
      int64_t voice_sample;
      if (position[channel] >= LZ_WAVE_POSITION_LIMIT) {
        position[channel] -= LZ_WAVE_POSITION_LIMIT;
      }
      voice_sample = lz_interpolated_sample(ctx, source[channel], position[channel]);
      if (ring_source[channel]) {
        int32_t modulator;
        if (ring_position[channel] >= LZ_WAVE_POSITION_LIMIT) {
          ring_position[channel] -= LZ_WAVE_POSITION_LIMIT;
        }
        modulator = lz_interpolated_sample(ctx, ring_source[channel], ring_position[channel]);
        voice_sample = (voice_sample * modulator) >> 15;
        ring_position[channel] += ring_delta[channel];
      }
      voice_sample *= volume[channel];
      left += (voice_sample * pan_left[channel]) >> 7;
      right += (voice_sample * pan_right[channel]) >> 7;
      position[channel] += delta[channel];
    }
    left = ((left * ctx->tune->ht_mixgain) >> 8) >> 8;
    right = ((right * ctx->tune->ht_mixgain) >> 8) >> 8;
    if (left < -0x8000) {
      left = -0x8000;
    }
    if (left > 0x7fff) {
      left = 0x7fff;
    }
    if (right < -0x8000) {
      right = -0x8000;
    }
    if (right > 0x7fff) {
      right = 0x7fff;
    }
    *(int16_t *)left_buffer = (int16_t)left;
    *(int16_t *)right_buffer = (int16_t)right;
    left_buffer += buffer_stride;
    right_buffer += buffer_stride;
  }

  for (channel = 0; channel < channels; channel++) {
    ctx->tune->ht_Voices[channel].vc_SamplePos = position[channel];
    ctx->tune->ht_Voices[channel].vc_RingSamplePos = ring_position[channel];
  }
}

/* One 1/50 s frame into the context mix buffer; returns 0 at song end. */
static int lz_decode_frame(lz_hively_ctx *ctx) {
  uint32_t samples;
  uint32_t loops;
  int8_t *left;
  int8_t *right;
  if (!ctx->tune || ctx->tune->ht_SongEndReached) {
    return 0;
  }
  samples = ctx->sample_rate / LZ_FRAMES_PER_SECOND /
            (uint32_t)ctx->tune->ht_SpeedMultiplier;
  loops = ctx->tune->ht_SpeedMultiplier;
  left = ctx->mix_buffer;
  right = &ctx->mix_buffer[2];
  do {
    hvl_play_irq(ctx->tune);
    if (ctx->interpolation_taps == 1) {
      int32_t volumes[MAX_CHANNELS];
      uint32_t channel;
      for (channel = 0; channel < (uint32_t)ctx->tune->ht_Channels; channel++) {
        volumes[channel] = ctx->tune->ht_Voices[channel].vc_VoiceVolume;
        if (ctx->channel_muted[channel]) {
          ctx->tune->ht_Voices[channel].vc_VoiceVolume = 0;
        }
      }
      hvl_mixchunk(ctx->tune, samples, left, right, 4);
      for (channel = 0; channel < (uint32_t)ctx->tune->ht_Channels; channel++) {
        ctx->tune->ht_Voices[channel].vc_VoiceVolume = volumes[channel];
      }
    } else {
      lz_mix_interpolated_chunk(ctx, samples, left, right, 4);
    }
    left += samples * 4;
    right += samples * 4;
    loops--;
  } while (loops);
  ctx->display_order = (uint32_t)ctx->tune->ht_PosNr;
  ctx->display_row = (uint32_t)ctx->tune->ht_NoteNr;
  ctx->current_frame++;
  return 1;
}

static void lz_write_error(char *errbuf, size_t errlen, const char *kind) {
  if (errbuf && errlen > 0) {
    strncpy(errbuf, kind, errlen - 1);
    errbuf[errlen - 1] = '\0';
  }
}

lz_hively_ctx *lz_hively_open(const uint8_t *data, uint32_t length,
                              uint32_t sample_rate, char *errbuf,
                              size_t errlen) {
  lz_hively_ctx *ctx;
  if (!data || length < 14 || length > LZ_MAX_SOURCE_BYTES ||
      sample_rate < 8000 || sample_rate > 192000) {
    lz_write_error(errbuf, errlen, "unsupported");
    return NULL;
  }
  if (!((data[0] == 'T' && data[1] == 'H' && data[2] == 'X') ||
        (data[0] == 'H' && data[1] == 'V' && data[2] == 'L'))) {
    lz_write_error(errbuf, errlen, "unsupported");
    return NULL;
  }
  ctx = calloc(1, sizeof(*ctx));
  if (!ctx) {
    lz_write_error(errbuf, errlen, "resource");
    return NULL;
  }
  ctx->file_data = malloc(length);
  if (!ctx->file_data) {
    free(ctx);
    lz_write_error(errbuf, errlen, "resource");
    return NULL;
  }
  memcpy(ctx->file_data, data, length);
  ctx->file_length = length;
  ctx->sample_rate = sample_rate;
  ctx->frame_samples = sample_rate / LZ_FRAMES_PER_SECOND;
  ctx->mix_buffer = malloc(ctx->frame_samples * 4);
  if (!ctx->mix_buffer) {
    free(ctx->file_data);
    free(ctx);
    lz_write_error(errbuf, errlen, "resource");
    return NULL;
  }
  ctx->spill = malloc(ctx->frame_samples * 2 * sizeof(float));
  if (!ctx->spill) {
    free(ctx->mix_buffer);
    free(ctx->file_data);
    free(ctx);
    lz_write_error(errbuf, errlen, "resource");
    return NULL;
  }
  ctx->tune = hvl_reset(ctx->file_data, ctx->file_length, 2, sample_rate, 0);
  if (!ctx->tune) {
    free(ctx->spill);
    free(ctx->mix_buffer);
    free(ctx->file_data);
    free(ctx);
    lz_write_error(errbuf, errlen, "corrupt");
    return NULL;
  }
  ctx->probe = hvl_reset(ctx->file_data, ctx->file_length, 2, sample_rate, 0);
  if (!ctx->probe) {
    hvl_FreeTune(ctx->tune);
    free(ctx->spill);
    free(ctx->mix_buffer);
    free(ctx->file_data);
    free(ctx);
    lz_write_error(errbuf, errlen, "resource");
    return NULL;
  }
  ctx->interpolation_taps = 1;
  ctx->subsong = 0;
  if (!hvl_InitSubsong(ctx->tune, 0) || !hvl_InitSubsong(ctx->probe, 0)) {
    hvl_FreeTune(ctx->probe);
    hvl_FreeTune(ctx->tune);
    free(ctx->spill);
    free(ctx->mix_buffer);
    free(ctx->file_data);
    free(ctx);
    lz_write_error(errbuf, errlen, "corrupt");
    return NULL;
  }
  ctx->display_order = (uint32_t)ctx->tune->ht_PosNr;
  ctx->display_row = (uint32_t)ctx->tune->ht_NoteNr;
  return ctx;
}

void lz_hively_close(lz_hively_ctx *ctx) {
  if (!ctx) {
    return;
  }
  if (ctx->probe) {
    hvl_FreeTune(ctx->probe);
  }
  if (ctx->tune) {
    hvl_FreeTune(ctx->tune);
  }
  free(ctx->spill);
  free(ctx->mix_buffer);
  free(ctx->file_data);
  free(ctx);
}

uint32_t lz_hively_subsong_count(const lz_hively_ctx *ctx) {
  if (!ctx || !ctx->tune) {
    return 0;
  }
  return (uint32_t)ctx->tune->ht_SubsongNr + 1;
}

uint32_t lz_hively_channel_count(const lz_hively_ctx *ctx) {
  if (!ctx || !ctx->tune) {
    return 0;
  }
  return (uint32_t)ctx->tune->ht_Channels;
}

uint32_t lz_hively_frame_samples(const lz_hively_ctx *ctx) {
  return ctx ? ctx->frame_samples : 0;
}

const char *lz_hively_title(const lz_hively_ctx *ctx, uint32_t *len) {
  static const char empty = '\0';
  if (!ctx || !ctx->tune) {
    if (len) {
      *len = 0;
    }
    return &empty;
  }
  if (len) {
    *len = 128;
  }
  return ctx->tune->ht_Name;
}

uint32_t lz_hively_order(const lz_hively_ctx *ctx) {
  return ctx ? ctx->display_order : 0;
}

uint32_t lz_hively_row(const lz_hively_ctx *ctx) {
  return ctx ? ctx->display_row : 0;
}

int lz_hively_select_subsong(lz_hively_ctx *ctx, uint32_t subsong) {
  if (!ctx || !ctx->tune || !ctx->probe) {
    return 0;
  }
  if (!hvl_InitSubsong(ctx->tune, subsong) ||
      !hvl_InitSubsong(ctx->probe, subsong)) {
    return 0;
  }
  ctx->subsong = subsong;
  ctx->current_frame = 0;
  ctx->spill_frames = 0;
  ctx->probed_frames = 0;
  ctx->probe_ended = 0;
  ctx->display_order = (uint32_t)ctx->tune->ht_PosNr;
  ctx->display_row = (uint32_t)ctx->tune->ht_NoteNr;
  return 1;
}

int lz_hively_probe_step(lz_hively_ctx *ctx, uint32_t max_frames,
                         uint32_t *out_rendered, int *out_ended,
                         uint32_t *out_duration) {
  uint32_t rendered = 0;
  if (!ctx || !ctx->probe) {
    return 0;
  }
  while (rendered < max_frames && !ctx->probe->ht_SongEndReached &&
         ctx->probed_frames < LZ_HIVELY_MAX_DURATION_FRAMES) {
    hvl_DecodeFrame(ctx->probe, ctx->mix_buffer, &ctx->mix_buffer[2], 4);
    rendered++;
    ctx->probed_frames++;
  }
  if (out_rendered) {
    *out_rendered = rendered;
  }
  ctx->probe_ended = ctx->probe->ht_SongEndReached ? 1 : 0;
  if (out_ended) {
    *out_ended = ctx->probe_ended;
  }
  if (out_duration) {
    *out_duration = ctx->probed_frames;
  }
  return 1;
}

int lz_hively_seek_step(lz_hively_ctx *ctx, uint32_t target_frame,
                        uint32_t max_discard, uint32_t *out_position) {
  uint32_t budget = max_discard;
  uint32_t duration_frames;
  if (!ctx || !ctx->tune) {
    return 0;
  }
  duration_frames = ctx->probe_ended
    ? ctx->probed_frames
    : LZ_HIVELY_MAX_DURATION_FRAMES;
  if (target_frame > duration_frames) {
    target_frame = duration_frames;
  }
  if (target_frame < ctx->current_frame) {
    if (!hvl_InitSubsong(ctx->tune, ctx->subsong)) {
      return 0;
    }
    ctx->current_frame = 0;
    ctx->spill_frames = 0;
  }
  while (ctx->current_frame < target_frame && budget > 0 &&
         !ctx->tune->ht_SongEndReached) {
    /* Bounded forward render; the mix buffer is scratch here. */
    uint32_t samples = ctx->sample_rate / LZ_FRAMES_PER_SECOND /
                       (uint32_t)ctx->tune->ht_SpeedMultiplier;
    uint32_t loops = ctx->tune->ht_SpeedMultiplier;
    int8_t *left = ctx->mix_buffer;
    int8_t *right = &ctx->mix_buffer[2];
    do {
      hvl_play_irq(ctx->tune);
      hvl_mixchunk(ctx->tune, samples, left, right, 4);
      left += samples * 4;
      right += samples * 4;
      loops--;
    } while (loops);
    ctx->current_frame++;
    budget--;
  }
  ctx->display_order = (uint32_t)ctx->tune->ht_PosNr;
  ctx->display_row = (uint32_t)ctx->tune->ht_NoteNr;
  if (out_position) {
    *out_position = ctx->current_frame;
  }
  return 1;
}

uint32_t lz_hively_render_float(lz_hively_ctx *ctx, float *out,
                                uint32_t frames) {
  uint32_t rendered = 0;
  if (!ctx || !out) {
    return 0;
  }
  /* Leftover sub-frame spill from the previous call first. */
  if (ctx->spill_frames > 0) {
    uint32_t take = ctx->spill_frames < frames ? ctx->spill_frames : frames;
    memcpy(out, ctx->spill, take * 2 * sizeof(float));
    if (take < ctx->spill_frames) {
      memmove(ctx->spill, ctx->spill + take * 2,
              (ctx->spill_frames - take) * 2 * sizeof(float));
    }
    ctx->spill_frames -= take;
    rendered += take;
  }
  while (rendered < frames) {
    uint32_t want = frames - rendered;
    uint32_t got = 0;
    /* Whole Hively frames; any remainder spills for the next call. */
    while (got + ctx->frame_samples <= want) {
      if (!lz_decode_frame(ctx)) {
        break;
      }
      {
        const int16_t *mix = (const int16_t *)ctx->mix_buffer;
        uint32_t i;
        for (i = 0; i < ctx->frame_samples; i++) {
          out[(rendered + got + i) * 2] = mix[i * 2] / 32768.0f;
          out[(rendered + got + i) * 2 + 1] = mix[i * 2 + 1] / 32768.0f;
        }
      }
      got += ctx->frame_samples;
    }
    if (got == 0) {
      if (want > 0 && !lz_hively_ended(ctx)) {
        /* Sub-frame remainder: decode one frame, keep the spill. */
        if (!lz_decode_frame(ctx)) {
          break;
        }
        {
          const int16_t *mix = (const int16_t *)ctx->mix_buffer;
          uint32_t i;
          for (i = 0; i < ctx->frame_samples; i++) {
            ctx->spill[i * 2] = mix[i * 2] / 32768.0f;
            ctx->spill[i * 2 + 1] = mix[i * 2 + 1] / 32768.0f;
          }
        }
        {
          uint32_t take = want < ctx->frame_samples ? want : ctx->frame_samples;
          memcpy(out + rendered * 2, ctx->spill, take * 2 * sizeof(float));
          if (take < ctx->frame_samples) {
            memmove(ctx->spill, ctx->spill + take * 2,
                    (ctx->frame_samples - take) * 2 * sizeof(float));
            ctx->spill_frames = ctx->frame_samples - take;
          }
          rendered += take;
        }
      }
      break;
    }
    rendered += got;
  }
  return rendered;
}

uint32_t lz_hively_position_samples(const lz_hively_ctx *ctx) {
  if (!ctx) {
    return 0;
  }
  return ctx->current_frame * ctx->frame_samples;
}

uint32_t lz_hively_spill_frames(const lz_hively_ctx *ctx) {
  return ctx ? ctx->spill_frames : 0;
}

int lz_hively_ended(const lz_hively_ctx *ctx) {
  if (!ctx || !ctx->tune) {
    return 1;
  }
  return ctx->tune->ht_SongEndReached ? 1 : 0;
}

uint32_t lz_hively_duration_samples(const lz_hively_ctx *ctx) {
  if (!ctx || !ctx->probe_ended) {
    return 0;
  }
  return ctx->probed_frames * ctx->frame_samples;
}

int lz_hively_set_channel_mute(lz_hively_ctx *ctx, uint32_t channel,
                               int muted) {
  if (!ctx || !ctx->tune || channel >= (uint32_t)ctx->tune->ht_Channels ||
      channel >= MAX_CHANNELS) {
    return 0;
  }
  ctx->channel_muted[channel] = muted ? 1 : 0;
  return 1;
}

int lz_hively_channel_mute(const lz_hively_ctx *ctx, uint32_t channel) {
  if (!ctx || !ctx->tune || channel >= (uint32_t)ctx->tune->ht_Channels ||
      channel >= MAX_CHANNELS) {
    return -1;
  }
  return ctx->channel_muted[channel] ? 1 : 0;
}

uint32_t lz_hively_subsong(const lz_hively_ctx *ctx) {
  return ctx ? ctx->subsong : 0;
}

void lz_hively_set_interpolation(lz_hively_ctx *ctx, uint32_t taps) {
  if (!ctx) {
    return;
  }
  ctx->interpolation_taps =
    (taps == 2 || taps == 4 || taps == 8) ? taps : 1;
}
