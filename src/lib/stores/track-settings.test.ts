import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRACK_SETTINGS,
  DEFAULT_FOLDER_NESTING_LIMIT,
  MAX_FOLDER_NESTING_LIMIT,
  MIN_FOLDER_NESTING_LIMIT,
  normalizeFolderNestingLimit,
  normalizeTrackSettings
} from './track-settings';

describe('track settings helpers', () => {
  it('normalizes the folder nesting limit', () => {
    expect(normalizeFolderNestingLimit(3.6)).toBe(4);
    expect(normalizeFolderNestingLimit(' 12 ')).toBe(12);
    expect(normalizeFolderNestingLimit(MIN_FOLDER_NESTING_LIMIT - 1)).toBe(
      MIN_FOLDER_NESTING_LIMIT
    );
    expect(normalizeFolderNestingLimit(MAX_FOLDER_NESTING_LIMIT + 1)).toBe(
      MAX_FOLDER_NESTING_LIMIT
    );
    expect(normalizeFolderNestingLimit('')).toBe(DEFAULT_FOLDER_NESTING_LIMIT);
    expect(normalizeFolderNestingLimit('invalid')).toBe(DEFAULT_FOLDER_NESTING_LIMIT);
  });

  it('keeps replacement as the default associated-file action', () => {
    expect(DEFAULT_TRACK_SETTINGS.associatedFileAction).toBe('replace');
  });

  it('deduplicates queue additions by default and preserves the opt-out', () => {
    expect(DEFAULT_TRACK_SETTINGS.deduplicateQueue).toBe(true);
    expect(normalizeTrackSettings({}).deduplicateQueue).toBe(true);
    expect(normalizeTrackSettings({ deduplicateQueue: false }).deduplicateQueue).toBe(false);
  });

  it('hides the player-bar favorite toggle by default', () => {
    expect(DEFAULT_TRACK_SETTINGS.showFavoriteToggleInPlayerBar).toBe(false);
  });

  it('enables ratings by default and preserves the feature opt-out', () => {
    expect(DEFAULT_TRACK_SETTINGS.enableRatings).toBe(true);
    expect(normalizeTrackSettings({ enableRatings: false }).enableRatings).toBe(false);
  });
});
