import { describe, expect, it } from 'vitest';
import { blobKey, initBlobKey, parseBlobIndex, selectRenderEviction } from './multiplayer-render-disk-cache';

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
