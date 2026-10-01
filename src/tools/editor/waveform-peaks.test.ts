import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildWaveformPeakPyramid,
  waveformPeakAt,
  waveformPeakBucketSize,
  waveformPeakRange,
  prepareWaveformPeakPyramid
} from './waveform-peaks';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('waveform peaks', () => {
  it('uses power-of-two buckets at a stable resolution', () => {
    expect(waveformPeakBucketSize(0.5)).toBe(1);
    expect(waveformPeakBucketSize(63)).toBe(32);
    expect(waveformPeakBucketSize(64)).toBe(64);
    expect(waveformPeakBucketSize(127.9)).toBe(64);
  });

  it('keeps buckets aligned to audio time instead of the viewport', () => {
    const samples = Float32Array.from({ length: 128 }, (_, index) => index === 70 ? 0.9 : -0.2);
    const peaks = buildWaveformPeakPyramid([samples]);

    const peak = waveformPeakAt(peaks, 0, 64, 64);
    expect(peak.minimum).toBeCloseTo(-0.2, 5);
    expect(peak.maximum).toBeCloseTo(0.9, 5);
    expect(waveformPeakAt(peaks, 0, 90, 64)).toEqual(peak);
  });

  it('finds exact peaks in sub-base buckets', () => {
    const samples = Float32Array.from([0.1, -0.8, 0.6, -0.2]);
    const peaks = buildWaveformPeakPyramid([samples]);

    const peak = waveformPeakAt(peaks, 0, 0, 4);
    expect(peak.minimum).toBeCloseTo(-0.8, 5);
    expect(peak.maximum).toBeCloseTo(0.6, 5);
  });

  it('preserves narrow impulses that decimated overview sampling missed', () => {
    const samples = new Float32Array(65_537);
    samples[123] = 0.95;
    samples[31_777] = -0.85;
    samples[samples.length - 1] = 0.75;
    const pyramid = buildWaveformPeakPyramid([samples]);
    expect(waveformPeakAt(pyramid, 0, 0, 65_536)).toMatchObject({ minimum: samples[31_777], maximum: samples[123] });
    expect(waveformPeakRange(pyramid, 0, 65_535, 65_537).maximum).toBe(0.75);
    const bytes = pyramid.channels[0].levels.reduce((total, level) => total + level.minimum.byteLength + level.maximum.byteLength, 0);
    expect(bytes).toBeLessThan(samples.byteLength * 0.02);
  });

  it('matches exhaustive min/max queries at unaligned joins and pyramid levels', () => {
    const samples = Float32Array.from({ length: 30_777 }, (_, i) => Math.sin(i * 1.71) * 1.2);
    const pyramid = buildWaveformPeakPyramid([samples]);
    for (const start of [0, 1, 127, 256, 997, 12_333, samples.length - 1]) {
      for (const width of [1, 10, 255, 256, 512, 4096, 20_000]) {
        const data = samples.subarray(start, start + width);
        expect(waveformPeakRange(pyramid, 0, start, start + width)).toEqual({
          minimum: Math.min(...data), maximum: Math.max(...data)
        });
      }
    }
  });

  it('prepares asynchronously and rejects cancelled preparations', async () => {
    const samples = Float32Array.from({ length: 400_001 }, (_, i) => Math.cos(i * 0.73));
    const promise = prepareWaveformPeakPyramid([samples]);
    const expected = buildWaveformPeakPyramid([samples]);
    expect(await promise).toEqual(expected);
    const controller = new AbortController();
    const cancelled = prepareWaveformPeakPyramid([samples], controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('survives playback detaching PCM views during preparation and subsequent fine queries', async () => {
    const original = Float32Array.from({ length: 200_001 }, (_, i) => Math.sin(i * 0.77));
    let current = original.slice();
    let yields = 0;
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now += 5);
    vi.stubGlobal('scheduler', { yield: () => {
      if (++yields === 2) {
        structuredClone(current.buffer, { transfer: [current.buffer] });
        current = original.slice();
      }
      return Promise.resolve();
    } });
    const pyramid = await prepareWaveformPeakPyramid([current], undefined, [() => current]);
    expect(pyramid.length).toBe(original.length);
    expect(waveformPeakRange(pyramid, 0, 0, original.length)).toEqual({
      minimum: original.reduce((minimum, sample) => Math.min(minimum, sample), Infinity),
      maximum: original.reduce((maximum, sample) => Math.max(maximum, sample), -Infinity)
    });
    structuredClone(current.buffer, { transfer: [current.buffer] });
    current = original.slice();
    expect(waveformPeakRange(pyramid, 0, 70_123, 70_199)).toEqual({
      minimum: Math.min(...original.subarray(70_123, 70_199)), maximum: Math.max(...original.subarray(70_123, 70_199))
    });
  });
});
