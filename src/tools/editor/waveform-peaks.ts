import { yieldEditorTask } from './editor-task';

export const WAVEFORM_BASE_BUCKET = 256;

interface WaveformPeakLevel {
  minimum: Float32Array;
  maximum: Float32Array;
}

interface WaveformChannelPeaks {
  samples: Float32Array;
  length: number;
  readSamples?: () => Float32Array;
  levels: WaveformPeakLevel[];
}

export interface WaveformPeakPyramid {
  length: number;
  channels: WaveformChannelPeaks[];
}

export interface WaveformPeak {
  minimum: number;
  maximum: number;
}

function createLevel(length: number): WaveformPeakLevel {
  return { minimum: new Float32Array(length), maximum: new Float32Array(length) };
}

/** Compact exact min/max levels; no per-bucket objects or sparse sample-sized arrays. */
function* buildChannel(samples: Float32Array, readSamples?: () => Float32Array): Generator<void, WaveformChannelPeaks> {
  const length = samples.length;
  const levels: WaveformPeakLevel[] = [];
  let level = createLevel(Math.ceil(length / WAVEFORM_BASE_BUCKET));
  levels.push(level);
  for (let bucket = 0; bucket < level.minimum.length; bucket += 1) {
    const start = bucket * WAVEFORM_BASE_BUCKET;
    // AudioBufferSource.start can detach getChannelData views while this job is
    // yielding. Reacquire only when necessary; never retain a dead PCM view.
    if (samples.length !== length && readSamples) samples = readSamples();
    const end = Math.min(length, start + WAVEFORM_BASE_BUCKET);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let frame = start; frame < end; frame += 1) {
      const value = samples[frame];
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    level.minimum[bucket] = minimum === Infinity ? 0 : minimum;
    level.maximum[bucket] = maximum === -Infinity ? 0 : maximum;
    if ((bucket & 255) === 255) yield;
  }
  while (level.minimum.length > 1) {
    const next = createLevel(Math.ceil(level.minimum.length / 2));
    for (let bucket = 0; bucket < next.minimum.length; bucket += 1) {
      const left = bucket * 2;
      const right = Math.min(left + 1, level.minimum.length - 1);
      next.minimum[bucket] = Math.min(level.minimum[left], level.minimum[right]);
      next.maximum[bucket] = Math.max(level.maximum[left], level.maximum[right]);
      if ((bucket & 4095) === 4095) yield;
    }
    levels.push(next);
    level = next;
  }
  return { samples, length, levels, readSamples };
}

export function buildWaveformPeakPyramid(channels: readonly Float32Array[]): WaveformPeakPyramid {
  return {
    length: channels[0]?.length ?? 0,
    channels: channels.map((samples) => {
      const builder = buildChannel(samples);
      let result = builder.next();
      while (!result.done) result = builder.next();
      return result.value;
    })
  };
}

/** Prepare once, in small input-friendly tasks; never clone/transfer the full PCM. */
export async function prepareWaveformPeakPyramid(
  channels: readonly Float32Array[],
  signal?: AbortSignal,
  readers?: readonly (() => Float32Array)[]
): Promise<WaveformPeakPyramid> {
  const prepared: WaveformChannelPeaks[] = [];
  const length = channels[0]?.length ?? 0;
  await yieldEditorTask(signal);
  let deadline = performance.now() + 4;
  for (let index = 0; index < channels.length; index += 1) {
    const builder = buildChannel(readers?.[index]?.() ?? channels[index], readers?.[index]);
    let result = builder.next();
    while (!result.done) {
      signal?.throwIfAborted();
      if (performance.now() >= deadline) {
        await yieldEditorTask(signal);
        deadline = performance.now() + 4;
      }
      result = builder.next();
    }
    prepared.push(result.value);
  }
  signal?.throwIfAborted();
  return { length, channels: prepared };
}

export function waveformPeakBucketSize(samplesPerPixel: number): number {
  if (!Number.isFinite(samplesPerPixel) || samplesPerPixel <= 1) return 1;
  return 2 ** Math.floor(Math.log2(samplesPerPixel));
}

/** Exact interval query, including peaks at edit joins and partial terminal buckets. */
export function waveformPeakRange(
  pyramid: WaveformPeakPyramid,
  channelIndex: number,
  start: number,
  end: number,
  result: WaveformPeak = { minimum: 0, maximum: 0 }
): WaveformPeak {
  const channel = pyramid.channels[channelIndex];
  if (!channel) { result.minimum = result.maximum = 0; return result; }
  let frame = Math.max(0, Math.floor(start));
  const last = Math.min(channel.length, Math.ceil(end));
  let minimum = Infinity;
  let maximum = -Infinity;
  while (frame < last) {
    if (frame % WAVEFORM_BASE_BUCKET === 0 && last - frame >= WAVEFORM_BASE_BUCKET) {
      const baseIndex = frame / WAVEFORM_BASE_BUCKET;
      const available = Math.floor(Math.log2((last - frame) / WAVEFORM_BASE_BUCKET));
      const alignment = baseIndex === 0 ? available : 31 - Math.clz32((baseIndex & -baseIndex) >>> 0);
      const levelIndex = Math.min(available, alignment, channel.levels.length - 1);
      const level = channel.levels[levelIndex];
      const bucket = Math.floor(baseIndex / 2 ** levelIndex);
      minimum = Math.min(minimum, level.minimum[bucket]);
      maximum = Math.max(maximum, level.maximum[bucket]);
      frame += WAVEFORM_BASE_BUCKET * 2 ** levelIndex;
    } else {
      if (channel.samples.length !== channel.length && channel.readSamples) channel.samples = channel.readSamples();
      const samples = channel.samples;
      const stop = Math.min(last, frame + WAVEFORM_BASE_BUCKET - frame % WAVEFORM_BASE_BUCKET);
      while (frame < stop) {
        const value = samples[frame++];
        if (value < minimum) minimum = value;
        if (value > maximum) maximum = value;
      }
    }
  }
  result.minimum = minimum === Infinity ? 0 : minimum;
  result.maximum = maximum === -Infinity ? 0 : maximum;
  return result;
}

export function waveformPeakAt(
  pyramid: WaveformPeakPyramid,
  channelIndex: number,
  bucketStart: number,
  bucketSize: number,
  result?: WaveformPeak
): WaveformPeak {
  const size = waveformPeakBucketSize(bucketSize);
  const start = Math.max(0, Math.floor(bucketStart / size) * size);
  return waveformPeakRange(pyramid, channelIndex, start, start + size, result);
}
