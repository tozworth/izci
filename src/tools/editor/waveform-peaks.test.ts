import { describe, expect, it } from 'vitest';
import {
  buildWaveformPeakPyramid,
  waveformPeakAt,
  waveformPeakBucketSize
} from './waveform-peaks';

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
});
