// Per-voice de-clicking. Included after interpolated_sample in ahx-wrapper.c.
// No allocations, output filtering, or changes to the tracker's own envelopes.
struct ahx_voice_ramp {
  double left, right, target_left, target_right, step_left, step_right;
  double offset, offset_step;
  int32_t before;
  uint32_t gain_remaining, offset_remaining;
  int primed;
};

static struct ahx_voice_ramp voice_ramps[MAX_CHANNELS];
static double ramping_ms = 0.0;

static void reset_voice_ramps(void) {
  memset(voice_ramps, 0, sizeof(voice_ramps));
}

static int32_t voice_sample_at_boundary(const struct hvl_voice *voice) {
  int64_t value = interpolated_sample(
    voice->vc_MixSource, voice->vc_SamplePos % AHX_WAVE_POSITION_LIMIT
  );
  if (voice->vc_RingMixSource) {
    value = (value * interpolated_sample(
      voice->vc_RingMixSource, voice->vc_RingSamplePos % AHX_WAVE_POSITION_LIMIT
    )) >> 15;
    if (interpolation_filter == 1) value = (value >> 8) * 256;
  }
  return (int32_t)value;
}

static void prepare_voice_ramps(const struct hvl_tune *active_tune) {
  uint32_t channel;
  if (ramping_ms == 0.0) return;
  // Capture the next old-wave sample BEFORE the replay IRQ overwrites its
  // waveform buffers in place. A source pointer alone cannot detect this.
  for (channel = 0; channel < active_tune->ht_Channels; channel++) {
    const struct hvl_voice *voice = &active_tune->ht_Voices[channel];
    struct ahx_voice_ramp *ramp = &voice_ramps[channel];
    ramp->before = voice_sample_at_boundary(voice);
    if (!ramp->primed) {
      const double volume = channel_muted[channel] ? 0 : voice->vc_VoiceVolume;
      ramp->left = ramp->target_left = volume * voice->vc_PanMultLeft / 128.0;
      ramp->right = ramp->target_right = volume * voice->vc_PanMultRight / 128.0;
      ramp->primed = 1;
    }
  }
}

static void begin_voice_ramps(const struct hvl_tune *active_tune) {
  uint32_t channel;
  uint32_t length;
  if (ramping_ms == 0.0) return;
  length = (uint32_t)lround(active_tune->ht_Frequency * ramping_ms / 1000.0);
  if (!length) length = 1;
  for (channel = 0; channel < active_tune->ht_Channels; channel++) {
    const struct hvl_voice *voice = &active_tune->ht_Voices[channel];
    struct ahx_voice_ramp *ramp = &voice_ramps[channel];
    const double volume = channel_muted[channel] ? 0 : voice->vc_VoiceVolume;
    const double left = volume * voice->vc_PanMultLeft / 128.0;
    const double right = volume * voice->vc_PanMultRight / 128.0;
    const int32_t jump = ramp->before - voice_sample_at_boundary(voice);
    if (left != ramp->target_left || right != ramp->target_right) {
      ramp->target_left = left;
      ramp->target_right = right;
      ramp->step_left = (left - ramp->left) / length;
      ramp->step_right = (right - ramp->right) / length;
      ramp->gain_remaining = length;
    }
    if (jump) {
      // Cancel just the new discontinuity, then decay the correction. Carry
      // any unfinished correction so rapid ticks always start continuously.
      ramp->offset += jump;
      ramp->offset_step = ramp->offset / length;
      ramp->offset_remaining = length;
    }
  }
}

static void advance_voice_ramp(struct ahx_voice_ramp *ramp) {
  if (ramp->gain_remaining) {
    ramp->left += ramp->step_left;
    ramp->right += ramp->step_right;
    if (!--ramp->gain_remaining) {
      ramp->left = ramp->target_left;
      ramp->right = ramp->target_right;
    }
  }
  if (ramp->offset_remaining) {
    ramp->offset -= ramp->offset_step;
    if (!--ramp->offset_remaining) ramp->offset = 0.0;
  }
}

void ahx_set_ramping(double milliseconds) {
  if (!isfinite(milliseconds)) milliseconds = 5.0;
  if (milliseconds < 0.0) milliseconds = 0.0;
  if (milliseconds > 40.0) milliseconds = 40.0;
  if (milliseconds == 0.0 || ramping_ms == 0.0) reset_voice_ramps();
  ramping_ms = milliseconds;
}
