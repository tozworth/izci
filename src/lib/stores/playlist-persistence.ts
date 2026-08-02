import type { PlaylistItem, PlaylistPlaybackOptions, PlaylistRepeatMode, PlaylistSelection } from '$lib/types';
import { normalizeTrackRating } from '$lib/services/track-ratings';

export interface StoredPlaylistItem {
  id: string;
  name: string;
  extension: string;
  kind: PlaylistItem['kind'];
  size: number;
  lastModified: number;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  metadata?: PlaylistItem['metadata'];
  rating?: number;
  subsong?: number;
}

export interface StoredPlaylistState {
  items?: StoredPlaylistItem[];
  selection: PlaylistSelection;
  playbackOptions?: PlaylistPlaybackOptions;
}

export const defaultPlaybackOptions: PlaylistPlaybackOptions = {
  shuffle: false,
  repeatMode: 'off'
};

const PLAYLIST_DB_VERSION = 1;
const PLAYLIST_STORE_NAME = 'playlist';
const PLAYLIST_STATE_KEY = 'state';

function isFileSystemFileHandle(value: unknown): value is FileSystemFileHandle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const source = value as Partial<FileSystemFileHandle>;
  return source.kind === 'file' && typeof source.getFile === 'function';
}

export function normalizeStoredItem(value: unknown): StoredPlaylistItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<StoredPlaylistItem> & { file?: unknown };
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

export function serializeItem(item: PlaylistItem): StoredPlaylistItem | null {
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

export function normalizePlaybackOptions(value: unknown): PlaylistPlaybackOptions {
  const source = value && typeof value === 'object' ? (value as Partial<PlaylistPlaybackOptions>) : {};
  const repeatMode: PlaylistRepeatMode =
    source.repeatMode === 'one' || source.repeatMode === 'all' ? source.repeatMode : 'off';

  return {
    shuffle: source.shuffle === true,
    repeatMode
  };
}

async function openPlaylistDatabase(dbName: string): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(dbName, PLAYLIST_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(PLAYLIST_STORE_NAME)) {
        database.createObjectStore(PLAYLIST_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function readStoredState(dbName: string): Promise<StoredPlaylistState | null> {
  const database = await openPlaylistDatabase(dbName);

  if (!database) {
    return null;
  }

  return await new Promise((resolve) => {
    const transaction = database.transaction(PLAYLIST_STORE_NAME, 'readonly');
    const store = transaction.objectStore(PLAYLIST_STORE_NAME);
    const request = store.get(PLAYLIST_STATE_KEY);

    request.onsuccess = () => {
      const value = request.result;

      if (!value || typeof value !== 'object') {
        resolve(null);
        return;
      }

      resolve(value as StoredPlaylistState);
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

export async function persistStoredState(dbName: string, state: StoredPlaylistState): Promise<void> {
  const database = await openPlaylistDatabase(dbName);

  if (!database) {
    return;
  }

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(PLAYLIST_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(PLAYLIST_STORE_NAME);

    store.put(state, PLAYLIST_STATE_KEY);

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
