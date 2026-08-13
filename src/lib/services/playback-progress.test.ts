import { describe, expect, it } from 'vitest';

import {
  normalizePlaybackProgressRecord,
  readAllPlaybackProgress,
  shouldRememberPlaybackProgress
} from './playback-progress';

describe('playback progress helpers', () => {
  it('normalizes valid records and clamps negative values', () => {
    expect(
      normalizePlaybackProgressRecord({
        identity: 'track',
        currentTime: -2,
        duration: 1_800,
        updatedAt: -1
      })
    ).toEqual({ identity: 'track', currentTime: 0, duration: 1_800, updatedAt: 0 });
  });

  it('rejects malformed records', () => {
    expect(normalizePlaybackProgressRecord(null)).toBeNull();
    expect(
      normalizePlaybackProgressRecord({
        identity: '',
        currentTime: 20,
        duration: 1_800,
        updatedAt: 1
      })
    ).toBeNull();
  });

  it('requires meaningful unfinished progress above the selected duration', () => {
    expect(shouldRememberPlaybackProgress(120, 1_800, 30)).toBe(true);
    expect(shouldRememberPlaybackProgress(120, 1_799, 30)).toBe(false);
    expect(shouldRememberPlaybackProgress(9, 1_800, 30)).toBe(false);
    expect(shouldRememberPlaybackProgress(1_750, 1_800, 30)).toBe(false);
    expect(shouldRememberPlaybackProgress(1_700, 1_800, 30)).toBe(true);
  });

  it('does not misreport unavailable durable storage as an empty progress history', async () => {
    await expect(readAllPlaybackProgress()).rejects.toMatchObject({
      category: 'unavailable',
      code: 'persistence.indexed-db-unavailable'
    });
  });
});
