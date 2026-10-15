#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "types.h"
#include "replay.h"

#define AHX_FRAMES_PER_SECOND 50
#define AHX_MAX_DURATION_FRAMES (30 * 60 * AHX_FRAMES_PER_SECOND)
#define AHX_WAVE_SAMPLES 0x280
#define AHX_WAVE_POSITION_LIMIT (AHX_WAVE_SAMPLES << 16)
#define AHX_INTERPOLATION_PHASES 256
#define AHX_INTERPOLATION_COEFFICIENT_SCALE 16384
#define AHX_MIN_PLAYBACK_FACTOR 0.25
#define AHX_MAX_PLAYBACK_FACTOR 4.0

extern void hvl_play_irq(struct hvl_tune *tune);
extern void hvl_mixchunk(struct hvl_tune *tune, uint32_t samples, int8_t *left, int8_t *right, int32_t stride);

static struct hvl_tune *tune = NULL;
static uint8_t *file_data = NULL;
static int8_t *mix_buffer = NULL;
static uint32_t file_length = 0;
static uint32_t mix_frequency = 0;
static uint32_t mix_frame_samples = 0;
static uint32_t current_frame = 0;
static uint32_t duration_frames = 0;
static uint32_t active_subsong = 0;
static uint32_t display_order = 0;
static uint32_t display_row = 0;
static uint32_t interpolation_filter = 1;
static double tempo_factor = 1.0;
static double pitch_factor = 1.0;
static double sample_remainder = 0.0;
static uint8_t channel_muted[MAX_CHANNELS];
static int32_t interpolation_4tap[AHX_INTERPOLATION_PHASES][4];
static int32_t interpolation_8tap[AHX_INTERPOLATION_PHASES][8];
static int initialized = 0;

static double normalized_sinc(double value) {
  const double pi = 3.14159265358979323846;
  if (fabs(value) < 0.0000001) return 1.0;
  return sin(pi * value) / (pi * value);
}

static void initialize_interpolation_tables(void) {
  uint32_t phase;
  for (phase = 0; phase < AHX_INTERPOLATION_PHASES; phase++) {
    const double fraction = (double)phase / AHX_INTERPOLATION_PHASES;
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
      interpolation_4tap[phase][tap] =
        (int32_t)lround(cubic[tap] * AHX_INTERPOLATION_COEFFICIENT_SCALE);
      cubic_sum += interpolation_4tap[phase][tap];
    }
    interpolation_4tap[phase][1] += AHX_INTERPOLATION_COEFFICIENT_SCALE - cubic_sum;

    {
      double lanczos[8];
      double lanczos_sum = 0.0;
      int32_t fixed_sum = 0;
      for (tap = 0; tap < 8; tap++) {
        const double distance = fraction - ((int32_t)tap - 3);
        lanczos[tap] = normalized_sinc(distance) * normalized_sinc(distance / 4.0);
        lanczos_sum += lanczos[tap];
      }
      for (tap = 0; tap < 8; tap++) {
        interpolation_8tap[phase][tap] =
          (int32_t)lround(
            lanczos[tap] * AHX_INTERPOLATION_COEFFICIENT_SCALE / lanczos_sum
          );
        fixed_sum += interpolation_8tap[phase][tap];
      }
      interpolation_8tap[phase][3] += AHX_INTERPOLATION_COEFFICIENT_SCALE - fixed_sum;
    }
  }
}

static uint32_t wrap_sample_index(int32_t index) {
  if (index < 0) return (uint32_t)(index + AHX_WAVE_SAMPLES);
  if (index >= AHX_WAVE_SAMPLES) return (uint32_t)(index - AHX_WAVE_SAMPLES);
  return (uint32_t)index;
}

static int32_t interpolated_sample(const int8_t *source, uint32_t position) {
  const int32_t index = (int32_t)(position >> 16);
  const uint32_t phase = (position >> 8) & 0xff;

  if (interpolation_filter == 1) return source[index] * 256;

  if (interpolation_filter == 2) {
    const int32_t current = source[index];
    const int32_t next = source[wrap_sample_index(index + 1)];
    return current * (AHX_INTERPOLATION_PHASES - phase) + next * phase;
  }

  if (interpolation_filter == 4) {
    int32_t value = 0;
    uint32_t tap;
    for (tap = 0; tap < 4; tap++) {
      value += source[wrap_sample_index(index + (int32_t)tap - 1)] *
        interpolation_4tap[phase][tap];
    }
    return value / (AHX_INTERPOLATION_COEFFICIENT_SCALE >> 8);
  }

  {
    int32_t value = 0;
    uint32_t tap;
    for (tap = 0; tap < 8; tap++) {
      value += source[wrap_sample_index(index + (int32_t)tap - 3)] *
        interpolation_8tap[phase][tap];
    }
    return value / (AHX_INTERPOLATION_COEFFICIENT_SCALE >> 8);
  }
}

#include "ahx-ramping.h"

static void mix_interpolated_chunk(
  struct hvl_tune *active_tune,
  uint32_t samples,
  int8_t *left_buffer,
  int8_t *right_buffer,
  int32_t buffer_stride
) {
  const int8_t *source[MAX_CHANNELS];
  const int8_t *ring_source[MAX_CHANNELS];
  uint32_t delta[MAX_CHANNELS];
  uint32_t ring_delta[MAX_CHANNELS];
  int32_t volume[MAX_CHANNELS];
  uint32_t position[MAX_CHANNELS];
  uint32_t ring_position[MAX_CHANNELS];
  int32_t pan_left[MAX_CHANNELS];
  int32_t pan_right[MAX_CHANNELS];
  const uint32_t channels = active_tune->ht_Channels;
  uint32_t channel;
  uint32_t sample;

  for (channel = 0; channel < channels; channel++) {
    const struct hvl_voice *voice = &active_tune->ht_Voices[channel];
    source[channel] = voice->vc_MixSource;
    ring_source[channel] = voice->vc_RingMixSource;
    delta[channel] = voice->vc_Delta;
    ring_delta[channel] = voice->vc_RingDelta;
    volume[channel] = channel_muted[channel] ? 0 : voice->vc_VoiceVolume;
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
      if (position[channel] >= AHX_WAVE_POSITION_LIMIT) {
        position[channel] -= AHX_WAVE_POSITION_LIMIT;
      }
      voice_sample = interpolated_sample(source[channel], position[channel]);

      if (ring_source[channel]) {
        int32_t modulator;
        if (ring_position[channel] >= AHX_WAVE_POSITION_LIMIT) {
          ring_position[channel] -= AHX_WAVE_POSITION_LIMIT;
        }
        modulator = interpolated_sample(ring_source[channel], ring_position[channel]);
        voice_sample = (voice_sample * modulator) >> 15;
        if (interpolation_filter == 1) voice_sample = (voice_sample >> 8) * 256;
        ring_position[channel] += ring_delta[channel];
      }

      if (ramping_ms > 0.0) {
        struct ahx_voice_ramp *ramp = &voice_ramps[channel];
        const double smoothed = voice_sample + ramp->offset;
        left += (int64_t)floor(smoothed * ramp->left);
        right += (int64_t)floor(smoothed * ramp->right);
        advance_voice_ramp(ramp);
      } else {
        voice_sample *= volume[channel];
        left += (voice_sample * pan_left[channel]) >> 7;
        right += (voice_sample * pan_right[channel]) >> 7;
      }
      position[channel] += delta[channel];
    }

    left = ((left * active_tune->ht_mixgain) >> 8) >> 8;
    right = ((right * active_tune->ht_mixgain) >> 8) >> 8;
    if (left < -0x8000) left = -0x8000;
    if (left > 0x7fff) left = 0x7fff;
    if (right < -0x8000) right = -0x8000;
    if (right > 0x7fff) right = 0x7fff;

    *(int16_t *)left_buffer = (int16_t)left;
    *(int16_t *)right_buffer = (int16_t)right;
    left_buffer += buffer_stride;
    right_buffer += buffer_stride;
  }

  for (channel = 0; channel < channels; channel++) {
    active_tune->ht_Voices[channel].vc_SamplePos = position[channel];
    active_tune->ht_Voices[channel].vc_RingSamplePos = ring_position[channel];
  }
}

static uint32_t pitched_delta(uint32_t delta) {
  // Both mixers wrap once per sample and require a nonzero step.
  uint32_t scaled = (uint32_t)((double)delta * pitch_factor);
  scaled %= AHX_WAVE_POSITION_LIMIT;
  return scaled ? scaled : 1;
}

static void decode_audio_frame(struct hvl_tune *active_tune) {
  uint32_t loops = active_tune->ht_SpeedMultiplier;
  const double samples_per_tick = (double)active_tune->ht_Frequency /
    AHX_FRAMES_PER_SECOND / loops / tempo_factor;
  int8_t *left = mix_buffer;
  int8_t *right = &mix_buffer[2];
  mix_frame_samples = 0;

  do {
    uint32_t samples;
    uint32_t channel;
    uint32_t deltas[MAX_CHANNELS];
    uint32_t ring_deltas[MAX_CHANNELS];
    sample_remainder += samples_per_tick;
    samples = (uint32_t)sample_remainder;
    sample_remainder -= samples;
    prepare_voice_ramps(active_tune);
    hvl_play_irq(active_tune);
    begin_voice_ramps(active_tune);
    // Scale only the mixer steps; preserve the replayer's base tuning so
    // unchanged notes cannot compound the factor on subsequent ticks.
    for (channel = 0; channel < active_tune->ht_Channels; channel++) {
      struct hvl_voice *voice = &active_tune->ht_Voices[channel];
      deltas[channel] = voice->vc_Delta;
      ring_deltas[channel] = voice->vc_RingDelta;
      if (pitch_factor != 1.0) {
        voice->vc_Delta = pitched_delta(deltas[channel]);
        voice->vc_RingDelta = pitched_delta(ring_deltas[channel]);
      }
    }
    if (interpolation_filter == 1 && ramping_ms == 0.0) {
      int32_t volumes[MAX_CHANNELS];
      uint32_t channel;
      for (channel = 0; channel < active_tune->ht_Channels; channel++) {
        volumes[channel] = active_tune->ht_Voices[channel].vc_VoiceVolume;
        if (channel_muted[channel]) active_tune->ht_Voices[channel].vc_VoiceVolume = 0;
      }
      hvl_mixchunk(active_tune, samples, left, right, 4);
      for (channel = 0; channel < active_tune->ht_Channels; channel++) {
        active_tune->ht_Voices[channel].vc_VoiceVolume = volumes[channel];
      }
    } else {
      mix_interpolated_chunk(active_tune, samples, left, right, 4);
    }
    for (channel = 0; channel < active_tune->ht_Channels; channel++) {
      active_tune->ht_Voices[channel].vc_Delta = deltas[channel];
      active_tune->ht_Voices[channel].vc_RingDelta = ring_deltas[channel];
    }
    mix_frame_samples += samples;
    left += samples * 4;
    right += samples * 4;
    loops--;
  } while (loops);
}

static void release_tune(void) {
  if (tune) {
    hvl_FreeTune(tune);
    tune = NULL;
  }
  free(file_data);
  file_data = NULL;
  file_length = 0;
  free(mix_buffer);
  mix_buffer = NULL;
  mix_frequency = 0;
  mix_frame_samples = 0;
  current_frame = 0;
  duration_frames = 0;
  active_subsong = 0;
  display_order = 0;
  display_row = 0;
  tempo_factor = pitch_factor = 1.0;
  sample_remainder = 0.0;
  memset(channel_muted, 0, sizeof(channel_muted));
  reset_voice_ramps();
  ramping_ms = 0.0;
}

static uint32_t measure_duration(uint32_t subsong) {
  struct hvl_tune *probe = hvl_reset(file_data, file_length, 2, mix_frequency, 0);
  uint32_t frames = 0;
  if (!probe || !hvl_InitSubsong(probe, subsong)) {
    if (probe) hvl_FreeTune(probe);
    return 0;
  }

  while (!probe->ht_SongEndReached && frames < AHX_MAX_DURATION_FRAMES) {
    hvl_DecodeFrame(probe, mix_buffer, &mix_buffer[2], 4);
    frames++;
  }

  hvl_FreeTune(probe);
  return frames;
}

void ahx_init(void) {
  if (!initialized) {
    hvl_InitReplayer();
    initialize_interpolation_tables();
    initialized = 1;
  }
}

int ahx_load(const uint8_t *data, uint32_t length, uint32_t frequency, uint32_t stereo) {
  release_tune();
  ahx_init();
  if (!data || length < 14 || frequency < 8000 || frequency > 192000) return 0;

  file_data = malloc(length);
  if (!file_data) return 0;
  memcpy(file_data, data, length);
  file_length = length;
  mix_frequency = frequency;
  mix_frame_samples = frequency / AHX_FRAMES_PER_SECOND;
  // Reserve the slowest supported frame once, outside realtime rendering.
  mix_buffer = malloc((uint32_t)ceil(
    (double)frequency / AHX_FRAMES_PER_SECOND / AHX_MIN_PLAYBACK_FACTOR
  ) * 4);
  if (!mix_buffer) {
    release_tune();
    return 0;
  }

  if (stereo > 4) stereo = 4;
  tune = hvl_reset(file_data, file_length, stereo, mix_frequency, 0);
  if (!tune) {
    release_tune();
    return 0;
  }

  active_subsong = 0;
  duration_frames = measure_duration(active_subsong);
  hvl_InitSubsong(tune, active_subsong);
  display_order = tune->ht_PosNr;
  display_row = tune->ht_NoteNr;
  return 1;
}

void ahx_unload(void) { release_tune(); }

int ahx_select_subsong(uint32_t subsong) {
  if (!tune || !hvl_InitSubsong(tune, subsong)) return 0;
  active_subsong = subsong;
  current_frame = 0;
  sample_remainder = 0.0;
  duration_frames = measure_duration(subsong);
  hvl_InitSubsong(tune, subsong);
  reset_voice_ramps();
  display_order = tune->ht_PosNr;
  display_row = tune->ht_NoteNr;
  return 1;
}

int ahx_decode_frame(void) {
  if (!tune || !mix_buffer || tune->ht_SongEndReached) return 0;
  display_order = tune->ht_PosNr;
  display_row = tune->ht_NoteNr;
  decode_audio_frame(tune);
  current_frame++;
  return 1;
}

void ahx_set_interpolation(uint32_t taps) {
  interpolation_filter = taps == 2 || taps == 4 || taps == 8 ? taps : 1;
}

static double normalized_playback_factor(double factor) {
  if (!isfinite(factor)) return 1.0;
  if (factor < AHX_MIN_PLAYBACK_FACTOR) return AHX_MIN_PLAYBACK_FACTOR;
  if (factor > AHX_MAX_PLAYBACK_FACTOR) return AHX_MAX_PLAYBACK_FACTOR;
  return factor;
}

void ahx_set_playback_factors(double tempo, double pitch) {
  tempo_factor = normalized_playback_factor(tempo);
  pitch_factor = normalized_playback_factor(pitch);
}

void ahx_set_channel_mute(uint32_t channel, uint32_t muted) {
  if (!tune || channel >= tune->ht_Channels || channel >= MAX_CHANNELS) return;
  channel_muted[channel] = muted != 0;
}

void ahx_seek_frame(uint32_t target_frame) {
  if (!tune) return;
  if (duration_frames && target_frame > duration_frames) target_frame = duration_frames;
  hvl_InitSubsong(tune, active_subsong);
  reset_voice_ramps();
  current_frame = 0;
  sample_remainder = 0.0;
  while (current_frame < target_frame && !tune->ht_SongEndReached) {
    decode_audio_frame(tune);
    current_frame++;
  }
  display_order = tune->ht_PosNr;
  display_row = tune->ht_NoteNr;
}

int ahx_ended(void) { return tune ? tune->ht_SongEndReached : 1; }
uint32_t ahx_mix_buffer(void) { return (uint32_t)(uintptr_t)mix_buffer; }
uint32_t ahx_frame_samples(void) { return mix_frame_samples; }
uint32_t ahx_current_frame(void) { return current_frame; }
uint32_t ahx_duration_frames(void) { return duration_frames; }
uint32_t ahx_subsong_count(void) { return tune ? tune->ht_SubsongNr + 1 : 0; }
uint32_t ahx_channel_count(void) { return tune ? tune->ht_Channels : 0; }
uint32_t ahx_instrument_count(void) { return tune ? tune->ht_InstrumentNr : 0; }
uint32_t ahx_order_count(void) { return tune ? tune->ht_PositionNr : 0; }
uint32_t ahx_title(void) { return tune ? (uint32_t)(uintptr_t)tune->ht_Name : 0; }
uint32_t ahx_track_length(void) { return tune ? tune->ht_TrackLength : 0; }
uint32_t ahx_track_count(void) { return tune ? tune->ht_TrackNr + 1 : 0; }
uint32_t ahx_current_order(void) { return tune ? display_order : 0; }
uint32_t ahx_current_row(void) { return tune ? display_row : 0; }

int32_t ahx_position_track(uint32_t position, uint32_t channel) {
  if (!tune || position >= tune->ht_PositionNr || channel >= tune->ht_Channels) return -1;
  return tune->ht_Positions[position].pos_Track[channel];
}

int32_t ahx_position_transpose(uint32_t position, uint32_t channel) {
  if (!tune || position >= tune->ht_PositionNr || channel >= tune->ht_Channels) return 0;
  return tune->ht_Positions[position].pos_Transpose[channel];
}

static const struct hvl_step *find_step(uint32_t track, uint32_t row) {
  if (!tune || track > tune->ht_TrackNr || row >= tune->ht_TrackLength) return NULL;
  return &tune->ht_Tracks[track][row];
}

uint32_t ahx_step_note(uint32_t track, uint32_t row) {
  const struct hvl_step *step = find_step(track, row);
  return step ? step->stp_Note : 0;
}

uint32_t ahx_step_instrument(uint32_t track, uint32_t row) {
  const struct hvl_step *step = find_step(track, row);
  return step ? step->stp_Instrument : 0;
}

uint32_t ahx_step_effect(uint32_t track, uint32_t row) {
  const struct hvl_step *step = find_step(track, row);
  return step ? step->stp_FX : 0;
}

uint32_t ahx_step_effect_param(uint32_t track, uint32_t row) {
  const struct hvl_step *step = find_step(track, row);
  return step ? step->stp_FXParam : 0;
}

uint32_t ahx_instrument_name(uint32_t instrument) {
  if (!tune || instrument == 0 || instrument > tune->ht_InstrumentNr) return 0;
  return (uint32_t)(uintptr_t)tune->ht_Instruments[instrument].ins_Name;
}
