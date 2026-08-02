import { describe, expect, it } from 'vitest';
import {
  buildTrackRatingAction,
  formatTrackRating,
  normalizeTrackRating,
  parseTrackRatingAction,
  TRACK_RATING_VALUES
} from './track-ratings';
import type { PlaylistItem } from '$lib/types';

function item(rating?: number): PlaylistItem {
  return {
    id: 'track',
    name: 'track.flac',
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    rating
  };
}

describe('track ratings', () => {
  it('normalizes ratings to the supported half-star scale', () => {
    expect(normalizeTrackRating(0)).toBeUndefined();
    expect(normalizeTrackRating(0.7)).toBe(0.5);
    expect(normalizeTrackRating(3.26)).toBe(3.5);
    expect(normalizeTrackRating(8)).toBe(5);
    expect(formatTrackRating(3.5)).toBe('3.5');
  });

  it('builds the shared picker action with ten supported values', () => {
    const action = buildTrackRatingAction([item(3.5)]);
    expect(TRACK_RATING_VALUES).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
    expect(action.ratingPicker).toEqual({ value: 3.5, actionPrefix: 'rate:' });
  });

  it('parses rating and clear menu actions', () => {
    expect(parseTrackRatingAction('rate:4.5')).toEqual({ matched: true, rating: 4.5 });
    expect(parseTrackRatingAction('rate:clear')).toEqual({ matched: true });
    expect(parseTrackRatingAction('remove')).toEqual({ matched: false });
  });
});
