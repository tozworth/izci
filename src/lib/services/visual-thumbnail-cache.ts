import { materializeTrackItem } from '$lib/stores/queue-materialization';
import type { TrackItem } from '$lib/types';

export const VISUAL_THUMBNAIL_SIZE = 384;

const DATABASE_NAME = 'izci-visual-thumbnail-cache';
const DATABASE_VERSION = 1;
const SOURCE_STORE_NAME = 'sources';
const RENDITION_STORE_NAME = 'renditions';
const EXTRACTION_VERSION = 1;
const RENDITION_VERSION = 1;
const MAX_RENDITION_BYTES = 96 * 1024 * 1024;
const VIDEO_LOAD_TIMEOUT_MS = 12_000;

interface VisualThumbnailSourceRecord {
  sourceKey: string;
  fingerprint: string;
  unavailable: boolean;
  checkedAt: number;
}

interface VisualThumbnailRenditionRecord {
  key: string;
  sourceKey: string;
  fingerprint: string;
  maxEdge: number;
  blob: Blob;
  width: number;
  height: number;
  byteSize: number;
  lastAccessed: number;
}

export interface CachedVisualThumbnail {
  blob: Blob;
  width: number;
  height: number;
}

const pendingLoads = new Map<string, Promise<CachedVisualThumbnail | null>>();
let pruneScheduled = false;

function isVisualTrack(track: TrackItem): boolean {
  return track.kind === 'image' || track.kind === 'video';
}

function normalizeMaxEdge(maxEdge: number): number {
  return Math.max(1, Math.round(maxEdge));
}

export function getVisualThumbnailSourceFingerprint(track: TrackItem): string {
  return [track.kind, track.extension, track.size, track.lastModified, EXTRACTION_VERSION].join(':');
}

export function getVisualThumbnailRenditionKey(
  sourceKey: string,
  fingerprint: string,
  maxEdge: number
): string {
  return `${sourceKey}:${fingerprint}:${normalizeMaxEdge(maxEdge)}:v${RENDITION_VERSION}`;
}

export function fitVisualThumbnailSize(width: number, height: number, maxEdge: number): {
  width: number;
  height: number;
} {
  if (width <= 0 || height <= 0 || maxEdge <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export function selectVideoThumbnailTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(duration * 0.1, 0.1), 5, Math.max(0, duration - 0.05));
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;

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
    request.onerror = request.onblocked = () => resolve(null);
  });
}

async function readRecord<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const database = await openDatabase();
  if (!database) return null;

  return await new Promise((resolve) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = transaction.onerror = transaction.onabort = () => database.close();
  });
}

async function writeSourceAndRendition(
  source: VisualThumbnailSourceRecord,
  rendition?: VisualThumbnailRenditionRecord
): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const stores = rendition ? [SOURCE_STORE_NAME, RENDITION_STORE_NAME] : [SOURCE_STORE_NAME];
    const transaction = database.transaction(stores, 'readwrite');
    transaction.objectStore(SOURCE_STORE_NAME).put(source);
    if (rendition) transaction.objectStore(RENDITION_STORE_NAME).put(rendition);
    transaction.oncomplete = transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}

async function touchRendition(record: VisualThumbnailRenditionRecord): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  const transaction = database.transaction(RENDITION_STORE_NAME, 'readwrite');
  transaction.objectStore(RENDITION_STORE_NAME).put({ ...record, lastAccessed: Date.now() });
  transaction.oncomplete = transaction.onerror = transaction.onabort = () => database.close();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
}

async function renderSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number
): Promise<CachedVisualThumbnail | null> {
  const size = fitVisualThumbnailSize(sourceWidth, sourceHeight, maxEdge);
  if (size.width === 0 || size.height === 0) return null;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
    return { blob, ...size };
  }

  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await canvasToBlob(canvas);
  return blob ? { blob, ...size } : null;
}

async function createImageThumbnail(file: File, maxEdge: number): Promise<CachedVisualThumbnail | null> {
  if (typeof createImageBitmap !== 'function') return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    return await renderSource(bitmap, bitmap.width, bitmap.height, maxEdge);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'seeked'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener('error', handleError);
      resolve(result);
    };
    const handleSuccess = () => finish(true);
    const handleError = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), VIDEO_LOAD_TIMEOUT_MS);
    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

async function createVideoThumbnail(file: File, maxEdge: number): Promise<CachedVisualThumbnail | null> {
  if (typeof document === 'undefined') return null;
  const video = document.createElement('video');
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.preload = 'metadata';
  video.playsInline = true;
  video.src = url;

  try {
    const metadataReady = video.readyState >= HTMLMediaElement.HAVE_METADATA
      || await waitForVideoEvent(video, 'loadedmetadata');
    if (!metadataReady || video.videoWidth <= 0 || video.videoHeight <= 0) return null;

    const targetTime = selectVideoThumbnailTime(video.duration);
    if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.01) {
      video.currentTime = targetTime;
      await waitForVideoEvent(video, 'seeked');
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, VIDEO_LOAD_TIMEOUT_MS);
        video.addEventListener('loadeddata', () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    return await renderSource(video, video.videoWidth, video.videoHeight, maxEdge);
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function resolveTrackFile(track: TrackItem): Promise<File | null> {
  if (track.file) return track.file;
  const materialized = await materializeTrackItem(track, false);
  if (!materialized?.file) return null;
  if (!track.objectUrl && materialized.objectUrl) URL.revokeObjectURL(materialized.objectUrl);
  return materialized.file;
}

async function pruneCache(): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  const records = await new Promise<VisualThumbnailRenditionRecord[]>((resolve) => {
    const transaction = database.transaction(RENDITION_STORE_NAME, 'readonly');
    const request = transaction.objectStore(RENDITION_STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as VisualThumbnailRenditionRecord[]) ?? []);
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
    if (retainedBytes <= MAX_RENDITION_BYTES) break;
    store.delete(record.key);
    retainedBytes -= record.byteSize;
  }
  transaction.oncomplete = transaction.onerror = transaction.onabort = () => database.close();
}

function scheduleCachePrune(): void {
  if (pruneScheduled || typeof window === 'undefined') return;
  pruneScheduled = true;
  window.setTimeout(() => {
    pruneScheduled = false;
    void pruneCache();
  }, 0);
}

async function loadVisualThumbnail(track: TrackItem, maxEdge: number): Promise<CachedVisualThumbnail | null> {
  const fingerprint = getVisualThumbnailSourceFingerprint(track);
  const source = await readRecord<VisualThumbnailSourceRecord>(SOURCE_STORE_NAME, track.id);
  if (source?.fingerprint === fingerprint && source.unavailable) return null;

  const key = getVisualThumbnailRenditionKey(track.id, fingerprint, maxEdge);
  const cached = await readRecord<VisualThumbnailRenditionRecord>(RENDITION_STORE_NAME, key);
  if (cached) {
    void touchRendition(cached);
    return cached;
  }

  const file = await resolveTrackFile(track);
  // A remembered handle may be temporarily unavailable until the user grants
  // permission. Do not persist that transient state as a decode failure.
  if (!file) return null;
  const rendered = track.kind === 'image'
    ? await createImageThumbnail(file, maxEdge)
    : await createVideoThumbnail(file, maxEdge);
  const sourceRecord: VisualThumbnailSourceRecord = {
    sourceKey: track.id,
    fingerprint,
    unavailable: !rendered,
    checkedAt: Date.now()
  };
  if (!rendered) {
    await writeSourceAndRendition(sourceRecord);
    return null;
  }

  const rendition: VisualThumbnailRenditionRecord = {
    key,
    sourceKey: track.id,
    fingerprint,
    maxEdge,
    blob: rendered.blob,
    width: rendered.width,
    height: rendered.height,
    byteSize: rendered.blob.size,
    lastAccessed: Date.now()
  };
  await writeSourceAndRendition(sourceRecord, rendition);
  scheduleCachePrune();
  return rendition;
}

export function getCachedVisualThumbnail(
  track: TrackItem,
  maxEdge = VISUAL_THUMBNAIL_SIZE
): Promise<CachedVisualThumbnail | null> {
  if (!isVisualTrack(track)) return Promise.resolve(null);
  const edge = normalizeMaxEdge(maxEdge);
  const loadKey = getVisualThumbnailRenditionKey(
    track.id,
    getVisualThumbnailSourceFingerprint(track),
    edge
  );
  const pending = pendingLoads.get(loadKey);
  if (pending) return pending;
  const request = loadVisualThumbnail(track, edge)
    .catch(() => null)
    .finally(() => pendingLoads.delete(loadKey));
  pendingLoads.set(loadKey, request);
  return request;
}
