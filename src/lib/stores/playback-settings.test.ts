import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX,
  normalizePlaybackRate,
  normalizePlaybackSettings,
  normalizePlaybackRestoreMode,
  normalizeRememberProgressDurationIndex
} from './playback-settings';

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

  it('normalizes remembered-progress duration slider indices', () => {
    expect(normalizeRememberProgressDurationIndex(0)).toBe(0);
    expect(normalizeRememberProgressDurationIndex(4.4)).toBe(4);
    expect(normalizeRememberProgressDurationIndex(99)).toBe(8);
    expect(normalizeRememberProgressDurationIndex(-3)).toBe(0);
    expect(normalizeRememberProgressDurationIndex('4')).toBe(
      DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX
    );
  });

  it('normalizes playback rates to the supported slider range and step', () => {
    expect(normalizePlaybackRate(1)).toBe(1);
    expect(normalizePlaybackRate(1.234)).toBe(1.25);
    expect(normalizePlaybackRate(0.1)).toBe(0.5);
    expect(normalizePlaybackRate(4)).toBe(2);
    expect(normalizePlaybackRate('1.5')).toBe(1);
  });

  it('defaults the Previous restart behavior on and preserves an explicit opt-out', () => {
    expect(normalizePlaybackSettings({}).restartCurrentTrackOnPrevious).toBe(true);
    expect(normalizePlaybackSettings({ restartCurrentTrackOnPrevious: false }).restartCurrentTrackOnPrevious).toBe(false);
  });
});
