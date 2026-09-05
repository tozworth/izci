import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny';

export const DEFAULT_FFT_SIZE = 4096;
export const SPECTROGRAM_FFT_SIZES = [2048, 4096, 8192] as const;

interface SpectrogramProgress {
  completed: number;
  total: number;
}

export interface SpectrogramAnalysis {
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
  fftSize: number;
  columnCount: number;
  binCount: number;
  magnitudesDb: Float32Array;
}

interface AudioChunk {
  startFrame: number;
  endFrame: number;
  channels: Float32Array[];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Spectrogram analysis cancelled.', 'AbortError');
  }
}

function createBitReversalTable(size: number): Uint32Array {
  const result = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let value = 0; value < size; value += 1) {
    let source = value;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      reversed = (reversed << 1) | (source & 1);
      source >>>= 1;
    }
    result[value] = reversed;
  }
  return result;
}

function createHannWindow(size: number): { values: Float64Array; amplitude: number } {
  const values = new Float64Array(size);
  let sum = 0;
  for (let index = 0; index < size; index += 1) {
    const value = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    values[index] = value;
    sum += value;
  }
  return { values, amplitude: sum / 2 };
}

function transformMagnitudeDb(
  samples: Float32Array,
  bitReversal: Uint32Array,
  window: Float64Array,
  windowAmplitude: number,
  real: Float64Array,
  imaginary: Float64Array,
  output: Float32Array,
  outputOffset = 0
): void {
  const size = samples.length;
  for (let index = 0; index < size; index += 1) {
    const target = bitReversal[index];
    real[target] = samples[index] * window[index];
    imaginary[target] = 0;
  }

  for (let length = 2; length <= size; length *= 2) {
    const halfLength = length / 2;
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < halfLength; offset += 1) {
        const even = start + offset;
        const odd = even + halfLength;
        const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        const evenReal = real[even];
        const evenImaginary = imaginary[even];
        real[even] = evenReal + oddReal;
        imaginary[even] = evenImaginary + oddImaginary;
        real[odd] = evenReal - oddReal;
        imaginary[odd] = evenImaginary - oddImaginary;
        const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }

  for (let bin = 0; bin <= size / 2; bin += 1) {
    const magnitude = Math.hypot(real[bin], imaginary[bin]) / windowAmplitude;
    output[outputOffset + bin] = magnitude > 0 ? 20 * Math.log10(magnitude) : -160;
  }
}

export function computeWindowSpectrum(samples: Float32Array): Float32Array {
  const size = samples.length;
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('FFT input length must be a power of two.');
  }
  const bitReversal = createBitReversalTable(size);
  const hann = createHannWindow(size);
  const output = new Float32Array(size / 2 + 1);
  transformMagnitudeDb(
    samples,
    bitReversal,
    hann.values,
    hann.amplitude,
    new Float64Array(size),
    new Float64Array(size),
    output
  );
  return output;
}

function readMonoWindow(chunks: readonly AudioChunk[], startFrame: number, size: number): Float32Array {
  const samples = new Float32Array(size);
  let chunkIndex = 0;
  for (let offset = 0; offset < size; offset += 1) {
    const frame = startFrame + offset;
    while (chunkIndex < chunks.length && frame >= chunks[chunkIndex].endFrame) {
      chunkIndex += 1;
    }
    const chunk = chunks[chunkIndex];
    if (!chunk || frame < chunk.startFrame) continue;
    const localFrame = frame - chunk.startFrame;
    let sample = 0;
    for (const channel of chunk.channels) sample += channel[localFrame] ?? 0;
    samples[offset] = sample / chunk.channels.length;
  }
  return samples;
}

function chooseColumnCount(duration: number): number {
  return Math.min(1800, Math.max(160, Math.ceil(duration * 6)));
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export async function analyzeSpectrogram(
  file: File,
  options: {
    fftSize?: number;
    signal?: AbortSignal;
    onProgress?: (progress: SpectrogramProgress) => void;
  } = {}
): Promise<SpectrogramAnalysis> {
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
  if (!(SPECTROGRAM_FFT_SIZES as readonly number[]).includes(fftSize)) {
    throw new Error('Unsupported FFT size.');
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    throwIfAborted(options.signal);
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('No audio track was found in this file.');
    if (!(await track.canDecode())) throw new Error('This browser cannot decode the audio track.');
    const codec = (await track.getCodec()) ?? 'audio';
    const metadataDuration = await track.getDurationFromMetadata().catch(() => null);
    const duration = metadataDuration && metadataDuration > 0
      ? metadataDuration
      : await track.computeDuration();
    if (!(duration > 0)) throw new Error('The audio track has no measurable duration.');
    throwIfAborted(options.signal);

    const columnCount = chooseColumnCount(duration);
    const binCount = fftSize / 2 + 1;
    const magnitudesDb = new Float32Array(columnCount * binCount);
    magnitudesDb.fill(-160);
    const bitReversal = createBitReversalTable(fftSize);
    const hann = createHannWindow(fftSize);
    const real = new Float64Array(fftSize);
    const imaginary = new Float64Array(fftSize);
    const sink = new AudioBufferSink(track);
    const chunks: AudioChunk[] = [];
    let sampleRate = 0;
    let channels = 0;
    let decodedEndFrame = 0;
    let nextColumn = 0;
    let columnsSinceYield = 0;

    const processReadyColumns = async (finished: boolean): Promise<void> => {
      if (!sampleRate) return;
      while (nextColumn < columnCount) {
        const centerFrame = Math.round((nextColumn / Math.max(1, columnCount - 1)) * duration * sampleRate);
        const startFrame = centerFrame - fftSize / 2;
        if (!finished && decodedEndFrame < startFrame + fftSize) break;
        throwIfAborted(options.signal);
        transformMagnitudeDb(
          readMonoWindow(chunks, startFrame, fftSize),
          bitReversal,
          hann.values,
          hann.amplitude,
          real,
          imaginary,
          magnitudesDb,
          nextColumn * binCount
        );
        nextColumn += 1;
        columnsSinceYield += 1;
        options.onProgress?.({ completed: nextColumn, total: columnCount });

        const nextCenter = Math.round((nextColumn / Math.max(1, columnCount - 1)) * duration * sampleRate);
        const earliestNeeded = nextCenter - fftSize / 2;
        while (chunks.length > 0 && chunks[0].endFrame <= earliestNeeded) chunks.shift();
        if (columnsSinceYield >= 12) {
          columnsSinceYield = 0;
          await yieldToUi();
        }
      }
    };

    for await (const wrapped of sink.buffers()) {
      throwIfAborted(options.signal);
      if (!sampleRate) {
        sampleRate = wrapped.buffer.sampleRate;
        channels = wrapped.buffer.numberOfChannels;
      } else if (
        wrapped.buffer.sampleRate !== sampleRate
        || wrapped.buffer.numberOfChannels !== channels
      ) {
        throw new Error('The audio stream changed its sample rate or channel layout during analysis.');
      }
      const startFrame = Math.round(wrapped.timestamp * sampleRate);
      const chunkChannels = Array.from(
        { length: wrapped.buffer.numberOfChannels },
        (_, channel) => wrapped.buffer.getChannelData(channel)
      );
      chunks.push({
        startFrame,
        endFrame: startFrame + wrapped.buffer.length,
        channels: chunkChannels
      });
      decodedEndFrame = Math.max(decodedEndFrame, startFrame + wrapped.buffer.length);
      await processReadyColumns(false);
    }

    if (!sampleRate) throw new Error('The audio track contained no decoded samples.');
    await processReadyColumns(true);
    options.onProgress?.({ completed: columnCount, total: columnCount });
    return {
      duration,
      sampleRate,
      channels,
      codec,
      fftSize,
      columnCount,
      binCount,
      magnitudesDb
    };
  } finally {
    input.dispose();
  }
}
