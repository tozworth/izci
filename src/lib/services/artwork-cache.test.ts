import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { MediaEntity } from '$lib/contracts/catalog';
import {
  artworkCachePersistenceStatus,
  createArtworkCacheInventory,
  fitArtworkRenditionSize,
  getCachedArtworkThumbnail,
  getArtworkRenditionKey,
  getArtworkSourceFingerprint,
  selectArtworkRenditionEvictions,
  selectArtworkSourceEvictions
} from './artwork-cache';

function item(overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id: 'track',
    path: 'test',
    name: 'Track.flac',
    format: 'flac',
    kind: 'stream',
    size: 1234,
    lastModified: 5678,
    ...overrides
  };
}

describe('artwork cache helpers', () => {
  it('fits renditions within the requested edge without upscaling', () => {
    expect(fitArtworkRenditionSize(1200, 600, 96)).toEqual({ width: 96, height: 48 });
    expect(fitArtworkRenditionSize(48, 24, 96)).toEqual({ width: 48, height: 24 });
    expect(fitArtworkRenditionSize(0, 24, 96)).toEqual({ width: 0, height: 0 });
  });

  it('changes the source fingerprint when file content indicators change', () => {
    const original = getArtworkSourceFingerprint(item());

    expect(getArtworkSourceFingerprint(item({ size: 1235 }))).not.toBe(original);
    expect(getArtworkSourceFingerprint(item({ lastModified: 5679 }))).not.toBe(original);
    expect(getArtworkSourceFingerprint(item({ format: 'opus' }))).not.toBe(original);
  });

  it('keeps rendition size in the cache key', () => {
    expect(getArtworkRenditionKey('asset', 96)).not.toBe(getArtworkRenditionKey('asset', 512));
  });

  it('bounds negative source facts before applying the total source bound', () => {
    const sources = [
      { sourceKey: 'negative-old', assetId: null, checkedAt: 1 },
      { sourceKey: 'positive-old', assetId: 'cover-old', checkedAt: 2 },
      { sourceKey: 'negative-new', assetId: null, checkedAt: 3 },
      { sourceKey: 'positive-new', assetId: 'cover-new', checkedAt: 4 }
    ];

    expect(selectArtworkSourceEvictions(sources, 3, 1)).toEqual(['negative-old']);
    expect(selectArtworkSourceEvictions(sources, 2, 2)).toEqual([
      'negative-old',
      'positive-old'
    ]);
  });

  it('evicts rendition bytes in deterministic least-recently-used order', () => {
    expect(selectArtworkRenditionEvictions([
      { key: 'new', byteSize: 4, lastAccessed: 3 },
      { key: 'old-b', byteSize: 4, lastAccessed: 1 },
      { key: 'old-a', byteSize: 4, lastAccessed: 1 }
    ], 5)).toEqual(['old-a', 'old-b']);
  });

  it('projects source, negative, reference, and byte totals through one inventory', () => {
    const snapshot = createArtworkCacheInventory([
      { sourceKey: 'second', fingerprint: 'two', assetId: null, checkedAt: 20 },
      { sourceKey: 'first', fingerprint: 'one', assetId: 'cover', checkedAt: 10 }
    ], [{
      key: 'cover:96',
      assetId: 'cover',
      maxEdge: 96,
      blob: new Blob(['art']),
      width: 96,
      height: 48,
      byteSize: 3,
      lastAccessed: 30
    }]);

    expect(snapshot.sources.map((source) => source.sourceKey)).toEqual(['second', 'first']);
    expect(snapshot.renditions[0]).toMatchObject({ sizeBytes: 3, sourceReferences: 1 });
    expect(snapshot).toMatchObject({
      sourceCount: 2,
      negativeSourceCount: 1,
      renditionCount: 1,
      totalBytes: 3
    });
  });

  it('exposes unavailable persistence while degrading a rebuildable lookup to no artwork', async () => {
    await expect(getCachedArtworkThumbnail(item())).resolves.toBeNull();
    expect(get(artworkCachePersistenceStatus).state).toBe('degraded');
  });
});
