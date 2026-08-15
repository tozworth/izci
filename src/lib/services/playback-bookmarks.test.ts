import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import {
  addPlaybackBookmark,
  deletePlaybackBookmark,
  getPlaybackBookmarkFileKey,
  getPlaybackBookmarks,
  normalizePlaybackBookmarks
} from './playback-bookmarks';

const track = (overrides: Partial<TrackItem> = {}): TrackItem => ({
  id: 'queue-entry',
  name: 'Track.flac',
  path: 'Music/Track.flac',
  extension: 'flac',
  kind: 'stream',
  size: 12,
  lastModified: 34,
  ...overrides
});

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
});

describe('playback bookmarks', () => {
  it('uses the canonical path rather than a queue entry id', () => {
    expect(getPlaybackBookmarkFileKey(track({ id: 'one' })))
      .toBe(getPlaybackBookmarkFileKey(track({ id: 'two' })));
  });

  it('auto-names, sorts, persists, and deletes bookmarks', () => {
    addPlaybackBookmark(track(), 20, '');
    const bookmarks = addPlaybackBookmark(track(), 10, '');
    expect(bookmarks.map(({ name, time }) => [name, time])).toEqual([
      ['Bookmark 2', 10],
      ['Bookmark 1', 20]
    ]);

    expect(getPlaybackBookmarks(track())).toEqual(bookmarks);
    expect(deletePlaybackBookmark(track(), bookmarks[0].id)).toEqual([bookmarks[1]]);
  });

  it('discards malformed persisted entries', () => {
    expect(normalizePlaybackBookmarks([
      { id: 'valid', name: ' Point ', time: 2 },
      { id: '', name: 'Bad', time: 1 },
      { id: 'negative', name: 'Bad', time: -1 }
    ])).toEqual([{ id: 'valid', name: 'Point', time: 2 }]);
  });
});
