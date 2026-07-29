#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "types.h"
#include "replay.h"

#define AHX_FRAMES_PER_SECOND 50
#define AHX_MAX_DURATION_FRAMES (30 * 60 * AHX_FRAMES_PER_SECOND)

static struct hvl_tune *tune = NULL;
static uint8_t *file_data = NULL;
static int8_t *mix_buffer = NULL;
static uint32_t file_length = 0;
static uint32_t mix_frequency = 0;
static uint32_t mix_frame_samples = 0;
static uint32_t current_frame = 0;
static uint32_t duration_frames = 0;
static uint32_t active_subsong = 0;
static int initialized = 0;

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
  mix_buffer = malloc(mix_frame_samples * 4);
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
  return 1;
}

void ahx_unload(void) { release_tune(); }

int ahx_select_subsong(uint32_t subsong) {
  if (!tune || !hvl_InitSubsong(tune, subsong)) return 0;
  active_subsong = subsong;
  current_frame = 0;
  duration_frames = measure_duration(subsong);
  hvl_InitSubsong(tune, subsong);
  return 1;
}

int ahx_decode_frame(void) {
  if (!tune || !mix_buffer || tune->ht_SongEndReached) return 0;
  hvl_DecodeFrame(tune, mix_buffer, &mix_buffer[2], 4);
  current_frame++;
  return 1;
}

void ahx_seek_frame(uint32_t target_frame) {
  if (!tune) return;
  if (duration_frames && target_frame > duration_frames) target_frame = duration_frames;
  hvl_InitSubsong(tune, active_subsong);
  current_frame = 0;
  while (current_frame < target_frame && !tune->ht_SongEndReached) {
    hvl_DecodeFrame(tune, mix_buffer, &mix_buffer[2], 4);
    current_frame++;
  }
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
