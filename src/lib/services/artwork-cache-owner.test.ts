import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheHarness = vi.hoisted(() => ({
  stores: new Map<string, Map<string, Record<string, unknown>>>(),
  owner: null as null | {
    label: string;
    flush?: () => void | Promise<void>;
    dispose: () => void | Promise<void>;
  }
}));

vi.mock('$lib/persistence/browser-indexed-db', () => ({
  openBrowserDatabase: vi.fn(async () => ({
    close: vi.fn(async () => undefined)
  })),
  registerBrowserPersistenceOwner: vi.fn((owner) => {
    cacheHarness.owner = owner;
    return () => undefined;
  })
}));

vi.mock('$lib/persistence/indexed-db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/persistence/indexed-db')>();
  return {
    ...actual,
    runTransaction: vi.fn(async (
      _connection: unknown,
      _options: unknown,
      work: (transaction: { store(name: string): unknown }) => Promise<unknown>
    ) => work({
      store(name: string) {
        let records = cacheHarness.stores.get(name);
        if (!records) {
          records = new Map();
          cacheHarness.stores.set(name, records);
        }
        return {
          get: async (key: string) => records?.get(key),
          getAll: async () => [...(records?.values() ?? [])],
          put: async (value: Record<string, unknown>) => {
            const key = String(value.sourceKey ?? value.key);
            records?.set(key, structuredClone(value));
            return key;
          },
          delete: async (key: string) => {
            records?.delete(key);
          },
          clear: async () => {
            records?.clear();
          }
        };
      }
    }))
  };
});

import {
  MAX_ARTWORK_NEGATIVE_SOURCE_RECORDS,
  MAX_ARTWORK_RENDITION_BYTES,
  MAX_ARTWORK_SOURCE_RECORDS,
  artworkCacheInventory,
  artworkCachePersistenceStatus,
  clearArtworkCache,
  disposeArtworkCache,
  refreshArtworkCacheInventory
} from './artwork-cache';

function seedStore(name: string, records: Record<string, unknown>[]): void {
  cacheHarness.stores.set(name, new Map(records.map((record) => [
    String(record.sourceKey ?? record.key),
    record
  ])));
}

describe('artwork cache owner', () => {
  beforeEach(() => {
    cacheHarness.stores.clear();
  });

  it('repairs oversized source, negative, and rendition stores in one bounded transaction', async () => {
    const negativeOverflow = 2;
    const sources = Array.from(
      { length: MAX_ARTWORK_SOURCE_RECORDS + negativeOverflow },
      (_, index) => ({
        sourceKey: `source-${String(index).padStart(5, '0')}`,
        fingerprint: `fingerprint-${index}`,
        assetId: index < MAX_ARTWORK_NEGATIVE_SOURCE_RECORDS + negativeOverflow
          ? null
          : `asset-${index}`,
        checkedAt: index
      })
    );
    const mebibyte = 1024 * 1024;
    const renditions = Array.from({ length: MAX_ARTWORK_RENDITION_BYTES / mebibyte + 1 }, (_, index) => ({
      key: `rendition-${String(index).padStart(2, '0')}`,
      assetId: `rendition-asset-${index}`,
      maxEdge: 96,
      blob: new Blob(),
      width: 96,
      height: 96,
      byteSize: mebibyte,
      lastAccessed: index
    }));
    seedStore('sources', sources);
    seedStore('renditions', renditions);

    await expect(refreshArtworkCacheInventory()).resolves.toMatchObject({
      sourceCount: MAX_ARTWORK_SOURCE_RECORDS,
      negativeSourceCount: MAX_ARTWORK_NEGATIVE_SOURCE_RECORDS,
      renditionCount: renditions.length - 1,
      totalBytes: MAX_ARTWORK_RENDITION_BYTES
    });
    expect(cacheHarness.stores.get('sources')?.has('source-00000')).toBe(false);
    expect(cacheHarness.stores.get('sources')?.has('source-00001')).toBe(false);
    expect(cacheHarness.stores.get('renditions')?.has('rendition-00')).toBe(false);
  });

  it('shares an observable inventory and clears source facts and rendition blobs atomically', async () => {
    seedStore('sources', [
      { sourceKey: 'track', fingerprint: 'fingerprint', assetId: 'cover', checkedAt: 10 },
      { sourceKey: 'missing', fingerprint: 'missing-fingerprint', assetId: null, checkedAt: 20 }
    ]);
    seedStore('renditions', [{
      key: 'cover:96:v1',
      assetId: 'cover',
      maxEdge: 96,
      blob: new Blob(['cover']),
      width: 96,
      height: 96,
      byteSize: 5,
      lastAccessed: 30
    }]);

    await expect(refreshArtworkCacheInventory()).resolves.toMatchObject({
      sourceCount: 2,
      negativeSourceCount: 1,
      renditionCount: 1,
      totalBytes: 5
    });
    expect(get(artworkCacheInventory)).toMatchObject({
      sourceCount: 2,
      negativeSourceCount: 1,
      renditionCount: 1,
      totalBytes: 5
    });

    await clearArtworkCache();

    expect(cacheHarness.stores.get('sources')?.size).toBe(0);
    expect(cacheHarness.stores.get('renditions')?.size).toBe(0);
    expect(get(artworkCacheInventory)).toMatchObject({
      sourceCount: 0,
      negativeSourceCount: 0,
      renditionCount: 0,
      totalBytes: 0
    });
    expect(get(artworkCachePersistenceStatus)).toEqual({ state: 'ready', error: null });
  });

  it('registers flush and idempotent disposal with the shared persistence lifecycle', async () => {
    expect(cacheHarness.owner?.label).toBe('artwork cache');
    await cacheHarness.owner?.flush?.();
    await cacheHarness.owner?.dispose();
    await expect(disposeArtworkCache()).resolves.toBeUndefined();
  });
});
