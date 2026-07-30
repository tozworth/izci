import { describe, expect, it } from 'vitest';
import {
  calculateLoudnessMatchGains,
  chooseAbxSource,
  getComparisonDuration,
  normalizeComparisonRange
} from './audio-comparison';

function buffer(duration: number): AudioBuffer {
  return { duration } as AudioBuffer;
}

describe('audio comparison helpers', () => {
  it('uses the overlapping duration when both sources are loaded', () => {
    expect(getComparisonDuration(buffer(12), buffer(8))).toBe(8);
    expect(getComparisonDuration(buffer(12), null)).toBe(12);
  });

  it('clamps ranges and restores an accidentally empty range', () => {
    expect(normalizeComparisonRange({ start: -4, end: 20 }, 10)).toEqual({ start: 0, end: 10 });
    expect(normalizeComparisonRange({ start: 4, end: 4 }, 10)).toEqual({ start: 0, end: 10 });
  });

  it('attenuates the louder source without boosting the quieter one', () => {
    expect(calculateLoudnessMatchGains(-12, -18)).toEqual({ aDb: -6, bDb: 0 });
    expect(calculateLoudnessMatchGains(-50, -10)).toEqual({ aDb: 0, bDb: -24 });
    expect(calculateLoudnessMatchGains(null, -18)).toEqual({ aDb: 0, bDb: 0 });
  });

  it('maps the blind random value to A or B', () => {
    expect(chooseAbxSource(0)).toBe('a');
    expect(chooseAbxSource(0.499)).toBe('a');
    expect(chooseAbxSource(0.5)).toBe('b');
  });
});
