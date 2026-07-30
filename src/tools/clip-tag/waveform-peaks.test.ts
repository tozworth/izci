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

    expect(waveformPeakAt(peaks, 0, 64, 64)).toEqual({
      minimum: -0.20000000298023224,
      maximum: 0.8999999761581421
    });
    expect(waveformPeakAt(peaks, 0, 90, 64)).toEqual(waveformPeakAt(peaks, 0, 64, 64));
  });

  it('finds exact peaks in sub-base buckets', () => {
    const samples = Float32Array.from([0.1, -0.8, 0.6, -0.2]);
    const peaks = buildWaveformPeakPyramid([samples]);

    expect(waveformPeakAt(peaks, 0, 0, 4)).toEqual({
      minimum: -0.800000011920929,
      maximum: 0.6000000238418579
    });
  });
});
