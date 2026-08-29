import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FOLDER_NESTING_LIMIT,
  DEFAULT_TRACK_SETTINGS,
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

  it('preserves opt-outs through normalization while keeping defaults otherwise', () => {
    expect(normalizeTrackSettings({}).deduplicateQueue).toBe(true);
    expect(normalizeTrackSettings({ deduplicateQueue: false }).deduplicateQueue).toBe(false);
    expect(normalizeTrackSettings({ enableRatings: false }).enableRatings).toBe(false);
    expect(
      normalizeTrackSettings({ showFavoriteToggleInPlayerBar: true })
        .showFavoriteToggleInPlayerBar
    ).toBe(true);
  });

  it('falls back to defaults for malformed values', () => {
    const normalized = normalizeTrackSettings({
      associatedFileAction: 'merge',
      folderNestingLimit: 'nope',
      verifyAddedFiles: 'definitely'
    });
    expect(normalized.associatedFileAction).toBe(DEFAULT_TRACK_SETTINGS.associatedFileAction);
    expect(normalized.folderNestingLimit).toBe(DEFAULT_FOLDER_NESTING_LIMIT);
    expect(normalized.verifyAddedFiles).toBe(DEFAULT_TRACK_SETTINGS.verifyAddedFiles);
  });
});
