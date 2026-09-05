/**
 * Cross-session IndexedDB cache for buffered Opus renders received by this
 * client. Stores compressed init/cluster bytes under the same key as the
 * in-memory client cache; a fresh manifest that fails the deep manifest
 * comparison simply re-downloads, so the cache is invisible to the wire
 * contract. Bounded by the Experimental > Cache limit, LRU-evicted, and fully
 * rebuildable by re-streaming — it never becomes part of queue/library
 * persistence.
 */

import { logDebug } from '$lib/services/logging';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import type { MultiplayerRenderManifest } from './multiplayer-protocol';
import {
  buildClientRenderCacheKey,
  renderMatchesManifest,
  type ClientCachedRender
} from './multiplayer-render-client-cache';

const DATABASE_NAME = 'izci-render-cache';
const DATABASE_VERSION = 1;
const RENDERS_STORE_NAME = 'renders';
const BLOBS_STORE_NAME = 'blobs';
const BLOBS_BY_RENDER_INDEX_NAME = 'byRender';

const INIT_BLOB_SUFFIX = ':init';

interface RenderCacheRecord {
  key: string;
  /** Best-known track name for the Options listing; may be a track id. */
  name: string;
  sizeBytes: number;
  lastUsedAt: number;
  storedAt: number;
  initSizeBytes: number;
  clusterCount: number;
  manifest: MultiplayerRenderManifest;
}

interface RenderBlobRecord {
  key: string;
  renderKey: string;
  bytes: Uint8Array;
}

export interface RenderCacheEntryInfo {
  key: string;
  name: string;
  sizeBytes: number;
  lastUsedAt: number;
  storedAt: number;
  durationMs: number;
  bitrateKbps: number;
  clusterCount: number;
}

interface RenderCacheListResult {
  entries: RenderCacheEntryInfo[];
  totalBytes: number;
  limitBytes: number;
  enabled: boolean;
}

interface RenderCacheEvictionCandidate {
  key: string;
  sizeBytes: number;
  lastUsedAt: number;
}

/**
 * Pure LRU eviction selection: returns the keys to delete so the retained
 * total stays within limitBytes. Deterministic and unit-testable.
 */
export function selectRenderEviction(
  entries: RenderCacheEvictionCandidate[],
  limitBytes: number
): string[] {
  if (limitBytes <= 0) return entries.map((entry) => entry.key);
  const sorted = [...entries].sort((left, right) => left.lastUsedAt - right.lastUsedAt);
  let retained = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const evicted: string[] = [];
  for (const entry of sorted) {
    if (retained <= limitBytes) break;
    evicted.push(entry.key);
    retained -= entry.sizeBytes;
  }
  return evicted;
}

/**
 * Pure higher-bitrate candidate selection: the complete render of the same
 * track and source revision whose bitrate is strictly above the host's current
 * one, preferring the closest bitrate so the pipeline matches the host's
 * quality intent as closely as possible. Incomplete renders are skipped: a
 * partial substitute could never finish downloading because the host is
 * rendering a different bitrate now. Deterministic and unit-testable.
 */
function selectHigherBitrateCandidate(
  records: RenderCacheRecord[],
  trackId: string,
  sourceRevision: string,
  bitrateKbps: number
): { key: string; record: RenderCacheRecord } | null {
  let best: RenderCacheRecord | null = null;
  for (const record of records) {
    const manifest = record.manifest;
    if (manifest.trackId !== trackId || manifest.sourceRevision !== sourceRevision) continue;
    if (manifest.bitrateKbps <= bitrateKbps) continue;
    if (record.clusterCount !== manifest.clusters.length) continue;
    if (!best || manifest.bitrateKbps < best.manifest.bitrateKbps) best = record;
  }
  return best ? { key: best.key, record: best } : null;
}

export function blobKey(renderKey: string, index: number): string {
  return `${renderKey}:${index}`;
}

function isInitBlobKey(renderKey: string, key: string): boolean {
  return key === `${renderKey}${INIT_BLOB_SUFFIX}`;
}

export function initBlobKey(renderKey: string): string {
  return `${renderKey}${INIT_BLOB_SUFFIX}`;
}

export function parseBlobIndex(renderKey: string, blobKeyValue: string): number | null {
  if (isInitBlobKey(renderKey, blobKeyValue)) return null;
  const suffix = blobKeyValue.slice(renderKey.length + 1);
  const index = Number(suffix);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

class MultiplayerRenderDiskCache {
  #dbPromise: Promise<IDBDatabase | null> | null = null;
  #chain: Promise<unknown> = Promise.resolve();

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(operation);
    this.#chain = run.then(() => undefined, () => undefined);
    return run;
  }

  #open(): Promise<IDBDatabase | null> {
    if (this.#dbPromise) return this.#dbPromise;
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      this.#dbPromise = Promise.resolve(null);
      return this.#dbPromise;
    }
    this.#dbPromise = new Promise((resolve) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RENDERS_STORE_NAME)) {
          database.createObjectStore(RENDERS_STORE_NAME, { keyPath: 'key' });
        }
        if (!database.objectStoreNames.contains(BLOBS_STORE_NAME)) {
          const blobs = database.createObjectStore(BLOBS_STORE_NAME, { keyPath: 'key' });
          blobs.createIndex(BLOBS_BY_RENDER_INDEX_NAME, 'renderKey');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.#dbPromise;
  }

  #settings(): { enabled: boolean; limitBytes: number } {
    const snapshot = experimentalSettings.getSnapshot();
    return {
      enabled: snapshot.multiplayerRenderDiskCacheEnabled,
      limitBytes: snapshot.multiplayerRenderDiskCacheLimitMiB * 1024 * 1024
    };
  }

  #readRecords(store: IDBObjectStore): Promise<RenderCacheRecord[]> {
    return new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result as RenderCacheRecord[]) ?? []);
      request.onerror = () => resolve([]);
    });
  }

  #readBlobKeys(store: IDBObjectStore, renderKey: string): Promise<string[]> {
    return new Promise((resolve) => {
      const index = store.index(BLOBS_BY_RENDER_INDEX_NAME);
      const request = index.openKeyCursor(IDBKeyRange.only(renderKey));
      const keys: string[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(keys);
          return;
        }
        keys.push(String(cursor.primaryKey));
        cursor.continue();
      };
      request.onerror = () => resolve(keys);
    });
  }

  #deleteRender(
    database: IDBDatabase,
    renderKey: string,
    blobKeys: string[]
  ): Promise<void> {
    return new Promise((resolve) => {
      const transaction = database.transaction(
        [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        'readwrite'
      );
      transaction.objectStore(RENDERS_STORE_NAME).delete(renderKey);
      const blobs = transaction.objectStore(BLOBS_STORE_NAME);
      for (const key of blobKeys) blobs.delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }

  /**
   * Evicts least-recently-used entries until the configured limit holds.
   * Metadata records are tiny, so the decision only reads the small store.
   */
  async #evict(database: IDBDatabase): Promise<void> {
    const { enabled, limitBytes } = this.#settings();
    if (!enabled) return;
    const records = await new Promise<RenderCacheRecord[]>((resolve) => {
      const transaction = database.transaction(RENDERS_STORE_NAME, 'readonly');
      const request = transaction.objectStore(RENDERS_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as RenderCacheRecord[]) ?? []);
      request.onerror = () => resolve([]);
      transaction.onerror = () => resolve([]);
    });
    const doomed = selectRenderEviction(
      records.map((record) => ({
        key: record.key,
        sizeBytes: record.sizeBytes,
        lastUsedAt: record.lastUsedAt
      })),
      limitBytes
    );
    if (doomed.length === 0) return;
    const doomedKeys = new Set(doomed);
    for (const renderKey of doomed) {
      // One readonly transaction per key: IDB transactions auto-commit
      // between awaits, so a shared store could go stale mid-loop.
      const blobsStore = database.transaction(BLOBS_STORE_NAME, 'readonly')
        .objectStore(BLOBS_STORE_NAME);
      const blobKeys = await this.#readBlobKeys(blobsStore, renderKey);
      await this.#deleteRender(database, renderKey, blobKeys);
    }
    const remaining = records.filter((record) => !doomedKeys.has(record.key))
      .reduce((sum, record) => sum + record.sizeBytes, 0);
    logDebug('multiplayer', 'Render disk cache evicted', {
      entries: doomed.length,
      freedBytes: records.reduce((sum, record) => sum + record.sizeBytes, 0) - remaining,
      totalBytes: remaining,
      limitBytes
    });
  }

  async #readRecord(database: IDBDatabase, key: string): Promise<RenderCacheRecord | null> {
    return await new Promise((resolve) => {
      const transaction = database.transaction(RENDERS_STORE_NAME, 'readonly');
      const request = transaction.objectStore(RENDERS_STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as RenderCacheRecord | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
  }

  async #readRender(
    database: IDBDatabase,
    key: string,
    record: RenderCacheRecord
  ): Promise<ClientCachedRender | null> {
    const blobs = await new Promise<Map<string, Uint8Array>>((resolve) => {
      const transaction = database.transaction(BLOBS_STORE_NAME, 'readonly');
      const index = transaction.objectStore(BLOBS_STORE_NAME).index(BLOBS_BY_RENDER_INDEX_NAME);
      const request = index.getAll(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const found = new Map<string, Uint8Array>();
        for (const blob of (request.result as RenderBlobRecord[]) ?? []) {
          found.set(blob.key, blob.bytes);
        }
        resolve(found);
      };
      request.onerror = () => resolve(new Map());
    });
    if (blobs.size === 0) return null;

    const init = blobs.get(initBlobKey(key));
    if (!init) return null;
    const clusters = new Map<number, Uint8Array>();
    for (const [blobKey, bytes] of blobs) {
      const index = parseBlobIndex(key, blobKey);
      if (index !== null) clusters.set(index, bytes);
    }

    // LRU recency bump, best-effort in its own transaction.
    record.lastUsedAt = Date.now();
    const touch = database.transaction(RENDERS_STORE_NAME, 'readwrite');
    touch.objectStore(RENDERS_STORE_NAME).put(record);
    return { manifest: record.manifest, init, clusters };
  }

  /**
   * Exact-key lookup first, then a complete render of the same track and
   * source revision encoded at a strictly higher bitrate than the host's
   * current choice. The higher-bitrate bytes are exactly what the host
   * previously rendered, so the client can play them instead of re-downloading
   * at the lower bitrate; the caller decides layout compatibility. Returns the
   * render together with the cache key it was stored under.
   */
  getMatching(
    trackId: string,
    sourceRevision: string,
    bitrateKbps: number
  ): Promise<{ key: string; render: ClientCachedRender } | null> {
    return this.#enqueue(async () => {
      const { enabled } = this.#settings();
      if (!enabled) return null;
      const database = await this.#open();
      if (!database) return null;

      const exactKey = buildClientRenderCacheKey(trackId, sourceRevision, bitrateKbps);
      const exactRecord = await this.#readRecord(database, exactKey);
      if (exactRecord) {
        const render = await this.#readRender(database, exactKey, exactRecord);
        if (render) {
          logDebug('multiplayer', 'Render disk cache hit', {
            key: exactKey,
            clusters: render.clusters.size,
            bytes: exactRecord.sizeBytes
          });
          return { key: exactKey, render };
        }
      }

      const records = await this.#readRecords(
        database.transaction(RENDERS_STORE_NAME, 'readonly').objectStore(RENDERS_STORE_NAME)
      );
      const candidate = selectHigherBitrateCandidate(
        records,
        trackId,
        sourceRevision,
        bitrateKbps
      );
      if (!candidate) return null;
      const render = await this.#readRender(database, candidate.key, candidate.record);
      if (!render) return null;
      logDebug('multiplayer', 'Render disk cache higher-bitrate hit', {
        key: candidate.key,
        cachedBitrate: candidate.record.manifest.bitrateKbps,
        hostBitrate: bitrateKbps,
        clusters: render.clusters.size,
        bytes: candidate.record.sizeBytes
      });
      return { key: candidate.key, render };
    });
  }

  put(entry: {
    key: string;
    name: string;
    manifest: MultiplayerRenderManifest;
    init: Uint8Array;
    clusters: Map<number, Uint8Array>;
  }): Promise<void> {
    return this.#enqueue(async () => {
      const { enabled } = this.#settings();
      if (!enabled || entry.clusters.size === 0) return;
      const database = await this.#open();
      if (!database) return;

      const now = Date.now();
      let sizeBytes = entry.init.byteLength;
      for (const bytes of entry.clusters.values()) sizeBytes += bytes.byteLength;

      // Read phase (readonly): the existing record and its blob keys decide
      // merge-vs-replace before the write transaction opens.
      const existing = await new Promise<RenderCacheRecord | null>((resolve) => {
        const transaction = database.transaction(RENDERS_STORE_NAME, 'readonly');
        const request = transaction.objectStore(RENDERS_STORE_NAME).get(entry.key);
        request.onsuccess = () => resolve((request.result as RenderCacheRecord | undefined) ?? null);
        request.onerror = () => resolve(null);
      });
      const existingBlobKeys = existing
        ? await this.#readBlobKeys(
          database.transaction(BLOBS_STORE_NAME, 'readonly').objectStore(BLOBS_STORE_NAME),
          entry.key
        )
        : [];

      const existingIndices = new Set<number>();
      for (const blobKey of existingBlobKeys) {
        const index = parseBlobIndex(entry.key, blobKey);
        if (index !== null) existingIndices.add(index);
      }

      let addedBytes = 0;
      let addedCount = 0;
      const matches = existing !== null && renderMatchesManifest(
        { manifest: existing.manifest, init: entry.init, clusters: entry.clusters },
        entry.manifest
      );
      if (matches) {
        // Union merge: keep old cluster blobs, add or overwrite fresh ones.
        for (const [index, bytes] of entry.clusters) {
          if (!existingIndices.has(index)) {
            addedBytes += bytes.byteLength;
            addedCount += 1;
          }
        }
        sizeBytes = existing!.sizeBytes + addedBytes;
      }

      const record: RenderCacheRecord = {
        key: entry.key,
        name: entry.name || entry.key,
        sizeBytes,
        lastUsedAt: now,
        storedAt: existing?.storedAt ?? now,
        initSizeBytes: entry.init.byteLength,
        clusterCount: matches
          ? existing!.clusterCount + addedCount
          : entry.clusters.size,
        manifest: { ...entry.manifest }
      };

      const transaction = database.transaction(
        [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        'readwrite'
      );
      const renders = transaction.objectStore(RENDERS_STORE_NAME);
      const blobs = transaction.objectStore(BLOBS_STORE_NAME);
      if (!matches) {
        // New or superseded entry: replace any stale blobs wholesale.
        for (const blobKey of existingBlobKeys) blobs.delete(blobKey);
      }
      blobs.put({ key: initBlobKey(entry.key), renderKey: entry.key, bytes: entry.init });
      for (const [index, bytes] of entry.clusters) {
        blobs.put({ key: blobKey(entry.key, index), renderKey: entry.key, bytes });
      }
      renders.put(record);

      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
      await this.#evict(database);
    });
  }

  remove(key: string): Promise<void> {
    return this.#enqueue(async () => {
      const database = await this.#open();
      if (!database) return;
      const blobsStore = database.transaction(BLOBS_STORE_NAME, 'readonly')
        .objectStore(BLOBS_STORE_NAME);
      const blobKeys = await this.#readBlobKeys(blobsStore, key);
      await this.#deleteRender(database, key, blobKeys);
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      const database = await this.#open();
      if (!database) return;
      const transaction = database.transaction(
        [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        'readwrite'
      );
      transaction.objectStore(RENDERS_STORE_NAME).clear();
      transaction.objectStore(BLOBS_STORE_NAME).clear();
      await new Promise<void>((resolve) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      });
    });
  }

  list(): Promise<RenderCacheListResult> {
    return this.#enqueue(async () => {
      const database = await this.#open();
      const { enabled, limitBytes } = this.#settings();
      if (!database) {
        return { entries: [], totalBytes: 0, limitBytes, enabled };
      }
      const records = await this.#readRecords(
        database.transaction(RENDERS_STORE_NAME, 'readonly').objectStore(RENDERS_STORE_NAME)
      );
      records.sort((left, right) => right.lastUsedAt - left.lastUsedAt);
      return {
        entries: records.map((record) => ({
          key: record.key,
          name: record.name,
          sizeBytes: record.sizeBytes,
          lastUsedAt: record.lastUsedAt,
          storedAt: record.storedAt,
          durationMs: record.manifest.durationMs,
          bitrateKbps: record.manifest.bitrateKbps,
          clusterCount: record.clusterCount
        })),
        totalBytes: records.reduce((sum, record) => sum + record.sizeBytes, 0),
        limitBytes,
        enabled
      };
    });
  }

  enforceLimit(): Promise<void> {
    return this.#enqueue(async () => {
      const database = await this.#open();
      if (!database) return;
      await this.#evict(database);
    });
  }
}

export const multiplayerRenderDiskCache = new MultiplayerRenderDiskCache();

if (typeof window !== 'undefined') {
  experimentalSettings.subscribe(() => {
    if (!experimentalSettings.getSnapshot().multiplayerRenderDiskCacheEnabled) return;
    void multiplayerRenderDiskCache.enforceLimit();
  });
}
