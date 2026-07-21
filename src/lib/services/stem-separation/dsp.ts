import { STEM_SAMPLE_RATE } from './types';
import type { StemPeakPoint } from './types';

export const STEM_N_FFT = 2048;
export const STEM_HOP = 512;
export const STEM_CHUNK_SAMPLES = 131_072;
export const STEM_FREQUENCIES = STEM_N_FFT / 2 + 1;

export function createHannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / length));
  }
  return window;
}

function fftInPlace(real: Float32Array, imaginary: Float32Array, length: number): void {
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size;
    const rotationReal = Math.cos(angle);
    const rotationImaginary = Math.sin(angle);
    for (let offset = 0; offset < length; offset += size) {
      let currentReal = 1;
      let currentImaginary = 0;
      for (let index = 0; index < half; index += 1) {
        const first = offset + index;
        const second = first + half;
        const temporaryReal =
          currentReal * real[second] - currentImaginary * imaginary[second];
        const temporaryImaginary =
          currentReal * imaginary[second] + currentImaginary * real[second];
        real[second] = real[first] - temporaryReal;
        imaginary[second] = imaginary[first] - temporaryImaginary;
        real[first] += temporaryReal;
        imaginary[first] += temporaryImaginary;
        const nextReal = currentReal * rotationReal - currentImaginary * rotationImaginary;
        currentImaginary = currentReal * rotationImaginary + currentImaginary * rotationReal;
        currentReal = nextReal;
      }
    }
  }
}

function realFft(input: Float32Array, length: number): Float32Array {
  const real = new Float32Array(length);
  const imaginary = new Float32Array(length);
  real.set(input);
  fftInPlace(real, imaginary, length);
  const output = new Float32Array((length / 2 + 1) * 2);
  for (let index = 0; index <= length / 2; index += 1) {
    output[index * 2] = real[index];
    output[index * 2 + 1] = imaginary[index];
  }
  return output;
}

function inverseRealFft(spectrum: Float32Array, length: number): Float32Array {
  const real = new Float32Array(length);
  const imaginary = new Float32Array(length);
  const half = length / 2;
  for (let index = 0; index <= half; index += 1) {
    real[index] = spectrum[index * 2];
    imaginary[index] = -spectrum[index * 2 + 1];
  }
  for (let index = 1; index < half; index += 1) {
    real[length - index] = spectrum[index * 2];
    imaginary[length - index] = spectrum[index * 2 + 1];
  }
  fftInPlace(real, imaginary, length);
  for (let index = 0; index < length; index += 1) real[index] /= length;
  return real;
}

interface StftResult {
  data: Float32Array;
  frames: number;
}

function stft(signal: Float32Array, window: Float32Array): StftResult {
  const frames = Math.floor((signal.length - STEM_N_FFT) / STEM_HOP) + 1;
  const output = new Float32Array(STEM_FREQUENCIES * frames * 2);
  const windowed = new Float32Array(STEM_N_FFT);
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = frame * STEM_HOP;
    for (let index = 0; index < STEM_N_FFT; index += 1) {
      windowed[index] = (signal[offset + index] || 0) * window[index];
    }
    const spectrum = realFft(windowed, STEM_N_FFT);
    for (let frequency = 0; frequency < STEM_FREQUENCIES; frequency += 1) {
      const target = (frequency * frames + frame) * 2;
      output[target] = spectrum[frequency * 2];
      output[target + 1] = spectrum[frequency * 2 + 1];
    }
  }
  return { data: output, frames };
}

function inverseStft(
  spectrum: Float32Array,
  frames: number,
  window: Float32Array,
  length: number
): Float32Array {
  const output = new Float32Array(length);
  const windowSum = new Float32Array(length);
  const frameSpectrum = new Float32Array(STEM_FREQUENCIES * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let frequency = 0; frequency < STEM_FREQUENCIES; frequency += 1) {
      const source = (frequency * frames + frame) * 2;
      frameSpectrum[frequency * 2] = spectrum[source];
      frameSpectrum[frequency * 2 + 1] = spectrum[source + 1];
    }
    const samples = inverseRealFft(frameSpectrum, STEM_N_FFT);
    const offset = frame * STEM_HOP;
    for (let index = 0; index < STEM_N_FFT && offset + index < length; index += 1) {
      output[offset + index] += samples[index] * window[index];
      windowSum[offset + index] += window[index] * window[index];
    }
  }
  for (let index = 0; index < length; index += 1) {
    if (windowSum[index] > 1e-8) output[index] /= windowSum[index];
  }
  return output;
}

export function prepareModelInput(left: Float32Array, right: Float32Array, window: Float32Array) {
  const leftStft = stft(left, window);
  const rightStft = stft(right, window);
  const frames = leftStft.frames;
  const features = STEM_FREQUENCIES * 2 * 2;
  const input = new Float32Array(frames * features);
  for (let frame = 0; frame < frames; frame += 1) {
    for (let frequency = 0; frequency < STEM_FREQUENCIES; frequency += 1) {
      const source = (frequency * frames + frame) * 2;
      const target = frame * features + frequency * 4;
      input[target] = leftStft.data[source];
      input[target + 1] = leftStft.data[source + 1];
      input[target + 2] = rightStft.data[source];
      input[target + 3] = rightStft.data[source + 1];
    }
  }
  return { input, frames, leftStft, rightStft };
}

export function reconstructVocals(
  mask: Float32Array,
  leftStft: StftResult,
  rightStft: StftResult,
  window: Float32Array,
  length: number
): { left: Float32Array; right: Float32Array } {
  const frames = leftStft.frames;
  const maskedLeft = new Float32Array(STEM_FREQUENCIES * frames * 2);
  const maskedRight = new Float32Array(STEM_FREQUENCIES * frames * 2);
  for (let frequency = 0; frequency < STEM_FREQUENCIES; frequency += 1) {
    for (let frame = 0; frame < frames; frame += 1) {
      const leftMask = ((frequency * 2) * frames + frame) * 2;
      const rightMask = ((frequency * 2 + 1) * frames + frame) * 2;
      const source = (frequency * frames + frame) * 2;
      const leftReal = leftStft.data[source];
      const leftImaginary = leftStft.data[source + 1];
      const rightReal = rightStft.data[source];
      const rightImaginary = rightStft.data[source + 1];
      maskedLeft[source] = leftReal * mask[leftMask] - leftImaginary * mask[leftMask + 1];
      maskedLeft[source + 1] = leftReal * mask[leftMask + 1] + leftImaginary * mask[leftMask];
      maskedRight[source] = rightReal * mask[rightMask] - rightImaginary * mask[rightMask + 1];
      maskedRight[source + 1] = rightReal * mask[rightMask + 1] + rightImaginary * mask[rightMask];
    }
  }
  for (let frame = 0; frame < frames; frame += 1) {
    maskedLeft[frame * 2] = 0;
    maskedLeft[frame * 2 + 1] = 0;
    maskedRight[frame * 2] = 0;
    maskedRight[frame * 2 + 1] = 0;
  }
  return {
    left: inverseStft(maskedLeft, frames, window, length),
    right: inverseStft(maskedRight, frames, window, length)
  };
}

export function encodeStereoWav(left: Float32Array, right: Float32Array): ArrayBuffer {
  const samples = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + samples * 8);
  const view = new DataView(buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples * 8, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, STEM_SAMPLE_RATE, true);
  view.setUint32(28, STEM_SAMPLE_RATE * 8, true);
  view.setUint16(32, 8, true);
  view.setUint16(34, 32, true);
  writeText(36, 'data');
  view.setUint32(40, samples * 8, true);
  let offset = 44;
  for (let index = 0; index < samples; index += 1) {
    const leftSample = Number.isFinite(left[index]) ? left[index] : 0;
    const rightSample = Number.isFinite(right[index]) ? right[index] : 0;
    view.setFloat32(offset, leftSample, true);
    view.setFloat32(offset + 4, rightSample, true);
    offset += 8;
  }
  return buffer;
}

export function calculatePeakTable(
  originalLeft: Float32Array,
  originalRight: Float32Array,
  vocalLeft: Float32Array,
  vocalRight: Float32Array
): StemPeakPoint[] {
  const mixes = Array.from({ length: 17 }, (_, index) => -1 + index / 8);
  const peaks = new Float64Array(mixes.length);
  const length = Math.min(originalLeft.length, originalRight.length, vocalLeft.length, vocalRight.length);
  for (let sample = 0; sample < length; sample += 1) {
    for (let index = 0; index < mixes.length; index += 1) {
      const mix = mixes[index];
      const originalGain = mix <= 0 ? 1 : 1 - mix;
      const vocalGain = mix;
      peaks[index] = Math.max(
        peaks[index],
        Math.abs(originalLeft[sample] * originalGain + vocalLeft[sample] * vocalGain),
        Math.abs(originalRight[sample] * originalGain + vocalRight[sample] * vocalGain)
      );
    }
  }
  return mixes.map((mix, index) => ({
    mix,
    gain: mix !== 0 && peaks[index] > 0.99 ? 0.99 / peaks[index] : 1
  }));
}
