import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRACK_SETTINGS,
  DEFAULT_FOLDER_NESTING_LIMIT,
  MAX_FOLDER_NESTING_LIMIT,
  MIN_FOLDER_NESTING_LIMIT,
  normalizeFolderNestingLimit
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
});
