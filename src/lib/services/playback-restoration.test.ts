import { describe, expect, it } from 'vitest';

import { normalizePlaybackRestorationCheckpoint } from './playback-restoration';

describe('playback restoration helpers', () => {
  it('normalizes a valid checkpoint and clamps negative positions', () => {
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: 'track-1',
        currentTime: -4,
        wasPlaying: true
      })
    ).toEqual({
      trackId: 'track-1',
      currentTime: 0,
      wasPlaying: true
    });
  });

  it('rejects incomplete and non-finite checkpoints', () => {
    expect(normalizePlaybackRestorationCheckpoint(null)).toBeNull();
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: '',
        currentTime: 10,
        wasPlaying: false
      })
    ).toBeNull();
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: 'track-1',
        currentTime: Number.NaN,
        wasPlaying: false
      })
    ).toBeNull();
  });
});
