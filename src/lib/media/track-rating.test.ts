import { describe, expect, it } from 'vitest';
import { formatTrackRating, normalizeTrackRating } from './track-rating';

describe('track rating domain', () => {
  it('normalizes only finite half-star ratings', () => {
    expect(normalizeTrackRating(4.74)).toBe(4.5);
    expect(normalizeTrackRating(99)).toBe(5);
    expect(normalizeTrackRating(0)).toBeUndefined();
    expect(normalizeTrackRating(Number.NaN)).toBeUndefined();
    expect(formatTrackRating(3.5)).toBe('3.5');
  });
});
