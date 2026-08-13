import type { MediaEntity, PlaylistPlaybackOptions, PlaylistRepeatMode, PlaylistSelection } from '$lib/contracts/catalog';
import { normalizeTrackRating } from '$lib/media/track-rating';
import { projectTrackMetadata } from '$lib/media/track-metadata';
import { logInfo } from '$lib/logging/api';
import { openBrowserDatabase } from '$lib/persistence/browser-indexed-db';
import {
  defineDatabase,
  defineStore,
  runTransaction
} from '$lib/persistence/indexed-db';

export interface StoredMediaEntity {
  id: string;
  path: string;
  name: string;
  format: string;
  kind: MediaEntity['kind'];
  size: number;
  lastModified: number;
  sourceFolderId?: string;
  metadata?: MediaEntity['metadata'];
  rating?: number;
  subsong?: number;
}

export interface StoredPlaylistState {
  items?: StoredMediaEntity[];
  selection: PlaylistSelection;
  playbackOptions?: PlaylistPlaybackOptions;
}

export const defaultPlaybackOptions: PlaylistPlaybackOptions = {
  shuffle: false,
  repeatMode: 'off'
};

// v2 intentionally discards the pre-cutover handle-bearing collection record shape.
const PLAYLIST_DB_VERSION = 2;
const PLAYLIST_STORE_NAME = 'playlist';
const PLAYLIST_STATE_KEY = 'state';

export function normalizeStoredItem(value: unknown): StoredMediaEntity | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<StoredMediaEntity>;
  const subsong =
    typeof source.subsong === 'number' && Number.isFinite(source.subsong) && source.subsong >= 0
      ? Math.trunc(source.subsong)
      : undefined;
  const rating = normalizeTrackRating(source.rating);

  if (
    typeof source.id !== 'string' ||
    typeof source.path !== 'string' ||
    typeof source.name !== 'string' ||
    typeof source.format !== 'string' ||
    (source.kind !== 'stream' && source.kind !== 'module' && source.kind !== 'video') ||
    typeof source.size !== 'number'
  ) {
    return null;
  }

  return {
    id: source.id,
    path: source.path,
    name: source.name,
    format: source.format,
    kind: source.kind,
    size: source.size,
    lastModified: typeof source.lastModified === 'number' ? source.lastModified : 0,
    sourceFolderId: typeof source.sourceFolderId === 'string' ? source.sourceFolderId : undefined,
    metadata: projectTrackMetadata(source.metadata),
    ...(rating !== undefined ? { rating } : {}),
    ...(subsong !== undefined ? { subsong } : {})
  };
}

export function restoreStoredItem(value: unknown): MediaEntity | null {
  const item = normalizeStoredItem(value);
  if (!item) return null;

  return {
    id: item.id,
    path: item.path,
    sourceFolderId: item.sourceFolderId,
    name: item.name,
    format: item.format,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    metadata: item.metadata,
    rating: item.rating,
    subsong: item.subsong
  };
}

export function serializeItem(item: MediaEntity): StoredMediaEntity {
  const rating = normalizeTrackRating(item.rating);

  return {
    id: item.id,
    path: item.path,
    name: item.name,
    format: item.format,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    sourceFolderId: item.sourceFolderId,
    metadata: projectTrackMetadata(item.metadata),
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

function playlistDatabaseSpec(dbName: string) {
  return defineDatabase({
    name: dbName,
    version: PLAYLIST_DB_VERSION,
    stores: {
      [PLAYLIST_STORE_NAME]: defineStore<StoredPlaylistState, string>()({})
    }
  });
}

export async function readStoredState(dbName: string): Promise<StoredPlaylistState | null> {
  const spec = playlistDatabaseSpec(dbName);
  const connection = await openBrowserDatabase(spec);
  try {
    const storedState = await runTransaction(connection, {
      stores: [PLAYLIST_STORE_NAME],
      mode: 'readonly',
      operation: `read collection ${dbName}`
    }, (transaction) => transaction.store(PLAYLIST_STORE_NAME).get(PLAYLIST_STATE_KEY));
    if (!storedState || typeof storedState !== 'object') return null;
    logInfo('library', 'Collection restored from IndexedDB', {
      database: dbName,
      items: storedState.items?.length ?? 0
    });
    return storedState;
  } finally {
    await connection.close();
  }
}

export async function persistStoredState(dbName: string, state: StoredPlaylistState): Promise<void> {
  const spec = playlistDatabaseSpec(dbName);
  const connection = await openBrowserDatabase(spec);
  try {
    await runTransaction(connection, {
      stores: [PLAYLIST_STORE_NAME],
      mode: 'readwrite',
      operation: `persist collection ${dbName}`,
      durability: 'strict'
    }, async (transaction) => {
      await transaction.store(PLAYLIST_STORE_NAME).put(state, PLAYLIST_STATE_KEY);
    });
  } finally {
    await connection.close();
  }
}
