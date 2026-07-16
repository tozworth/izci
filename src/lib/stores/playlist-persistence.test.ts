import { describe, expect, it } from 'vitest';

import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  normalizeStoredItem,
  serializeItem
} from './playlist-persistence';
import type { PlaylistItem } from '$lib/types';

const fileHandle = {
  kind: 'file',
  getFile: async () => new File([], 'track.flac')
} as FileSystemFileHandle;

function item(overrides: Partial<PlaylistItem> = {}): PlaylistItem {
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

describe('playlist persistence helpers', () => {
  it('normalizes persisted playback options defensively', () => {
    expect(normalizePlaybackOptions({ shuffle: true, repeatMode: 'all' })).toEqual({
      shuffle: true,
      repeatMode: 'all'
    });
    expect(normalizePlaybackOptions({ shuffle: 'yes', repeatMode: 'bad' })).toEqual(defaultPlaybackOptions);
  });

  it('serializes only handle-backed playlist items', () => {
    expect(serializeItem(item())).toBeNull();
    expect(serializeItem(item({ fileHandle, path: '/Music/Track.flac', folder: 'Music', metadata: { title: 'Track' } }))).toEqual({
      id: 'track-id',
      name: 'Track.flac',
      extension: 'flac',
      kind: 'stream',
      size: 123,
      lastModified: 456,
      fileHandle,
      path: '/Music/Track.flac',
      folder: 'Music',
      metadata: { title: 'Track' }
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
        folder: 34
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
      folder: undefined,
      metadata: undefined
    });
  });
});
