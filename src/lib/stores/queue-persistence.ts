import type { TrackItem, PlaybackOptions, RepeatMode, TrackSelection } from '$lib/types';
import { normalizeTrackRating } from '$lib/services/track-ratings';
import { logInfo } from '$lib/services/logging';

export interface StoredTrackItem {
  id: string;
  name: string;
  extension: string;
  kind: TrackItem['kind'];
  size: number;
  lastModified: number;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  metadata?: TrackItem['metadata'];
  rating?: number;
  subsong?: number;
}

export interface StoredQueueState {
  items?: StoredTrackItem[];
  selection: TrackSelection;
  playbackOptions?: PlaybackOptions;
}

export const defaultPlaybackOptions: PlaybackOptions = {
  shuffle: false,
  repeatMode: 'off'
};

const QUEUE_DB_VERSION = 2;
const QUEUE_STORE_NAME = 'queue';
const QUEUE_STATE_KEY = 'state';

function isFileSystemFileHandle(value: unknown): value is FileSystemFileHandle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const source = value as Partial<FileSystemFileHandle>;
  return source.kind === 'file' && typeof source.getFile === 'function';
}

export function normalizeStoredItem(value: unknown): StoredTrackItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<StoredTrackItem> & { file?: unknown };
  const subsong =
    typeof source.subsong === 'number' && Number.isFinite(source.subsong) && source.subsong >= 0
      ? Math.trunc(source.subsong)
      : undefined;
  const rating = normalizeTrackRating(source.rating);

  if (
    typeof source.id !== 'string' ||
    typeof source.name !== 'string' ||
    typeof source.extension !== 'string' ||
    (source.kind !== 'stream' && source.kind !== 'module' && source.kind !== 'video') ||
    typeof source.size !== 'number'
  ) {
    return null;
  }

  return {
    id: source.id,
    name: source.name,
    extension: source.extension,
    kind: source.kind,
    size: source.size,
    lastModified: typeof source.lastModified === 'number' ? source.lastModified : 0,
    fileHandle: isFileSystemFileHandle(source.fileHandle) ? source.fileHandle : undefined,
    path: typeof source.path === 'string' ? source.path : undefined,
    sourceFolderId: typeof source.sourceFolderId === 'string' ? source.sourceFolderId : undefined,
    metadata: source.metadata,
    ...(rating !== undefined ? { rating } : {}),
    ...(subsong !== undefined ? { subsong } : {})
  };
}

export function restoreStoredItem(value: unknown): TrackItem | null {
  const item = normalizeStoredItem(value);

  if (!item?.fileHandle) {
    return null;
  }

  return {
    id: item.id,
    fileHandle: item.fileHandle,
    path: item.path,
    sourceFolderId: item.sourceFolderId,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    metadata: item.metadata,
    rating: item.rating,
    subsong: item.subsong
  };
}

export function serializeItem(item: TrackItem): StoredTrackItem | null {
  if (!item.fileHandle) {
    return null;
  }

  const rating = normalizeTrackRating(item.rating);

  return {
    id: item.id,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    fileHandle: item.fileHandle,
    path: item.path,
    sourceFolderId: item.sourceFolderId,
    metadata: item.metadata,
    ...(rating !== undefined ? { rating } : {}),
    ...(item.subsong !== undefined ? { subsong: item.subsong } : {})
  };
}

export function normalizePlaybackOptions(value: unknown): PlaybackOptions {
  const source = value && typeof value === 'object' ? (value as Partial<PlaybackOptions>) : {};
  const repeatMode: RepeatMode =
    source.repeatMode === 'one' || source.repeatMode === 'all' ? source.repeatMode : 'off';

  return {
    shuffle: source.shuffle === true,
    repeatMode
  };
}

async function openQueueDatabase(dbName: string): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    const request = window.indexedDB.open(dbName, QUEUE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        database.createObjectStore(QUEUE_STORE_NAME);
      }

      if (database.objectStoreNames.contains('playlist')) {
        database.deleteObjectStore('playlist');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('collection-database-open-failed'));
  });
}

export async function readStoredState(dbName: string): Promise<StoredQueueState | null> {
  const database = await openQueueDatabase(dbName);

  if (!database) {
    return null;
  }

  return await new Promise((resolve) => {
    const transaction = database.transaction(QUEUE_STORE_NAME, 'readonly');
    const store = transaction.objectStore(QUEUE_STORE_NAME);
    const request = store.get(QUEUE_STATE_KEY);

    request.onsuccess = () => {
      const value = request.result;

      if (!value || typeof value !== 'object') {
        resolve(null);
        return;
      }

      const storedState = value as StoredQueueState;
      logInfo('library', 'Collection restored from IndexedDB', { database: dbName, items: storedState.items?.length ?? 0 });
      resolve(storedState);
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

export async function persistStoredState(dbName: string, state: StoredQueueState): Promise<void> {
  const database = await openQueueDatabase(dbName);

  if (!database) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(QUEUE_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    store.put(state, QUEUE_STATE_KEY);

    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = (event) => {
      const error = (event.target as IDBTransaction | null)?.error ?? new Error('collection-persistence-failed');
      database.close();
      reject(error);
    };
    transaction.onabort = (event) => {
      const error = (event.target as IDBTransaction | null)?.error ?? new Error('collection-persistence-aborted');
      database.close();
      reject(error);
    };
  });
}
