import { describe, expect, it } from 'vitest';

import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  normalizeStoredItem,
  restoreStoredItem,
  serializeItem
} from './queue-persistence';
import type { TrackItem } from '$lib/types';

const fileHandle = {
  kind: 'file',
  getFile: async () => new File([], 'track.flac')
} as FileSystemFileHandle;

function item(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'track-id',
    name: 'Track.flac',
    extension: 'flac',
    kind: 'stream',
    size: 123,
    lastModified: 456,
    ...overrides
  };
}

describe('queue persistence helpers', () => {
  it('normalizes persisted playback options defensively', () => {
    expect(normalizePlaybackOptions({ shuffle: true, repeatMode: 'all' })).toEqual({
      shuffle: true,
      repeatMode: 'all'
    });
    expect(normalizePlaybackOptions({ shuffle: 'yes', repeatMode: 'bad' })).toEqual(defaultPlaybackOptions);
  });

  it('serializes only handle-backed queue items', () => {
    expect(serializeItem(item())).toBeNull();
    expect(serializeItem(item({ fileHandle, path: '/Music/Track.flac', sourceFolderId: 'music-root', metadata: { title: 'Track' } }))).toEqual({
      id: 'track-id',
      name: 'Track.flac',
      extension: 'flac',
      kind: 'stream',
      size: 123,
      lastModified: 456,
      fileHandle,
      path: '/Music/Track.flac',
      sourceFolderId: 'music-root',
      metadata: { title: 'Track' }
    });
  });

  it('round-trips a separated module subsong index', () => {
    const moduleItem = item({
      extension: 'xm',
      kind: 'module',
      fileHandle,
      subsong: 2
    });

    expect(serializeItem(moduleItem)).toMatchObject({ subsong: 2 });
    expect(normalizeStoredItem(serializeItem(moduleItem))).toMatchObject({ subsong: 2 });
    expect(normalizeStoredItem({ ...serializeItem(moduleItem), subsong: -1 })).not.toHaveProperty('subsong');
  });

  it('round-trips normalized half-star ratings', () => {
    const ratedItem = item({ fileHandle, rating: 3.6 });

    expect(serializeItem(ratedItem)).toMatchObject({ rating: 3.5 });
    expect(normalizeStoredItem(serializeItem(ratedItem))).toMatchObject({ rating: 3.5 });
    expect(restoreStoredItem(serializeItem(ratedItem))).toMatchObject({ rating: 3.5 });
  });

  it('restores persisted fields into a handle-backed runtime item', () => {
    const restored = restoreStoredItem(serializeItem(item({
      fileHandle,
      path: '/Music/Track.flac',
      sourceFolderId: 'music-root',
      metadata: { title: 'Track' },
      rating: 4.5,
      subsong: 2
    })));
    expect(restored).toMatchObject({
      fileHandle,
      path: '/Music/Track.flac',
      sourceFolderId: 'music-root',
      metadata: { title: 'Track' },
      rating: 4.5,
      subsong: 2
    });
    expect(Object.hasOwn(restored!, 'rating')).toBe(true);
    expect(Object.hasOwn(restored!, 'subsong')).toBe(true);
    expect(restoreStoredItem(serializeItem(item({ rating: 4.5 })))).toBeNull();
  });

  it('preserves optional runtime fields as own properties when they are absent', () => {
    const restored = restoreStoredItem(serializeItem(item({ fileHandle })));

    expect(Object.hasOwn(restored!, 'rating')).toBe(true);
    expect(Object.hasOwn(restored!, 'subsong')).toBe(true);
  });

  it('round-trips handle-backed video items', () => {
    const videoItem = item({
      name: 'Clip.webm',
      extension: 'webm',
      kind: 'video',
      fileHandle
    });

    expect(normalizeStoredItem(serializeItem(videoItem))).toMatchObject({
      name: 'Clip.webm',
      extension: 'webm',
      kind: 'video',
      fileHandle
    });
  });

  it('rejects invalid stored items and strips non-file handles', () => {
    expect(normalizeStoredItem(null)).toBeNull();
    expect(normalizeStoredItem({ id: 'x', name: 'Track.flac', extension: 'flac', kind: 'stream' })).toBeNull();

    expect(
      normalizeStoredItem({
        id: 'x',
        name: 'Track.flac',
        extension: 'flac',
        kind: 'stream',
        size: 1,
        lastModified: 'invalid',
        fileHandle: { kind: 'directory', getFile: async () => new File([], 'Track.flac') },
        path: 12,
        sourceFolderId: 34
      })
    ).toEqual({
      id: 'x',
      name: 'Track.flac',
      extension: 'flac',
      kind: 'stream',
      size: 1,
      lastModified: 0,
      fileHandle: undefined,
      path: undefined,
      sourceFolderId: undefined,
      metadata: undefined
    });
  });
});
