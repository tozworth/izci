import { loadEmbeddedStreamArtwork } from '$lib/services/stream-artwork';
import type { PlaylistItem } from '$lib/types';

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

export interface CachedArtworkThumbnail {
  assetId: string;
  blob: Blob;
  width: number;
  height: number;
}

const pendingLoads = new Map<string, Promise<CachedArtworkThumbnail | null>>();
let pruneScheduled = false;

function isArtworkCandidate(track: PlaylistItem): boolean {
  return track.kind === 'stream' && (track.extension === 'flac' || track.extension === 'opus');
}

export function getArtworkSourceFingerprint(track: PlaylistItem): string {
  return [track.extension, track.size, track.lastModified, EXTRACTION_VERSION].join(':');
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

async function openArtworkDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(SOURCE_STORE_NAME)) {
        database.createObjectStore(SOURCE_STORE_NAME, { keyPath: 'sourceKey' });
      }

      if (!database.objectStoreNames.contains(RENDITION_STORE_NAME)) {
        database.createObjectStore(RENDITION_STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const database = await openArtworkDatabase();

  if (!database) {
    return null;
  }

  return await new Promise((resolve) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);

    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

async function writeSourceAndRendition(
  source: ArtworkSourceRecord,
  rendition?: ArtworkRenditionRecord
): Promise<void> {
  const database = await openArtworkDatabase();

  if (!database) {
    return;
  }

  const storeNames = rendition
    ? [SOURCE_STORE_NAME, RENDITION_STORE_NAME]
    : [SOURCE_STORE_NAME];

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(storeNames, 'readwrite');
    transaction.objectStore(SOURCE_STORE_NAME).put(source);

    if (rendition) {
      transaction.objectStore(RENDITION_STORE_NAME).put(rendition);
    }

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      resolve();
    };
    transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}

async function touchRendition(record: ArtworkRenditionRecord): Promise<void> {
  const database = await openArtworkDatabase();

  if (!database) {
    return;
  }

  const transaction = database.transaction(RENDITION_STORE_NAME, 'readwrite');
  transaction.objectStore(RENDITION_STORE_NAME).put({
    ...record,
    lastAccessed: Date.now()
  });
  transaction.oncomplete = () => database.close();
  transaction.onerror = () => database.close();
  transaction.onabort = () => database.close();
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
  const database = await openArtworkDatabase();

  if (!database) {
    return;
  }

  const records = await new Promise<ArtworkRenditionRecord[]>((resolve) => {
    const transaction = database.transaction(RENDITION_STORE_NAME, 'readonly');
    const request = transaction.objectStore(RENDITION_STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as ArtworkRenditionRecord[]) ?? []);
    request.onerror = () => resolve([]);
  });
  const totalBytes = records.reduce((sum, record) => sum + record.byteSize, 0);

  if (totalBytes <= MAX_RENDITION_BYTES) {
    database.close();
    return;
  }

  const transaction = database.transaction(RENDITION_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(RENDITION_STORE_NAME);
  let retainedBytes = totalBytes;

  for (const record of [...records].sort((left, right) => left.lastAccessed - right.lastAccessed)) {
    if (retainedBytes <= MAX_RENDITION_BYTES) {
      break;
    }

    store.delete(record.key);
    retainedBytes -= record.byteSize;
  }

  transaction.oncomplete = () => database.close();
  transaction.onerror = () => database.close();
  transaction.onabort = () => database.close();
}

function scheduleCachePrune(): void {
  if (pruneScheduled || typeof window === 'undefined') {
    return;
  }

  pruneScheduled = true;
  window.setTimeout(() => {
    pruneScheduled = false;
    void pruneArtworkCache();
  }, 0);
}

async function loadArtworkThumbnail(
  track: PlaylistItem,
  maxEdge: number
): Promise<CachedArtworkThumbnail | null> {
  const sourceKey = track.id;
  const fingerprint = getArtworkSourceFingerprint(track);
  const storedSource = await readRecord<ArtworkSourceRecord>(SOURCE_STORE_NAME, sourceKey);

  if (storedSource?.fingerprint === fingerprint) {
    if (!storedSource.assetId) {
      return null;
    }

    const rendition = await readRecord<ArtworkRenditionRecord>(
      RENDITION_STORE_NAME,
      getArtworkRenditionKey(storedSource.assetId, maxEdge)
    );

    if (rendition) {
      void touchRendition(rendition);
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
  const existingRendition = await readRecord<ArtworkRenditionRecord>(RENDITION_STORE_NAME, renditionKey);

  if (existingRendition) {
    await writeSourceAndRendition({ sourceKey, fingerprint, assetId, checkedAt: Date.now() });
    void touchRendition(existingRendition);
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
  track: PlaylistItem,
  maxEdge = ALBUM_ARTWORK_THUMBNAIL_SIZE
): Promise<CachedArtworkThumbnail | null> {
  if (!isArtworkCandidate(track)) {
    return Promise.resolve(null);
  }

  const loadKey = `${track.id}:${getArtworkSourceFingerprint(track)}:${maxEdge}`;
  const pending = pendingLoads.get(loadKey);

  if (pending) {
    return pending;
  }

  const request = loadArtworkThumbnail(track, maxEdge)
    .catch(() => null)
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

  const database = await openArtworkDatabase();

  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(SOURCE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(SOURCE_STORE_NAME);

    for (const id of ids) store.delete(id);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}
