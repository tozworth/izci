import { loadEmbeddedStreamArtwork } from '$lib/services/stream-artwork';
import type { MediaEntity } from '$lib/contracts/catalog';
import { readable, writable } from 'svelte/store';
import { openBrowserDatabase } from '$lib/persistence/browser-indexed-db';
import {
  defineDatabase,
  defineStore,
  runTransaction,
  type DatabaseConnection
} from '$lib/persistence/indexed-db';
import { logWarning } from '$lib/logging/api';

export const ALBUM_ARTWORK_THUMBNAIL_SIZE = 96;

const DATABASE_NAME = 'izci-artwork-cache';
const DATABASE_VERSION = 1;
const SOURCE_STORE_NAME = 'sources';
const RENDITION_STORE_NAME = 'renditions';
const EXTRACTION_VERSION = 1;
const RENDITION_VERSION = 1;
const MAX_RENDITION_BYTES = 48 * 1024 * 1024;

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

export interface ArtworkCachePersistenceStatus {
  state: 'ready' | 'busy' | 'degraded';
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

const pendingLoads = new Map<string, Promise<CachedArtworkThumbnail | null>>();
let pruneTimer: number | null = null;
let disposed = false;

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

async function writeSourceAndRendition(
  source: ArtworkSourceRecord,
  rendition?: ArtworkRenditionRecord
): Promise<void> {
  const storeNames = rendition
    ? [SOURCE_STORE_NAME, RENDITION_STORE_NAME] as const
    : [SOURCE_STORE_NAME] as const;

  await withDatabase((connection) => runTransaction(connection, {
    stores: storeNames,
    mode: 'readwrite',
    operation: 'persist artwork source and rendition',
    durability: 'relaxed'
  }, async (transaction) => {
    await transaction.store(SOURCE_STORE_NAME).put(source);
    if (rendition) {
      await transaction.store(RENDITION_STORE_NAME).put(rendition);
    }
  }));
}

async function touchRendition(record: ArtworkRenditionRecord): Promise<void> {
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

async function pruneArtworkCache(): Promise<void> {
  await withDatabase((connection) => runTransaction(connection, {
    stores: [RENDITION_STORE_NAME],
    mode: 'readwrite',
    operation: 'prune artwork renditions',
    durability: 'relaxed'
  }, async (transaction) => {
    const store = transaction.store(RENDITION_STORE_NAME);
    const records = await store.getAll();
    const totalBytes = records.reduce((sum, record) => sum + record.byteSize, 0);
    let retainedBytes = totalBytes;
    for (const record of [...records].sort((left, right) => left.lastAccessed - right.lastAccessed)) {
      if (retainedBytes <= MAX_RENDITION_BYTES) break;
      await store.delete(record.key);
      retainedBytes -= record.byteSize;
    }
  }));
}

function scheduleCachePrune(): void {
  if (disposed || pruneTimer !== null || typeof window === 'undefined') {
    return;
  }

  pruneTimer = window.setTimeout(() => {
    pruneTimer = null;
    void pruneArtworkCache().catch((error) => reportCacheFailure('prune', error));
  }, 0);
}

async function loadArtworkThumbnail(
  track: MediaEntity,
  maxEdge: number
): Promise<CachedArtworkThumbnail | null> {
  const sourceKey = track.id;
  const fingerprint = getArtworkSourceFingerprint(track);
  const storedSource = await readSourceRecord(sourceKey);

  if (storedSource?.fingerprint === fingerprint) {
    if (!storedSource.assetId) {
      return null;
    }

    const rendition = await readRenditionRecord(getArtworkRenditionKey(storedSource.assetId, maxEdge));

    if (rendition) {
      void touchRendition(rendition).catch((error) => reportCacheFailure('touch', error));
      return rendition;
    }
  }

  const embeddedArtwork = await loadEmbeddedStreamArtwork(track);

  if (!embeddedArtwork) {
    await writeSourceAndRendition({
      sourceKey,
      fingerprint,
      assetId: null,
      checkedAt: Date.now()
    });
    return null;
  }

  const assetId = await hashBlob(embeddedArtwork.blob);
  const renditionKey = getArtworkRenditionKey(assetId, maxEdge);
  const existingRendition = await readRenditionRecord(renditionKey);

  if (existingRendition) {
    await writeSourceAndRendition({ sourceKey, fingerprint, assetId, checkedAt: Date.now() });
    void touchRendition(existingRendition).catch((error) => reportCacheFailure('touch', error));
    return existingRendition;
  }

  const rendered = await createRendition(embeddedArtwork.blob, maxEdge);

  if (!rendered) {
    await writeSourceAndRendition({ sourceKey, fingerprint, assetId: null, checkedAt: Date.now() });
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
    rendition
  );
  scheduleCachePrune();
  return rendition;
}

export function getCachedArtworkThumbnail(
  track: MediaEntity,
  maxEdge = ALBUM_ARTWORK_THUMBNAIL_SIZE
): Promise<CachedArtworkThumbnail | null> {
  disposed = false;
  if (!isArtworkCandidate(track)) {
    return Promise.resolve(null);
  }

  const loadKey = `${track.id}:${getArtworkSourceFingerprint(track)}:${maxEdge}`;
  const pending = pendingLoads.get(loadKey);

  if (pending) {
    return pending;
  }

  const request = loadArtworkThumbnail(track, maxEdge)
    .catch((error) => {
      reportCacheFailure('lookup', error);
      return null;
    })
    .finally(() => pendingLoads.delete(loadKey));
  pendingLoads.set(loadKey, request);
  return request;
}

export async function invalidateCachedArtwork(trackIds: Iterable<string>): Promise<void> {
  const ids = [...new Set(trackIds)].filter(Boolean);

  if (ids.length === 0) return;

  for (const id of ids) {
    for (const key of pendingLoads.keys()) {
      if (key.startsWith(`${id}:`)) pendingLoads.delete(key);
    }
  }

  await withDatabase((connection) => runTransaction(connection, {
    stores: [SOURCE_STORE_NAME],
    mode: 'readwrite',
    operation: 'invalidate artwork sources',
    durability: 'relaxed'
  }, async (transaction) => {
    const store = transaction.store(SOURCE_STORE_NAME);
    for (const id of ids) await store.delete(id);
  })).catch((error) => reportCacheFailure('invalidation', error));
}

export async function disposeArtworkCache(): Promise<void> {
  disposed = true;
  if (pruneTimer !== null) {
    window.clearTimeout(pruneTimer);
    pruneTimer = null;
  }
  const pending = [...pendingLoads.values()];
  pendingLoads.clear();
  await Promise.allSettled(pending);
}
