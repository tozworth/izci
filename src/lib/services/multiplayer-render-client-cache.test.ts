import { describe, expect, it } from 'vitest';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import {
  MultiplayerRenderClientCache,
  buildClientRenderCacheKey,
  renderLayoutMatches,
  renderMatchesManifest,
  type ClientCachedRender
} from './multiplayer-render-client-cache';

function manifest(partial: Partial<MultiplayerRenderManifest> = {}): MultiplayerRenderManifest {
  return {
    generationId: 'gen-1',
    renderId: 'render-1',
    trackId: 'track-1',
    sourceRevision: '2:100:200:0',
    codec: 'opus',
    container: 'webm',
    durationMs: 120_000,
    bitrateKbps: 192,
    clusterDurationMs: 1_000,
    clusters: [
      { index: 0, timeMs: 0, sizeBytes: 100 },
      { index: 1, timeMs: 1_000, sizeBytes: 110 },
      { index: 2, timeMs: 2_000, sizeBytes: 120 }
    ],
    initSizeBytes: 200,
    totalBytes: 530,
    ...partial
  };
}

function render(partial: Partial<MultiplayerRenderManifest> = {}): ClientCachedRender {
  const m = manifest(partial);
  return {
    manifest: m,
    init: new Uint8Array(m.initSizeBytes),
    clusters: new Map(m.clusters.map((cluster) => [cluster.index, new Uint8Array(cluster.sizeBytes)]))
  };
}

describe('buildClientRenderCacheKey', () => {
  it('keys on track id, source revision, and bitrate', () => {
    expect(buildClientRenderCacheKey('track-1', '2:100:200:0', 192)).toBe(
      'track-1:2:100:200:0:192'
    );
    expect(buildClientRenderCacheKey('track-1', '2:100:201:0', 192)).not.toBe(
      buildClientRenderCacheKey('track-1', '2:100:200:0', 192)
    );
    expect(buildClientRenderCacheKey('track-1', '2:100:200:0', 256)).not.toBe(
      buildClientRenderCacheKey('track-1', '2:100:200:0', 192)
    );
  });
});

describe('renderMatchesManifest', () => {
  it('matches a structurally identical render', () => {
    expect(renderMatchesManifest(render(), manifest())).toBe(true);
  });

  it('mismatches when the track or render changed', () => {
    expect(renderMatchesManifest(render(), manifest({ durationMs: 121_000 }))).toBe(false);
    expect(renderMatchesManifest(render(), manifest({ sourceRevision: '2:100:201:0' }))).toBe(false);
    expect(renderMatchesManifest(render(), manifest({ bitrateKbps: 256 }))).toBe(false);
    expect(renderMatchesManifest(render(), manifest({ clusterDurationMs: 500 }))).toBe(false);
    expect(renderMatchesManifest(render(), manifest({ initSizeBytes: 250 }))).toBe(false);
  });

  it('mismatches when the cluster timeline differs', () => {
    expect(renderMatchesManifest(
      render(),
      manifest({ clusters: manifest().clusters.slice(0, 2) })
    )).toBe(false);
    expect(renderMatchesManifest(
      render(),
      manifest({ clusters: [{ index: 0, timeMs: 0, sizeBytes: 101 }, ...manifest().clusters.slice(1)] })
    )).toBe(false);
    expect(renderMatchesManifest(
      render(),
      manifest({ clusters: [{ index: 0, timeMs: 10, sizeBytes: 100 }, ...manifest().clusters.slice(1)] })
    )).toBe(false);
  });
});

describe('renderLayoutMatches', () => {
  it('matches identical layouts even when the bitrate differs', () => {
    expect(renderLayoutMatches(manifest(), manifest({ bitrateKbps: 256 }))).toBe(true);
  });

  it('mismatches when duration or cluster timeline differ', () => {
    expect(renderLayoutMatches(manifest(), manifest({ durationMs: 121_000 }))).toBe(false);
    expect(renderLayoutMatches(manifest(), manifest({ clusterDurationMs: 500 }))).toBe(false);
    expect(renderLayoutMatches(
      manifest(),
      manifest({ clusters: manifest().clusters.slice(0, 2) })
    )).toBe(false);
    expect(renderLayoutMatches(
      manifest(),
      manifest({ clusters: [{ index: 0, timeMs: 10, sizeBytes: 100 }, ...manifest().clusters.slice(1)] })
    )).toBe(false);
  });
});

describe('findHigherBitrate', () => {
  it('finds a complete higher-bitrate render of the same track and revision', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    cache.put('track-1:2:100:200:0:256', render({ bitrateKbps: 256 }));
    const found = cache.findHigherBitrate('track-1', '2:100:200:0', 192);
    expect(found).not.toBeNull();
    expect(found!.manifest.bitrateKbps).toBe(256);
  });

  it('prefers the closest bitrate above the host choice', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    cache.put('track-1:2:100:200:0:256', render({ bitrateKbps: 256 }));
    cache.put('track-1:2:100:200:0:320', render({ bitrateKbps: 320 }));
    const found = cache.findHigherBitrate('track-1', '2:100:200:0', 192);
    expect(found!.manifest.bitrateKbps).toBe(256);
  });

  it('ignores equal and lower bitrates', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    cache.put('track-1:2:100:200:0:192', render({ bitrateKbps: 192 }));
    cache.put('track-1:2:100:200:0:128', render({ bitrateKbps: 128 }));
    expect(cache.findHigherBitrate('track-1', '2:100:200:0', 192)).toBeNull();
  });

  it('ignores incomplete renders and other tracks or revisions', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    const partial = render({ bitrateKbps: 256 });
    partial.clusters = new Map([[0, partial.clusters.get(0)!]]);
    cache.put('track-1:2:100:200:0:256', partial);
    cache.put('track-1:2:100:201:0:256', render({ bitrateKbps: 256, sourceRevision: '2:100:201:0' }));
    cache.put('track-2:2:100:200:0:256', render({ bitrateKbps: 256, trackId: 'track-2' }));
    expect(cache.findHigherBitrate('track-1', '2:100:200:0', 192)).toBeNull();
  });

  it('a hit promotes the entry so it survives the next eviction', () => {
    const cache = new MultiplayerRenderClientCache(1_400);
    cache.put('track-1:2:100:200:0:256', render({ bitrateKbps: 256 }));
    cache.put('other:2:1:1:0:192', render({ trackId: 'other', sourceRevision: '2:1:1:0' }));
    cache.findHigherBitrate('track-1', '2:100:200:0', 192);
    cache.put('third:2:2:2:0:192', render({ trackId: 'third', sourceRevision: '2:2:2:0' }));
    expect(cache.get('track-1:2:100:200:0:256')).not.toBeNull();
    expect(cache.get('other:2:1:1:0:192')).toBeNull();
  });
});

describe('MultiplayerRenderClientCache', () => {
  it('round-trips an entry and accounts bytes', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    cache.put('track-1:192', render());
    expect(cache.entryCount).toBe(1);
    expect(cache.sizeBytes).toBe(530);
    const entry = cache.get('track-1:192');
    expect(entry).not.toBeNull();
    expect(entry!.clusters.size).toBe(3);
  });

  it('evicts the least recently used entry under the byte bound', () => {
    const cache = new MultiplayerRenderClientCache(1_200);
    cache.put('a:192', render());
    cache.put('b:192', render());
    cache.put('c:192', render());
    expect(cache.entryCount).toBe(2);
    expect(cache.get('a:192')).toBeNull();
    expect(cache.get('b:192')).not.toBeNull();
    expect(cache.get('c:192')).not.toBeNull();
  });

  it('get promotes an entry so it survives the next eviction', () => {
    const cache = new MultiplayerRenderClientCache(1_200);
    cache.put('a:192', render());
    cache.put('b:192', render());
    cache.get('a:192');
    cache.put('c:192', render());
    expect(cache.get('a:192')).not.toBeNull();
    expect(cache.get('b:192')).toBeNull();
    expect(cache.get('c:192')).not.toBeNull();
  });

  it('keeps the richer entry when a subset of the same render is cached', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    const full = render();
    cache.put('track-1:192', full);
    const partial = render();
    partial.clusters = new Map([[0, partial.clusters.get(0)!]]);
    cache.put('track-1:192', partial);
    const entry = cache.get('track-1:192')!;
    expect(entry.clusters.size).toBe(3);
    expect(entry.clusters.get(2)).toBe(full.clusters.get(2));
  });

  it('replaces the entry when the render structure changed', () => {
    const cache = new MultiplayerRenderClientCache(10_000);
    cache.put('track-1:192', render());
    const changed = render({ durationMs: 130_000 });
    cache.put('track-1:192', changed);
    const entry = cache.get('track-1:192')!;
    expect(entry.manifest.durationMs).toBe(130_000);
  });
});
