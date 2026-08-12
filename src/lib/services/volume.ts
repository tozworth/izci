import type { ReplayGainMetadata } from '$lib/contracts/media-metadata';
import type { ReplayGainMode } from '$lib/contracts/playback';

const MIN_AUDIBLE_VOLUME_DB = -60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

export function sliderVolumeToGain(volume: number, logarithmicVolume: boolean): number {
  const normalized = clamp(volume, 0, 1);

  if (!logarithmicVolume) {
    return normalized;
  }

  if (normalized === 0) {
    return 0;
  }

  return decibelsToGain(MIN_AUDIBLE_VOLUME_DB * (1 - normalized));
}

function resolveReplayGain(
  replayGain: ReplayGainMetadata | undefined,
  mode: ReplayGainMode
): { gainDb: number; peak?: number } | null {
  if (!replayGain || mode === 'off') {
    return null;
  }

  if (mode === 'album') {
    const gainDb = replayGain.albumGainDb ?? replayGain.trackGainDb;
    return typeof gainDb === 'number' ? { gainDb, peak: replayGain.albumPeak ?? replayGain.trackPeak } : null;
  }

  const gainDb = replayGain.trackGainDb ?? replayGain.albumGainDb;
  return typeof gainDb === 'number' ? { gainDb, peak: replayGain.trackPeak ?? replayGain.albumPeak } : null;
}

export function applyReplayGain(
  gain: number,
  replayGain: ReplayGainMetadata | undefined,
  mode: ReplayGainMode
): number {
  const normalizedGain = clamp(gain, 0, 1);
  const replayGainValue = resolveReplayGain(replayGain, mode);

  if (!replayGainValue) {
    return normalizedGain;
  }

  let replayGainMultiplier = decibelsToGain(replayGainValue.gainDb);
  const peak = replayGainValue.peak;

  if (typeof peak === 'number' && peak > 0 && peak * replayGainMultiplier > 1) {
    replayGainMultiplier = 1 / peak;
  }

  return clamp(normalizedGain * replayGainMultiplier, 0, 1);
}
