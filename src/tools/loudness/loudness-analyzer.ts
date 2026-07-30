import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

export const DEFAULT_REPLAYGAIN_TARGET_LUFS = -18;

export interface LoudnessProgress {
  seconds: number;
  duration: number | null;
}

export interface LoudnessAnalysis {
  integratedLufs: number;
  samplePeak: number;
  samplePeakDbfs: number;
  duration: number;
  channels: number;
  sampleRate: number;
  album?: string;
  albumArtist?: string;
  blockEnergies: number[];
}

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

class BiquadState {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly coefficients: BiquadCoefficients) {}

  process(value: number): number {
    const { b0, b1, b2, a1, a2 } = this.coefficients;
    const output = b0 * value + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = value;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }
}

function highShelfCoefficients(sampleRate: number): BiquadCoefficients {
  const frequency = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan(Math.PI * frequency / sampleRate);
  const vh = 10 ** (gainDb / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + vb * k / q + k * k) / a0,
    b1: 2 * (k * k - vh) / a0,
    b2: (vh - vb * k / q + k * k) / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / q + k * k) / a0
  };
}

function highPassCoefficients(sampleRate: number): BiquadCoefficients {
  const frequency = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan(Math.PI * frequency / sampleRate);
  const a0 = 1 + k / q + k * k;
  return {
    b0: 1 / a0,
    b1: -2 / a0,
    b2: 1 / a0,
    a1: 2 * (k * k - 1) / a0,
    a2: (1 - k / q + k * k) / a0
  };
}

function channelWeight(channel: number, channelCount: number): number {
  if (channelCount === 6) {
    if (channel === 3) return 0; // LFE
    if (channel >= 4) return 1.41;
  }
  return channelCount > 6 && channel >= channelCount - 2 ? 1.41 : 1;
}

export function loudnessFromEnergy(energy: number): number {
  return energy > 0 ? -0.691 + 10 * Math.log10(energy) : Number.NEGATIVE_INFINITY;
}

export function computeIntegratedLoudness(blockEnergies: readonly number[]): number {
  const absoluteGated = blockEnergies.filter((energy) => loudnessFromEnergy(energy) >= -70);
  if (absoluteGated.length === 0) return Number.NEGATIVE_INFINITY;
  const preliminaryEnergy = absoluteGated.reduce((sum, value) => sum + value, 0) / absoluteGated.length;
  const relativeThreshold = loudnessFromEnergy(preliminaryEnergy) - 10;
  const relativeGated = absoluteGated.filter((energy) => loudnessFromEnergy(energy) >= relativeThreshold);
  const integratedEnergy = relativeGated.reduce((sum, value) => sum + value, 0) / relativeGated.length;
  return loudnessFromEnergy(integratedEnergy);
}

class LoudnessAccumulator {
  readonly blockEnergies: number[] = [];
  samplePeak = 0;
  framesProcessed = 0;

  private readonly shelf: BiquadState[];
  private readonly highPass: BiquadState[];
  private readonly windowFrames: number;
  private readonly hopFrames: number;
  private readonly energyWindow: Float64Array;
  private energySum = 0;
  private windowPosition = 0;
  private windowFill = 0;
  private framesSinceBlock = 0;

  constructor(
    readonly sampleRate: number,
    readonly channelCount: number
  ) {
    this.shelf = Array.from({ length: channelCount }, () => new BiquadState(highShelfCoefficients(sampleRate)));
    this.highPass = Array.from({ length: channelCount }, () => new BiquadState(highPassCoefficients(sampleRate)));
    this.windowFrames = Math.max(1, Math.round(sampleRate * 0.4));
    this.hopFrames = Math.max(1, Math.round(sampleRate * 0.1));
    this.energyWindow = new Float64Array(this.windowFrames);
  }

  addBuffer(buffer: AudioBuffer): void {
    if (buffer.sampleRate !== this.sampleRate || buffer.numberOfChannels !== this.channelCount) {
      throw new Error('The audio stream changed its sample rate or channel layout during analysis.');
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    for (let frame = 0; frame < buffer.length; frame += 1) {
      let weightedEnergy = 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        const sample = channels[channel][frame] ?? 0;
        this.samplePeak = Math.max(this.samplePeak, Math.abs(sample));
        const filtered = this.highPass[channel].process(this.shelf[channel].process(sample));
        weightedEnergy += channelWeight(channel, channels.length) * filtered * filtered;
      }
      if (this.windowFill === this.windowFrames) this.energySum -= this.energyWindow[this.windowPosition];
      else this.windowFill += 1;
      this.energyWindow[this.windowPosition] = weightedEnergy;
      this.energySum += weightedEnergy;
      this.windowPosition = (this.windowPosition + 1) % this.windowFrames;
      this.framesProcessed += 1;
      this.framesSinceBlock += 1;
      if (this.windowFill === this.windowFrames && this.framesSinceBlock >= this.hopFrames) {
        this.blockEnergies.push(this.energySum / this.windowFrames);
        this.framesSinceBlock = 0;
      }
    }
  }

  finish(): LoudnessAnalysis {
    if (this.blockEnergies.length === 0 && this.windowFill > 0) {
      this.blockEnergies.push(this.energySum / this.windowFill);
    }
    return {
      integratedLufs: computeIntegratedLoudness(this.blockEnergies),
      samplePeak: this.samplePeak,
      samplePeakDbfs: this.samplePeak > 0 ? 20 * Math.log10(this.samplePeak) : Number.NEGATIVE_INFINITY,
      duration: this.framesProcessed / this.sampleRate,
      channels: this.channelCount,
      sampleRate: this.sampleRate,
      blockEnergies: [...this.blockEnergies]
    };
  }
}

export async function analyzeLoudness(
  file: File,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: LoudnessProgress) => void;
  } = {}
): Promise<LoudnessAnalysis> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const [track, metadata] = await Promise.all([input.getPrimaryAudioTrack(), input.getMetadataTags()]);
    if (!track) throw new Error('No audio track was found in this file.');
    if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track.');
    const duration = await track.getDurationFromMetadata().catch(() => null);
    const sink = new AudioBufferSink(track);
    let accumulator: LoudnessAccumulator | null = null;
    let lastProgressAt = 0;
    for await (const wrapped of sink.buffers()) {
      if (options.signal?.aborted) throw new DOMException('Analysis cancelled.', 'AbortError');
      accumulator ??= new LoudnessAccumulator(wrapped.buffer.sampleRate, wrapped.buffer.numberOfChannels);
      accumulator.addBuffer(wrapped.buffer);
      const seconds = wrapped.timestamp + wrapped.duration;
      if (seconds - lastProgressAt >= 0.2) {
        lastProgressAt = seconds;
        options.onProgress?.({ seconds, duration });
      }
    }
    if (!accumulator) throw new Error('The audio track contained no decoded samples.');
    const result = accumulator.finish();
    options.onProgress?.({ seconds: result.duration, duration });
    return {
      ...result,
      album: metadata.album?.trim() || undefined,
      albumArtist: metadata.albumArtist?.trim() || metadata.artist?.trim() || undefined
    };
  } finally {
    input.dispose();
  }
}

export function replayGainForLoudness(integratedLufs: number, targetLufs: number): number {
  return Number.isFinite(integratedLufs) ? targetLufs - integratedLufs : 0;
}
