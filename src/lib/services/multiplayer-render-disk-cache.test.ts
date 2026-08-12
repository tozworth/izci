import { describe, expect, it } from 'vitest';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import {
  blobKey,
  initBlobKey,
  parseBlobIndex,
  selectHigherBitrateCandidate,
  selectRenderEviction,
  type RenderCacheRecord
} from './multiplayer-render-disk-cache';

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

function record(key: string, m: MultiplayerRenderManifest, clusterCount?: number): RenderCacheRecord {
  return {
    key,
    name: key,
    sizeBytes: m.totalBytes,
    lastUsedAt: 1,
    storedAt: 1,
    initSizeBytes: m.initSizeBytes,
    clusterCount: clusterCount ?? m.clusters.length,
    manifest: m
  };
}

describe('selectRenderEviction', () => {
  it('keeps everything when the total stays under the limit', () => {
    const entries = [
      { key: 'a', sizeBytes: 100, lastUsedAt: 1 },
      { key: 'b', sizeBytes: 100, lastUsedAt: 2 }
    ];
    expect(selectRenderEviction(entries, 300)).toEqual([]);
  });

  it('evicts least-recently-used entries until the limit holds', () => {
    const entries = [
      { key: 'a', sizeBytes: 400, lastUsedAt: 1 },
      { key: 'b', sizeBytes: 300, lastUsedAt: 2 },
      { key: 'c', sizeBytes: 200, lastUsedAt: 3 }
    ];
    // Total 900, limit 500: dropping a (400) leaves exactly 500.
    expect(selectRenderEviction(entries, 500)).toEqual(['a']);
  });

  it('evicts multiple entries when one is not enough', () => {
    const entries = [
      { key: 'a', sizeBytes: 400, lastUsedAt: 1 },
      { key: 'b', sizeBytes: 400, lastUsedAt: 2 },
      { key: 'c', sizeBytes: 400, lastUsedAt: 3 }
    ];
    expect(selectRenderEviction(entries, 700)).toEqual(['a', 'b']);
  });

  it('evicts everything when the limit is zero or negative', () => {
    const entries = [
      { key: 'a', sizeBytes: 10, lastUsedAt: 1 },
      { key: 'b', sizeBytes: 10, lastUsedAt: 2 }
    ];
    expect(selectRenderEviction(entries, 0)).toEqual(['a', 'b']);
    expect(selectRenderEviction(entries, -1)).toEqual(['a', 'b']);
  });

  it('handles an empty entry set', () => {
    expect(selectRenderEviction([], 100)).toEqual([]);
  });
});

describe('selectHigherBitrateCandidate', () => {
  it('picks the complete closest higher-bitrate render of the same track', () => {
    const records = [
      record('track-1:2:100:200:0:128', manifest({ bitrateKbps: 128 })),
      record('track-1:2:100:200:0:256', manifest({ bitrateKbps: 256 })),
      record('track-1:2:100:200:0:320', manifest({ bitrateKbps: 320 }))
    ];
    const found = selectHigherBitrateCandidate(records, 'track-1', '2:100:200:0', 192);
    expect(found?.key).toBe('track-1:2:100:200:0:256');
  });

  it('returns null when nothing is cached above the host bitrate', () => {
    const records = [
      record('track-1:2:100:200:0:128', manifest({ bitrateKbps: 128 })),
      record('track-1:2:100:200:0:192', manifest({ bitrateKbps: 192 }))
    ];
    expect(selectHigherBitrateCandidate(records, 'track-1', '2:100:200:0', 192)).toBeNull();
  });

  it('skips incomplete renders and other tracks or revisions', () => {
    const records = [
      record('track-1:2:100:200:0:256', manifest({ bitrateKbps: 256 }), 2),
      record('track-1:2:100:201:0:256', manifest({ bitrateKbps: 256, sourceRevision: '2:100:201:0' })),
      record('track-2:2:100:200:0:256', manifest({ bitrateKbps: 256, trackId: 'track-2' }))
    ];
    expect(selectHigherBitrateCandidate(records, 'track-1', '2:100:200:0', 192)).toBeNull();
  });

  it('handles an empty record set', () => {
    expect(selectHigherBitrateCandidate([], 'track-1', '2:100:200:0', 192)).toBeNull();
  });
});

describe('render blob key scheme', () => {
  it('parses cluster indices and rejects the init blob', () => {
    const key = 'track-1:2:100:200:0:128';
    expect(parseBlobIndex(key, initBlobKey(key))).toBeNull();
    expect(parseBlobIndex(key, blobKey(key, 0))).toBe(0);
    expect(parseBlobIndex(key, blobKey(key, 17))).toBe(17);
  });

  it('rejects malformed suffixes', () => {
    const key = 'track-1:2:100:200:0:128';
    expect(parseBlobIndex(key, `${key}:x`)).toBeNull();
    expect(parseBlobIndex(key, `${key}:-1`)).toBeNull();
  });
});
