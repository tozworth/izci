import { describe, expect, it } from 'vitest';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import {
  MultiplayerRenderCache,
  buildRenderCacheKey,
  buildRenderSourceRevision,
  type CachedRender
} from './multiplayer-render-cache';

function render(sizeBytes: number): CachedRender {
  const manifest = {
    generationId: 'unassigned',
    renderId: 'render-1',
    trackId: 'track-1',
    sourceRevision: '2:100:200:0',
    codec: 'opus',
    container: 'webm',
    durationMs: 1_000,
    bitrateKbps: 128,
    clusterDurationMs: 1_000,
    clusters: [],
    initSizeBytes: 0,
    totalBytes: sizeBytes
  } satisfies MultiplayerRenderManifest;
  return {
    renderId: manifest.renderId,
    manifest,
    init: new ArrayBuffer(0),
    clusters: [],
    sizeBytes
  };
}

describe('MultiplayerRenderCache', () => {
  it('keeps an oversized render while it is initially pinned', () => {
    const cache = new MultiplayerRenderCache(10);
    cache.put('active', render(20), 1);
    expect(cache.get('active')).not.toBeNull();
    cache.unpin('active');
    expect(cache.get('active')).toBeNull();
  });

  it('evicts an unpinned insertion behind active entries', () => {
    const cache = new MultiplayerRenderCache(20);
    cache.put('active', render(15), 1);
    cache.put('extra', render(10));
    expect(cache.get('active')).not.toBeNull();
    expect(cache.get('extra')).toBeNull();
  });
});

describe('render source identity', () => {
  const track = { path: 'folder/song.flac', name: 'song.flac', size: 100, lastModified: 200 };

  it('changes when persisted source identity changes', () => {
    expect(buildRenderSourceRevision(track)).not.toBe(
      buildRenderSourceRevision({ ...track, lastModified: 201 })
    );
  });

  it('keeps the source path in the host-only cache key', () => {
    expect(buildRenderCacheKey(track, 128)).not.toBe(
      buildRenderCacheKey({ ...track, path: 'other/song.flac' }, 128)
    );
  });
});
