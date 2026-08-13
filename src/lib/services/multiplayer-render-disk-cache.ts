/**
 * Cross-session IndexedDB cache for buffered Opus renders received by this
 * client. Stores compressed init/cluster bytes under the same key as the
 * in-memory client cache; a fresh manifest that fails the deep manifest
 * comparison simply re-downloads, so the cache is invisible to the wire
 * contract. Bounded by the Experimental > Cache limit, LRU-evicted, and fully
 * rebuildable by re-streaming — it never becomes part of playlist/library
 * persistence.
 */

import { logDebug, logWarning } from '$lib/logging/api';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { readable, writable, type Readable } from 'svelte/store';
import {
  openBrowserDatabase,
  registerBrowserPersistenceOwner
} from '$lib/persistence/browser-indexed-db';
import {
  defineDatabase,
  defineIndex,
  defineStore,
  runTransaction,
  type DatabaseConnection
} from '$lib/persistence/indexed-db';
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

export interface RenderCacheRecord {
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

const renderCacheDatabaseSpec = defineDatabase({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: {
    [RENDERS_STORE_NAME]: defineStore<RenderCacheRecord, string>()({ keyPath: 'key' }),
    [BLOBS_STORE_NAME]: defineStore<RenderBlobRecord, string>()({
      keyPath: 'key',
      indexes: {
        [BLOBS_BY_RENDER_INDEX_NAME]: defineIndex<string>({ keyPath: 'renderKey' })
      }
    })
  }
});

type RenderCacheConnection = DatabaseConnection<typeof renderCacheDatabaseSpec>;

export interface RenderCachePersistenceStatus {
  state: 'ready' | 'busy' | 'degraded' | 'closed';
  error: unknown | null;
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

export interface RenderCacheListResult {
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
export function selectHigherBitrateCandidate(
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

export class MultiplayerRenderDiskCache {
  #connectionPromise: Promise<RenderCacheConnection> | null = null;
  #chain: Promise<unknown> = Promise.resolve();
  #closed = false;
  #status = writable<RenderCachePersistenceStatus>({ state: 'ready', error: null });

  readonly persistenceStatus: Readable<RenderCachePersistenceStatus> = readable<RenderCachePersistenceStatus>(
    { state: 'ready', error: null },
    (set) => this.#status.subscribe(set)
  );

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(async () => {
      if (this.#closed) throw new Error('The render disk cache is closed.');
      this.#status.set({ state: 'busy', error: null });
      try {
        const result = await operation();
        this.#status.set({ state: 'ready', error: null });
        return result;
      } catch (error) {
        this.#status.set({ state: 'degraded', error });
        logWarning('multiplayer', 'Render disk cache persistence failed', { error });
        throw error;
      }
    });
    this.#chain = run.then(() => undefined, () => undefined);
    return run;
  }

  async #open(): Promise<RenderCacheConnection> {
    if (this.#connectionPromise) {
      const current = await this.#connectionPromise;
      if (current.state().status === 'open') return current;
      this.#connectionPromise = null;
    }
    this.#connectionPromise = openBrowserDatabase(renderCacheDatabaseSpec)
      .catch((error) => {
        this.#connectionPromise = null;
        throw error;
      });
    return this.#connectionPromise;
  }

  #settings(): { enabled: boolean; limitBytes: number } {
    const snapshot = experimentalSettings.getSnapshot();
    return {
      enabled: snapshot.multiplayerRenderDiskCacheEnabled,
      limitBytes: snapshot.multiplayerRenderDiskCacheLimitMiB * 1024 * 1024
    };
  }

  #readRecords(connection: RenderCacheConnection): Promise<RenderCacheRecord[]> {
    return runTransaction(connection, {
      stores: [RENDERS_STORE_NAME],
      mode: 'readonly',
      operation: 'list render cache records'
    }, (transaction) => transaction.store(RENDERS_STORE_NAME).getAll());
  }

  /**
   * Evicts least-recently-used entries until the configured limit holds.
   * Metadata records are tiny, so the decision only reads the small store.
   */
  async #evict(connection: RenderCacheConnection): Promise<void> {
    const { enabled, limitBytes } = this.#settings();
    if (!enabled) return;
    const { records, doomed } = await runTransaction(connection, {
      stores: [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
      mode: 'readwrite',
      operation: 'evict render disk cache',
      durability: 'relaxed'
    }, async (transaction) => {
      const renders = transaction.store(RENDERS_STORE_NAME);
      const blobsByRender = transaction.store(BLOBS_STORE_NAME).index(BLOBS_BY_RENDER_INDEX_NAME);
      const records = await renders.getAll();
      const doomed = selectRenderEviction(records, limitBytes);
      for (const renderKey of doomed) {
        await renders.delete(renderKey);
        await blobsByRender.deleteAll(IDBKeyRange.only(renderKey));
      }
      return { records, doomed };
    });
    if (doomed.length === 0) return;
    const doomedKeys = new Set(doomed);
    const remaining = records.filter((record) => !doomedKeys.has(record.key))
      .reduce((sum, record) => sum + record.sizeBytes, 0);
    logDebug('multiplayer', 'Render disk cache evicted', {
      entries: doomed.length,
      freedBytes: records.reduce((sum, record) => sum + record.sizeBytes, 0) - remaining,
      totalBytes: remaining,
      limitBytes
    });
  }

  async #readRecord(connection: RenderCacheConnection, key: string): Promise<RenderCacheRecord | null> {
    return runTransaction(connection, {
      stores: [RENDERS_STORE_NAME],
      mode: 'readonly',
      operation: 'read render cache record'
    }, async (transaction) => (await transaction.store(RENDERS_STORE_NAME).get(key)) ?? null);
  }

  async #readRender(
    connection: RenderCacheConnection,
    key: string,
    record: RenderCacheRecord
  ): Promise<ClientCachedRender | null> {
    const blobs = await runTransaction(connection, {
      stores: [BLOBS_STORE_NAME, RENDERS_STORE_NAME],
      mode: 'readwrite',
      operation: 'read and touch cached render',
      durability: 'relaxed'
    }, async (transaction) => {
      const records = await transaction.store(BLOBS_STORE_NAME)
        .index(BLOBS_BY_RENDER_INDEX_NAME)
        .getAll(IDBKeyRange.only(key));
      await transaction.store(RENDERS_STORE_NAME).put({ ...record, lastUsedAt: Date.now() });
      return new Map(records.map((blob) => [blob.key, blob.bytes]));
    });
    if (blobs.size === 0) return null;

    const init = blobs.get(initBlobKey(key));
    if (!init) return null;
    const clusters = new Map<number, Uint8Array>();
    for (const [blobKey, bytes] of blobs) {
      const index = parseBlobIndex(key, blobKey);
      if (index !== null) clusters.set(index, bytes);
    }

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
      const connection = await this.#open();

      const exactKey = buildClientRenderCacheKey(trackId, sourceRevision, bitrateKbps);
      const exactRecord = await this.#readRecord(connection, exactKey);
      if (exactRecord) {
        const render = await this.#readRender(connection, exactKey, exactRecord);
        if (render) {
          logDebug('multiplayer', 'Render disk cache hit', {
            key: exactKey,
            clusters: render.clusters.size,
            bytes: exactRecord.sizeBytes
          });
          return { key: exactKey, render };
        }
      }

      const records = await this.#readRecords(connection);
      const candidate = selectHigherBitrateCandidate(
        records,
        trackId,
        sourceRevision,
        bitrateKbps
      );
      if (!candidate) return null;
      const render = await this.#readRender(connection, candidate.key, candidate.record);
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
      const connection = await this.#open();

      const now = Date.now();
      let sizeBytes = entry.init.byteLength;
      for (const bytes of entry.clusters.values()) sizeBytes += bytes.byteLength;

      await runTransaction(connection, {
        stores: [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        mode: 'readwrite',
        operation: 'persist rendered media cache',
        durability: 'relaxed'
      }, async (transaction) => {
        const renders = transaction.store(RENDERS_STORE_NAME);
        const blobs = transaction.store(BLOBS_STORE_NAME);
        const blobsByRender = blobs.index(BLOBS_BY_RENDER_INDEX_NAME);
        const existing = (await renders.get(entry.key)) ?? null;
        const existingBlobs = existing
          ? await blobsByRender.getAll(IDBKeyRange.only(entry.key))
          : [];
        const existingIndices = new Set(existingBlobs.flatMap((blob) => {
          const index = parseBlobIndex(entry.key, blob.key);
          return index === null ? [] : [index];
        }));
        let addedBytes = 0;
        let addedCount = 0;
        const matches = existing !== null && renderMatchesManifest(
          { manifest: existing.manifest, init: entry.init, clusters: entry.clusters },
          entry.manifest
        );
        if (matches) {
          for (const [index, bytes] of entry.clusters) {
            if (!existingIndices.has(index)) {
              addedBytes += bytes.byteLength;
              addedCount += 1;
            }
          }
          sizeBytes = existing.sizeBytes + addedBytes;
        } else if (existing) {
          await blobsByRender.deleteAll(IDBKeyRange.only(entry.key));
        }
        const record: RenderCacheRecord = {
          key: entry.key,
          name: entry.name || entry.key,
          sizeBytes,
          lastUsedAt: now,
          storedAt: existing?.storedAt ?? now,
          initSizeBytes: entry.init.byteLength,
          clusterCount: matches ? existing!.clusterCount + addedCount : entry.clusters.size,
          manifest: { ...entry.manifest }
        };
        await blobs.put({ key: initBlobKey(entry.key), renderKey: entry.key, bytes: entry.init });
        for (const [index, bytes] of entry.clusters) {
          await blobs.put({ key: blobKey(entry.key, index), renderKey: entry.key, bytes });
        }
        await renders.put(record);
      });
      await this.#evict(connection);
    });
  }

  remove(key: string): Promise<void> {
    return this.#enqueue(async () => {
      const connection = await this.#open();
      await runTransaction(connection, {
        stores: [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        mode: 'readwrite',
        operation: 'remove rendered media cache entry',
        durability: 'relaxed'
      }, async (transaction) => {
        await transaction.store(RENDERS_STORE_NAME).delete(key);
        await transaction.store(BLOBS_STORE_NAME)
          .index(BLOBS_BY_RENDER_INDEX_NAME)
          .deleteAll(IDBKeyRange.only(key));
      });
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      const connection = await this.#open();
      await runTransaction(connection, {
        stores: [RENDERS_STORE_NAME, BLOBS_STORE_NAME],
        mode: 'readwrite',
        operation: 'clear rendered media cache',
        durability: 'relaxed'
      }, async (transaction) => {
        await transaction.store(RENDERS_STORE_NAME).clear();
        await transaction.store(BLOBS_STORE_NAME).clear();
      });
    });
  }

  list(): Promise<RenderCacheListResult> {
    return this.#enqueue(async () => {
      const connection = await this.#open();
      const { enabled, limitBytes } = this.#settings();
      const records = await this.#readRecords(connection);
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
      const connection = await this.#open();
      await this.#evict(connection);
    });
  }

  flush(): Promise<void> {
    return this.#chain.then(() => undefined);
  }

  async dispose(): Promise<void> {
    if (this.#closed) return;
    await this.flush();
    this.#closed = true;
    const connection = this.#connectionPromise ? await this.#connectionPromise.catch(() => null) : null;
    this.#connectionPromise = null;
    if (connection) await connection.close();
    this.#status.set({ state: 'closed', error: null });
  }
}

export const multiplayerRenderDiskCache = new MultiplayerRenderDiskCache();
registerBrowserPersistenceOwner({
  label: 'multiplayer render disk cache',
  flush: () => multiplayerRenderDiskCache.flush(),
  dispose: () => multiplayerRenderDiskCache.dispose()
});

if (typeof window !== 'undefined') {
  experimentalSettings.subscribe(() => {
    if (!experimentalSettings.getSnapshot().multiplayerRenderDiskCacheEnabled) return;
    void multiplayerRenderDiskCache.enforceLimit().catch(() => undefined);
  });
}
