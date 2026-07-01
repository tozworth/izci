import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS,
  MAX_PLAY_COUNT_THRESHOLD_SECONDS,
  MIN_PLAY_COUNT_THRESHOLD_SECONDS,
  normalizePlayCountThresholdSeconds
} from './metadata-settings';

describe('metadata settings helpers', () => {
  it('normalizes play-count thresholds from numeric inputs', () => {
    expect(normalizePlayCountThresholdSeconds(12.4)).toBe(12);
    expect(normalizePlayCountThresholdSeconds(12.5)).toBe(13);
    expect(normalizePlayCountThresholdSeconds(MIN_PLAY_COUNT_THRESHOLD_SECONDS - 10)).toBe(
      MIN_PLAY_COUNT_THRESHOLD_SECONDS
    );
    expect(normalizePlayCountThresholdSeconds(MAX_PLAY_COUNT_THRESHOLD_SECONDS + 10)).toBe(
      MAX_PLAY_COUNT_THRESHOLD_SECONDS
    );
  });

  it('accepts trimmed numeric strings and falls back for invalid values', () => {
    expect(normalizePlayCountThresholdSeconds(' 42 ')).toBe(42);
    expect(normalizePlayCountThresholdSeconds('')).toBe(DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS);
    expect(normalizePlayCountThresholdSeconds('not a number')).toBe(DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS);
    expect(normalizePlayCountThresholdSeconds(null)).toBe(DEFAULT_PLAY_COUNT_THRESHOLD_SECONDS);
  });
});
