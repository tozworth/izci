const MIN_AUDIBLE_VOLUME_DB = -60;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function sliderVolumeToGain(volume: number, logarithmicVolume: boolean): number {
  const normalized = clamp(volume, 0, 1);

  if (!logarithmicVolume) {
    return normalized;
  }

  if (normalized === 0) {
    return 0;
  }

  return 10 ** ((MIN_AUDIBLE_VOLUME_DB * (1 - normalized)) / 20);
}
