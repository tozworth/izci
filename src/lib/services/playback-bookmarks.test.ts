import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import {
  addPlaybackBookmark,
  deletePlaybackBookmark,
  getPlaybackBookmarkFileKey,
  getPlaybackBookmarks,
  normalizePlaybackBookmarkState,
  normalizePlaybackBookmarks,
  playbackBookmarksStore
} from './playback-bookmarks';

const track = (overrides: Partial<MediaEntity> = {}): MediaEntity => ({
  id: 'playlist-entry',
  name: 'Track.flac',
  path: 'Music/Track.flac',
  format: 'flac',
  kind: 'stream',
  size: 12,
  lastModified: 34,
  ...overrides
});

beforeEach(() => {
  playbackBookmarksStore.reset();
});

describe('playback bookmarks', () => {
  it('uses the canonical path rather than a playlist entry id', () => {
    expect(getPlaybackBookmarkFileKey(track({ id: 'one' })))
      .toBe(getPlaybackBookmarkFileKey(track({ id: 'two' })));
  });

  it('auto-names, sorts, persists, and deletes bookmarks', () => {
    addPlaybackBookmark(track(), 20, '', { createId: () => 'first', now: () => 1 });
    const bookmarks = addPlaybackBookmark(track(), 10, '', { createId: () => 'second', now: () => 2 });
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

  it('normalizes duplicate buckets and orders them by recent use', () => {
    expect(normalizePlaybackBookmarkState({ buckets: [
      { key: 'older', updatedAt: 1, bookmarks: [{ id: 'one', name: 'One', time: 1 }] },
      { key: 'newer', updatedAt: 2, bookmarks: [{ id: 'two', name: 'Two', time: 2 }] },
      { key: 'older', updatedAt: 3, bookmarks: [{ id: 'duplicate', name: 'Duplicate', time: 3 }] }
    ] }).buckets.map((bucket) => bucket.key)).toEqual(['newer', 'older']);
  });
});
