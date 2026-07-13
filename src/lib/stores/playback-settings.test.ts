import { describe, expect, it } from 'vitest';

import { normalizePlaybackRestoreMode } from './playback-settings';

describe('playback settings helpers', () => {
  it('accepts each playback restoration mode', () => {
    expect(normalizePlaybackRestoreMode('disabled')).toBe('disabled');
    expect(normalizePlaybackRestoreMode('position')).toBe('position');
    expect(normalizePlaybackRestoreMode('position-and-state')).toBe('position-and-state');
  });

  it('falls back to disabled for invalid restoration modes', () => {
    expect(normalizePlaybackRestoreMode('playing')).toBe('disabled');
    expect(normalizePlaybackRestoreMode(null)).toBe('disabled');
  });
});
