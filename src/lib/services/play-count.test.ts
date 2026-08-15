import { describe, expect, it, vi } from 'vitest';
import { createPlayCountTracker } from './play-count';
import type { TrackItem } from '$lib/types';

function item(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    ...overrides
  };
}

describe('play count tracker', () => {
  it('increments once after a continuous playing threshold for library tracks', () => {
    vi.useFakeTimers();
    const increment = vi.fn();
    const recordLastPlayed = vi.fn();
    const tracker = createPlayCountTracker({
      incrementLibraryPlayCount: increment,
      recordLibraryLastPlayed: recordLastPlayed
    });
    const libraryTrack = item('library-track');

    tracker.sync({
      track: libraryTrack,
      playbackState: 'playing',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });

    vi.advanceTimersByTime(14999);
    expect(increment).not.toHaveBeenCalled();
    expect(recordLastPlayed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(increment).toHaveBeenCalledWith('library-track');
    expect(recordLastPlayed).toHaveBeenCalledWith('library-track');

    tracker.sync({
      track: libraryTrack,
      playbackState: 'playing',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });
    vi.advanceTimersByTime(15000);
    expect(increment).toHaveBeenCalledTimes(1);
    expect(recordLastPlayed).toHaveBeenCalledTimes(1);

    tracker.destroy();
    vi.useRealTimers();
  });

  it('does not count queue-only tracks and resets when playback pauses', () => {
    vi.useFakeTimers();
    const increment = vi.fn();
    const recordLastPlayed = vi.fn();
    const tracker = createPlayCountTracker({
      incrementLibraryPlayCount: increment,
      recordLibraryLastPlayed: recordLastPlayed
    });
    const queueTrack = item('queue-track', { path: '/Music/Track.flac' });
    const libraryTrack = item('library-track', { path: '/Music/Track.flac' });

    tracker.sync({
      track: item('random-queue-track', { path: '/Music/Other.flac' }),
      playbackState: 'playing',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });
    vi.advanceTimersByTime(15000);
    expect(increment).not.toHaveBeenCalled();

    tracker.sync({
      track: queueTrack,
      playbackState: 'playing',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });
    vi.advanceTimersByTime(14000);
    tracker.sync({
      track: queueTrack,
      playbackState: 'paused',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });
    vi.advanceTimersByTime(1000);
    expect(increment).not.toHaveBeenCalled();

    tracker.sync({
      track: queueTrack,
      playbackState: 'playing',
      libraryItems: [libraryTrack],
      thresholdSeconds: 15
    });
    vi.advanceTimersByTime(15000);
    expect(increment).toHaveBeenCalledWith('library-track');
    expect(recordLastPlayed).toHaveBeenCalledWith('library-track');

    tracker.destroy();
    vi.useRealTimers();
  });
});
