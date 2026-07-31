const MAX_SAMPLES_PER_BUCKET = 64;

interface WaveformChannelPeaks {
  samples: Float32Array;
  levels: Map<number, Array<WaveformPeak | undefined>>;
}

export interface WaveformPeakPyramid {
  length: number;
  channels: WaveformChannelPeaks[];
}

export interface WaveformPeak {
  minimum: number;
  maximum: number;
}

export function buildWaveformPeakPyramid(channels: readonly Float32Array[]): WaveformPeakPyramid {
  return {
    length: channels[0]?.length ?? 0,
    channels: channels.map((samples) => ({ samples, levels: new Map() }))
  };
}

export function waveformPeakBucketSize(samplesPerPixel: number): number {
  if (!Number.isFinite(samplesPerPixel) || samplesPerPixel <= 1) return 1;
  return 2 ** Math.floor(Math.log2(samplesPerPixel));
}

export function waveformPeakAt(
  pyramid: WaveformPeakPyramid,
  channelIndex: number,
  bucketStart: number,
  bucketSize: number
): WaveformPeak {
  const channel = pyramid.channels[channelIndex];
  if (!channel || pyramid.length === 0) return { minimum: 0, maximum: 0 };

  const safeSize = waveformPeakBucketSize(bucketSize);
  const safeStart = Math.max(0, Math.floor(bucketStart / safeSize) * safeSize);
  const block = Math.floor(safeStart / safeSize);
  let level = channel.levels.get(safeSize);
  if (!level) {
    level = [];
    channel.levels.set(safeSize, level);
  }
  const cached = level[block];
  if (cached) return cached;

  const end = Math.min(channel.samples.length, safeStart + safeSize);
  const stride = Math.max(1, Math.ceil((end - safeStart) / MAX_SAMPLES_PER_BUCKET));
  let minimum = 1;
  let maximum = -1;
  for (let index = safeStart; index < end; index += stride) {
    const sample = channel.samples[index] ?? 0;
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
  }
  if (end > safeStart) {
    const finalSample = channel.samples[end - 1] ?? 0;
    minimum = Math.min(minimum, finalSample);
    maximum = Math.max(maximum, finalSample);
  }
  const peak = minimum <= maximum ? { minimum, maximum } : { minimum: 0, maximum: 0 };
  level[block] = peak;
  return peak;
}
