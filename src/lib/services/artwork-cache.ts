import { loadInspectedEmbeddedArtwork } from '$lib/services/catalog-metadata-inspection';
import type { MediaEntity } from '$lib/contracts/catalog';
import { readable, writable } from 'svelte/store';
import {
  openBrowserDatabase,
  registerBrowserPersistenceOwner
} from '$lib/persistence/browser-indexed-db';
import {
  defineDatabase,
  defineStore,
  runTransaction,
  type DatabaseConnection,
  type TypedTransaction
} from '$lib/persistence/indexed-db';
import { logWarning } from '$lib/logging/api';

export const ALBUM_ARTWORK_THUMBNAIL_SIZE = 96;

const DATABASE_NAME = 'izci-artwork-cache';
const DATABASE_VERSION = 1;
const SOURCE_STORE_NAME = 'sources';
const RENDITION_STORE_NAME = 'renditions';
const EXTRACTION_VERSION = 1;
const RENDITION_VERSION = 1;
export const MAX_ARTWORK_RENDITION_BYTES = 48 * 1024 * 1024;
export const MAX_ARTWORK_SOURCE_RECORDS = 8_192;
export const MAX_ARTWORK_NEGATIVE_SOURCE_RECORDS = 2_048;

interface ArtworkSourceRecord {
  sourceKey: string;
  fingerprint: string;
  assetId: string | null;
  checkedAt: number;
}

interface ArtworkRenditionRecord {
  key: string;
  assetId: string;
  maxEdge: number;
  blob: Blob;
  width: number;
  height: number;
  byteSize: number;
  lastAccessed: number;
}

const artworkDatabaseSpec = defineDatabase({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: {
    [SOURCE_STORE_NAME]: defineStore<ArtworkSourceRecord, string>()({ keyPath: 'sourceKey' }),
    [RENDITION_STORE_NAME]: defineStore<ArtworkRenditionRecord, string>()({ keyPath: 'key' })
  }
});

type ArtworkDatabaseConnection = DatabaseConnection<typeof artworkDatabaseSpec>;
type ArtworkReadWriteTransaction = TypedTransaction<
  typeof artworkDatabaseSpec,
  typeof SOURCE_STORE_NAME | typeof RENDITION_STORE_NAME
>;

export interface ArtworkCachePersistenceStatus {
  state: 'ready' | 'busy' | 'degraded' | 'closed';
  error: unknown | null;
}

const status = writable<ArtworkCachePersistenceStatus>({ state: 'ready', error: null });
export const artworkCachePersistenceStatus = readable<ArtworkCachePersistenceStatus>(
  { state: 'ready', error: null },
  (set) => status.subscribe(set)
);

export interface CachedArtworkThumbnail {
  assetId: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface ArtworkCacheSourceInfo {
  sourceKey: string;
  fingerprint: string;
  assetId: string | null;
  checkedAt: number;
}

export interface ArtworkCacheRenditionInfo {
  key: string;
  assetId: string;
  maxEdge: number;
  width: number;
  height: number;
  sizeBytes: number;
  lastAccessed: number;
  sourceReferences: number;
}

export interface ArtworkCacheInventory {
  sources: ArtworkCacheSourceInfo[];
  renditions: ArtworkCacheRenditionInfo[];
  sourceCount: number;
  negativeSourceCount: number;
  renditionCount: number;
  totalBytes: number;
  limitBytes: number;
}

interface ArtworkSourceEvictionCandidate {
  sourceKey: string;
  assetId: string | null;
  checkedAt: number;
}

interface ArtworkRenditionEvictionCandidate {
  key: string;
  byteSize: number;
  lastAccessed: number;
}

function oldestSourceFirst(
  left: ArtworkSourceEvictionCandidate,
  right: ArtworkSourceEvictionCandidate
): number {
  return left.checkedAt - right.checkedAt || left.sourceKey.localeCompare(right.sourceKey);
}

export function selectArtworkSourceEvictions(
  records: readonly ArtworkSourceEvictionCandidate[],
  maximumSources = MAX_ARTWORK_SOURCE_RECORDS,
  maximumNegativeSources = MAX_ARTWORK_NEGATIVE_SOURCE_RECORDS
): string[] {
  const sourceLimit = Math.max(0, Math.floor(maximumSources));
  const negativeLimit = Math.max(0, Math.min(sourceLimit, Math.floor(maximumNegativeSources)));
  const evicted = new Set<string>();
  const negatives = records
    .filter((record) => record.assetId === null)
    .sort(oldestSourceFirst);

  for (let index = 0; index < negatives.length - negativeLimit; index += 1) {
    const record = negatives[index];
    if (record) evicted.add(record.sourceKey);
  }

  const retained = records
    .filter((record) => !evicted.has(record.sourceKey))
    .sort(oldestSourceFirst);
  for (let index = 0; index < retained.length - sourceLimit; index += 1) {
    const record = retained[index];
    if (record) evicted.add(record.sourceKey);
  }

  return [...evicted];
}

export function selectArtworkRenditionEvictions(
  records: readonly ArtworkRenditionEvictionCandidate[],
  maximumBytes = MAX_ARTWORK_RENDITION_BYTES
): string[] {
  const byteLimit = Math.max(0, Math.floor(maximumBytes));
  const oldestFirst = [...records].sort((left, right) =>
    left.lastAccessed - right.lastAccessed || left.key.localeCompare(right.key)
  );
  let retainedBytes = records.reduce((sum, record) => sum + record.byteSize, 0);
  const evicted: string[] = [];

  for (const record of oldestFirst) {
    if (retainedBytes <= byteLimit) break;
    evicted.push(record.key);
    retainedBytes -= record.byteSize;
  }

  return evicted;
}

export function createArtworkCacheInventory(
  sourceRecords: readonly ArtworkSourceRecord[],
  renditionRecords: readonly ArtworkRenditionRecord[]
): ArtworkCacheInventory {
  const references = new Map<string, number>();
  for (const source of sourceRecords) {
    if (source.assetId) {
      references.set(source.assetId, (references.get(source.assetId) ?? 0) + 1);
    }
  }

  const sources = [...sourceRecords]
    .sort((left, right) => right.checkedAt - left.checkedAt || left.sourceKey.localeCompare(right.sourceKey))
    .map((record) => ({ ...record }));
  const renditions = [...renditionRecords]
    .sort((left, right) => right.lastAccessed - left.lastAccessed || left.key.localeCompare(right.key))
    .map((record) => ({
      key: record.key,
      assetId: record.assetId,
      maxEdge: record.maxEdge,
      width: record.width,
      height: record.height,
      sizeBytes: record.byteSize,
      lastAccessed: record.lastAccessed,
      sourceReferences: references.get(record.assetId) ?? 0
    }));

  return {
    sources,
    renditions,
    sourceCount: sources.length,
    negativeSourceCount: sources.filter((source) => source.assetId === null).length,
    renditionCount: renditions.length,
    totalBytes: renditions.reduce((sum, rendition) => sum + rendition.sizeBytes, 0),
    limitBytes: MAX_ARTWORK_RENDITION_BYTES
  };
}

const EMPTY_ARTWORK_CACHE_INVENTORY: ArtworkCacheInventory = {
  sources: [],
  renditions: [],
  sourceCount: 0,
  negativeSourceCount: 0,
  renditionCount: 0,
  totalBytes: 0,
  limitBytes: MAX_ARTWORK_RENDITION_BYTES
};

const inventory = writable<ArtworkCacheInventory>(EMPTY_ARTWORK_CACHE_INVENTORY);
export const artworkCacheInventory = readable<ArtworkCacheInventory>(
  EMPTY_ARTWORK_CACHE_INVENTORY,
  (set) => inventory.subscribe(set)
);

const pendingLoads = new Map<string, Promise<CachedArtworkThumbnail | null>>();
let mutationChain: Promise<void> = Promise.resolve();
let cacheGeneration = 0;
let boundsPromise: Promise<void> | null = null;
let inventoryRefreshQueued = false;
let disposed = false;
let disposePromise: Promise<void> | null = null;

async function withDatabase<TResult>(
  work: (connection: ArtworkDatabaseConnection) => Promise<TResult>
): Promise<TResult> {
  status.set({ state: 'busy', error: null });
  const connection = await openBrowserDatabase(artworkDatabaseSpec);
  try {
    const result = await work(connection);
    status.set({ state: 'ready', error: null });
    return result;
  } catch (error) {
    status.set({ state: 'degraded', error });
    throw error;
  } finally {
    await connection.close().catch((error) => {
      status.set({ state: 'degraded', error });
      throw error;
    });
  }
}

function reportCacheFailure(operation: string, error: unknown): void {
  status.set({ state: 'degraded', error });
  logWarning('library', `Artwork cache ${operation} failed`, { error });
}

function isArtworkCandidate(track: MediaEntity): boolean {
  return track.kind === 'stream' && (track.format === 'flac' || track.format === 'opus');
}

export function getArtworkSourceFingerprint(track: MediaEntity): string {
  return [track.format, track.size, track.lastModified, EXTRACTION_VERSION].join(':');
}

export function getArtworkRenditionKey(assetId: string, maxEdge: number): string {
  return `${assetId}:${maxEdge}:v${RENDITION_VERSION}`;
}

export function fitArtworkRenditionSize(width: number, height: number, maxEdge: number): {
  width: number;
  height: number;
} {
  if (width <= 0 || height <= 0 || maxEdge <= 0) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

async function readSourceRecord(key: string): Promise<ArtworkSourceRecord | null> {
  return withDatabase((connection) => runTransaction(connection, {
    stores: [SOURCE_STORE_NAME],
    mode: 'readonly',
    operation: 'read artwork source'
  }, async (transaction) => (await transaction.store(SOURCE_STORE_NAME).get(key)) ?? null));
}

async function readRenditionRecord(key: string): Promise<ArtworkRenditionRecord | null> {
  return withDatabase((connection) => runTransaction(connection, {
    stores: [RENDITION_STORE_NAME],
    mode: 'readonly',
    operation: 'read artwork rendition'
  }, async (transaction) => (await transaction.store(RENDITION_STORE_NAME).get(key)) ?? null));
}

async function pruneArtworkRecords(transaction: ArtworkReadWriteTransaction): Promise<void> {
  const sources = transaction.store(SOURCE_STORE_NAME);
  const renditions = transaction.store(RENDITION_STORE_NAME);
  const [sourceRecords, renditionRecords] = await Promise.all([
    sources.getAll(),
    renditions.getAll()
  ]);

  for (const sourceKey of selectArtworkSourceEvictions(sourceRecords)) {
    await sources.delete(sourceKey);
  }
  for (const renditionKey of selectArtworkRenditionEvictions(renditionRecords)) {
    await renditions.delete(renditionKey);
  }
}

async function enqueueCacheMutation(
  generation: number,
  work: () => Promise<void>
): Promise<boolean> {
  let applied = false;
  const operation = mutationChain.then(async () => {
    if (disposed || generation !== cacheGeneration) return;
    await work();
    applied = true;
  });
  mutationChain = operation.then(() => undefined, () => undefined);
  await operation;
  return applied;
}

function scheduleInventoryRefresh(): void {
  if (disposed || inventoryRefreshQueued) return;
  inventoryRefreshQueued = true;
  queueMicrotask(() => {
    inventoryRefreshQueued = false;
    if (disposed) return;
    void refreshArtworkCacheInventory().catch((error) => reportCacheFailure('inventory refresh', error));
  });
}

function ensureArtworkCacheBounds(): Promise<void> {
  if (boundsPromise) return boundsPromise;
  const generation = cacheGeneration;
  const operation = enqueueCacheMutation(generation, async () => {
    await withDatabase((connection) => runTransaction(connection, {
      stores: [SOURCE_STORE_NAME, RENDITION_STORE_NAME],
      mode: 'readwrite',
      operation: 'enforce artwork cache bounds',
      durability: 'relaxed'
    }, pruneArtworkRecords));
  }).then(() => undefined).catch((error) => {
    if (boundsPromise === operation) boundsPromise = null;
    throw error;
  });
  boundsPromise = operation;
  return operation;
}

async function writeSourceAndRendition(
  source: ArtworkSourceRecord,
  rendition: ArtworkRenditionRecord | undefined,
  generation: number
): Promise<boolean> {
  const applied = await enqueueCacheMutation(generation, async () => {
    await withDatabase((connection) => runTransaction(connection, {
      stores: [SOURCE_STORE_NAME, RENDITION_STORE_NAME],
      mode: 'readwrite',
      operation: 'persist and bound artwork cache',
      durability: 'relaxed'
    }, async (transaction) => {
      await transaction.store(SOURCE_STORE_NAME).put(source);
      if (rendition) {
        await transaction.store(RENDITION_STORE_NAME).put(rendition);
      }
      await pruneArtworkRecords(transaction);
    }));
  });
  if (applied) scheduleInventoryRefresh();
  return applied;
}

async function touchRendition(record: ArtworkRenditionRecord, generation: number): Promise<void> {
  const applied = await enqueueCacheMutation(generation, async () => {
    await withDatabase((connection) => runTransaction(connection, {
      stores: [RENDITION_STORE_NAME],
      mode: 'readwrite',
      operation: 'touch artwork rendition',
      durability: 'relaxed'
    }, async (transaction) => {
      await transaction.store(RENDITION_STORE_NAME).put({
        ...record,
        lastAccessed: Date.now()
      });
    }));
  });
  if (applied) scheduleInventoryRefresh();
}

async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.84));
}

async function createRendition(blob: Blob, maxEdge: number): Promise<{
  blob: Blob;
  width: number;
  height: number;
} | null> {
  if (typeof createImageBitmap !== 'function') {
    return null;
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(blob);
    const size = fitArtworkRenditionSize(bitmap.width, bitmap.height, maxEdge);

    if (size.width === 0 || size.height === 0) {
      return null;
    }

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(size.width, size.height);
      const context = canvas.getContext('2d');

      if (!context) {
        return null;
      }

      context.drawImage(bitmap, 0, 0, size.width, size.height);
      const renditionBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.84 });
      return { blob: renditionBlob, ...size };
    }

    if (typeof document === 'undefined') {
      return null;
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');

    if (!context) {
      return null;
    }

    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const renditionBlob = await canvasToBlob(canvas);
    return renditionBlob ? { blob: renditionBlob, ...size } : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

async function loadArtworkThumbnail(
  track: MediaEntity,
  maxEdge: number,
  generation: number
): Promise<CachedArtworkThumbnail | null> {
  await ensureArtworkCacheBounds();
  const sourceKey = track.id;
  const fingerprint = getArtworkSourceFingerprint(track);
  const storedSource = await readSourceRecord(sourceKey);

  if (storedSource?.fingerprint === fingerprint) {
    if (!storedSource.assetId) {
      return null;
    }

    const rendition = await readRenditionRecord(getArtworkRenditionKey(storedSource.assetId, maxEdge));

    if (rendition) {
      void touchRendition(rendition, generation).catch((error) => reportCacheFailure('touch', error));
      return rendition;
    }
  }

  const embeddedArtwork = await loadInspectedEmbeddedArtwork(track);

  if (!embeddedArtwork) {
    await writeSourceAndRendition({
      sourceKey,
      fingerprint,
      assetId: null,
      checkedAt: Date.now()
    }, undefined, generation);
    return null;
  }

  const assetId = await hashBlob(embeddedArtwork.blob);
  const renditionKey = getArtworkRenditionKey(assetId, maxEdge);
  const existingRendition = await readRenditionRecord(renditionKey);

  if (existingRendition) {
    await writeSourceAndRendition(
      { sourceKey, fingerprint, assetId, checkedAt: Date.now() },
      undefined,
      generation
    );
    void touchRendition(existingRendition, generation).catch((error) => reportCacheFailure('touch', error));
    return existingRendition;
  }

  const rendered = await createRendition(embeddedArtwork.blob, maxEdge);

  if (!rendered) {
    await writeSourceAndRendition(
      { sourceKey, fingerprint, assetId: null, checkedAt: Date.now() },
      undefined,
      generation
    );
    return null;
  }

  const rendition: ArtworkRenditionRecord = {
    key: renditionKey,
    assetId,
    maxEdge,
    blob: rendered.blob,
    width: rendered.width,
    height: rendered.height,
    byteSize: rendered.blob.size,
    lastAccessed: Date.now()
  };

  await writeSourceAndRendition(
    { sourceKey, fingerprint, assetId, checkedAt: Date.now() },
    rendition,
    generation
  );
  return rendition;
}

export function getCachedArtworkThumbnail(
  track: MediaEntity,
  maxEdge = ALBUM_ARTWORK_THUMBNAIL_SIZE
): Promise<CachedArtworkThumbnail | null> {
  if (disposed || !isArtworkCandidate(track)) {
    return Promise.resolve(null);
  }

  const generation = cacheGeneration;
  const loadKey = `${track.id}:${getArtworkSourceFingerprint(track)}:${maxEdge}`;
  const pending = pendingLoads.get(loadKey);

  if (pending) {
    return pending;
  }

  let request: Promise<CachedArtworkThumbnail | null>;
  request = loadArtworkThumbnail(track, maxEdge, generation)
    .catch((error) => {
      reportCacheFailure('lookup', error);
      return null;
    })
    .finally(() => {
      if (pendingLoads.get(loadKey) === request) pendingLoads.delete(loadKey);
    });
  pendingLoads.set(loadKey, request);
  return request;
}

export async function listArtworkCache(): Promise<ArtworkCacheInventory> {
  await mutationChain;
  const snapshot = await withDatabase((connection) => runTransaction(connection, {
    stores: [SOURCE_STORE_NAME, RENDITION_STORE_NAME],
    mode: 'readonly',
    operation: 'list artwork cache'
  }, async (transaction) => createArtworkCacheInventory(
    await transaction.store(SOURCE_STORE_NAME).getAll(),
    await transaction.store(RENDITION_STORE_NAME).getAll()
  )));
  inventory.set(snapshot);
  return snapshot;
}

export async function refreshArtworkCacheInventory(): Promise<ArtworkCacheInventory> {
  await ensureArtworkCacheBounds();
  return listArtworkCache();
}

export async function clearArtworkCache(): Promise<void> {
  if (disposed) return;
  cacheGeneration += 1;
  boundsPromise = null;
  pendingLoads.clear();
  const generation = cacheGeneration;
  await enqueueCacheMutation(generation, async () => {
    await withDatabase((connection) => runTransaction(connection, {
      stores: [SOURCE_STORE_NAME, RENDITION_STORE_NAME],
      mode: 'readwrite',
      operation: 'clear artwork cache',
      durability: 'relaxed'
    }, async (transaction) => {
      await transaction.store(SOURCE_STORE_NAME).clear();
      await transaction.store(RENDITION_STORE_NAME).clear();
    }));
  });
  boundsPromise = Promise.resolve();
  inventory.set(EMPTY_ARTWORK_CACHE_INVENTORY);
}

export async function invalidateCachedArtwork(trackIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(trackIds)].filter(Boolean);

  if (ids.length === 0) return;

  for (const id of ids) {
    for (const key of pendingLoads.keys()) {
      if (key.startsWith(`${id}:`)) pendingLoads.delete(key);
    }
  }

  cacheGeneration += 1;
  boundsPromise = null;
  const generation = cacheGeneration;
  await enqueueCacheMutation(generation, async () => {
    await withDatabase((connection) => runTransaction(connection, {
      stores: [SOURCE_STORE_NAME],
      mode: 'readwrite',
      operation: 'invalidate artwork sources',
      durability: 'relaxed'
    }, async (transaction) => {
      const store = transaction.store(SOURCE_STORE_NAME);
      for (const id of ids) await store.delete(id);
    }));
  }).then(() => scheduleInventoryRefresh())
    .catch((error) => reportCacheFailure('invalidation', error));
}

export async function flushArtworkCache(): Promise<void> {
  await Promise.allSettled([...pendingLoads.values()]);
  await mutationChain;
}

export function disposeArtworkCache(): Promise<void> {
  if (disposePromise) return disposePromise;
  disposed = true;
  cacheGeneration += 1;
  boundsPromise = null;
  disposePromise = (async () => {
    const pending = [...pendingLoads.values()];
    pendingLoads.clear();
    await Promise.allSettled(pending);
    await mutationChain;
    status.set({ state: 'closed', error: null });
  })();
  return disposePromise;
}

registerBrowserPersistenceOwner({
  label: 'artwork cache',
  flush: flushArtworkCache,
  dispose: disposeArtworkCache
});
