import { describe, expect, it } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  normalizeStoredItem,
  restoreStoredItem,
  serializeItem
} from './playlist-persistence';

function item(overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id: 'track-id',
    path: 'Music/Track.flac',
    name: 'Track.flac',
    format: 'flac',
    kind: 'stream',
    size: 123,
    lastModified: 456,
    ...overrides
  };
}

describe('playlist persistence helpers', () => {
  it('normalizes persisted playback options defensively', () => {
    expect(normalizePlaybackOptions({ shuffle: true, repeatMode: 'all' })).toEqual({ shuffle: true, repeatMode: 'all' });
    expect(normalizePlaybackOptions({ shuffle: 'yes', repeatMode: 'bad' })).toEqual(defaultPlaybackOptions);
  });

  it('serializes only durable entity facts', () => {
    const source = item({ sourceFolderId: 'music-root', metadata: { title: 'Track' }, rating: 3.6 });
    expect(serializeItem(source)).toEqual({
      ...source,
      rating: 3.5
    });
    expect(JSON.stringify(serializeItem(source))).not.toMatch(/file|handle|objectUrl/i);
  });

  it('projects bounded metadata during serialization and hydration', () => {
    const hostileMetadata = {
      title: 'Track',
      duration: Number.POSITIVE_INFINITY,
      artwork: { data: 'embedded-image-payload' },
      lyrics: { text: 'transient lyrics' },
      replayGain: { trackGainDb: -2, blob: { type: 'application/octet-stream' } }
    } as unknown as NonNullable<MediaEntity['metadata']>;
    const serialized = serializeItem(item({ metadata: hostileMetadata }));
    const hydrated = normalizeStoredItem({ ...serialized, metadata: hostileMetadata });

    expect(serialized.metadata).toEqual({ title: 'Track', replayGain: { trackGainDb: -2 } });
    expect(hydrated?.metadata).toEqual({ title: 'Track', replayGain: { trackGainDb: -2 } });
    expect(JSON.stringify([serialized, hydrated])).not.toMatch(/artwork|lyrics|blob|payload/);
  });

  it('round-trips subsongs and normalized ratings', () => {
    const stored = serializeItem(item({ kind: 'module', format: 'xm', subsong: 2, rating: 4.5 }));
    expect(restoreStoredItem(stored)).toMatchObject({ format: 'xm', subsong: 2, rating: 4.5 });
    expect(normalizeStoredItem({ ...stored, subsong: -1 })).not.toHaveProperty('subsong');
  });

  it('rejects missing required canonical facts and hostile legacy rows', () => {
    expect(normalizeStoredItem(null)).toBeNull();
    expect(normalizeStoredItem({ id: 'x', name: 'Track.flac', format: 'flac', kind: 'stream', size: 1 })).toBeNull();
    expect(normalizeStoredItem({
      ...serializeItem(item()),
      file: new File([], 'Track.flac'),
      fileHandle: { kind: 'file' },
      objectUrl: 'blob:hostile'
    })).toEqual(serializeItem(item()));
  });
});
