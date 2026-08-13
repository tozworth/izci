import { get, writable, type Readable } from 'svelte/store';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { version as appVersion } from '../../../package.json';
import { prepareImportedFiles } from '$lib/services/file-verification';
import {
  filesystemFolders,
  type LibraryFolderMode
} from '$lib/services/filesystem-folders';
import {
  mergePlaybackProgress,
  normalizePlaybackProgressRecord,
  readAllPlaybackProgress,
  type PlaybackProgressRecord
} from '$lib/services/playback-progress';
import { favoritesStore, libraryStore } from '$lib/stores/playlist';
import { normalizeStoredItem } from '$lib/stores/playlist-persistence';
import { trackSettings } from '$lib/stores/track-settings';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { TrackMetadata } from '$lib/contracts/media-metadata';
import { normalizeTrackRating } from '$lib/media/track-rating';
import {
  buildMediaEntities,
  getFavoriteIdentity,
  getTrackIdentity,
  readDirectoryFiles,
  readFileHandleFiles
} from '$lib/utils/files';
import {
  BACKED_UP_SETTINGS_KEYS,
  exportBackupSettings,
  isBackedUpSetting,
  restoreBackupSettings,
  sanitizeBackupSetting
} from '$lib/services/backup-registry';
import {
  openBrowserDatabase,
  registerBrowserPersistenceOwner
} from '$lib/persistence/browser-indexed-db';
import { defineDatabase, defineStore, runTransaction } from '$lib/persistence/indexed-db';
import { logWarning } from '$lib/logging/api';
import { mediaSources } from '$lib/media/media-source';
import { projectTrackMetadata } from '$lib/media/track-metadata';
import {
  planLibraryFolderReconciliation,
  type CurrentMediaSourceHandle,
  type ScannedLibraryFolderEntry
} from '$lib/collections/library-folder-plan';

export const BACKUP_EXTENSION = '.izci';
export const BACKUP_MIME_TYPE = 'application/vnd.izci.backup+zip';
export const BACKUP_FORMAT_VERSION = 2;
export const BACKUP_MAX_COMPRESSED_BYTES = 32 * 1_024 * 1_024;
export const BACKUP_MAX_UNCOMPRESSED_BYTES = 128 * 1_024 * 1_024;
export const BACKUP_MAX_JSON_STRING_LENGTH = 64 * 1_024;
export const BACKUP_MAX_LIBRARY_RECORDS = 100_000;
export const BACKUP_MAX_FAVORITE_RECORDS = 100_000;
export const BACKUP_MAX_FOLDER_RECORDS = 10_000;
export const BACKUP_MAX_PROGRESS_RECORDS = 100_000;

const BACKUP_MAX_SETTINGS_RECORDS = 256;
const BACKUP_MAX_JSON_DEPTH = 64;
const BACKUP_MAX_JSON_NODES = 1_000_000;
export const BACKUP_ENTRY_MAX_BYTES = {
  'manifest.json': 64 * 1_024,
  'settings.json': 16 * 1_024 * 1_024,
  'library.json': 64 * 1_024 * 1_024,
  'folders.json': 8 * 1_024 * 1_024,
  'favorites.json': 32 * 1_024 * 1_024,
  'progress.json': 32 * 1_024 * 1_024
} as const;

type BackupEntryName = keyof typeof BACKUP_ENTRY_MAX_BYTES;

const BACKUP_DATABASE_NAME = 'izci-backup-restore';
const BACKUP_DATABASE_VERSION = 1;
const BACKUP_STORE_NAME = 'restore';
const BACKUP_STATE_KEY = 'pending';
const BACKUP_CHANNEL_NAME = 'izci-backup-restore';

export { BACKED_UP_SETTINGS_KEYS } from '$lib/services/backup-registry';

export interface BackupManifest {
  kind: 'izci-backup';
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  sourceOrigin: string;
  contents: {
    settings: number;
    libraryTracks: number;
    folders: number;
    favorites: number;
    playbackProgress: number;
  };
}

export interface PortableTrackRecord {
  id: string;
  name: string;
  format: string;
  kind: MediaEntity['kind'];
  size: number;
  lastModified: number;
  path: string;
  sourceFolderId?: string;
  metadata?: TrackMetadata;
  rating?: number;
  subsong?: number;
}

export interface PortableFolderRecord {
  id: string;
  name: string;
  addedAt: number;
  libraryMode: LibraryFolderMode | null;
}

export interface BackupArchiveData {
  manifest: BackupManifest;
  settings: Record<string, unknown>;
  library: PortableTrackRecord[];
  folders: PortableFolderRecord[];
  favorites: PortableTrackRecord[];
  progress: PlaybackProgressRecord[];
}

export interface PendingBackupRestore {
  createdAt: string;
  sourceOrigin: string;
  folders: PortableFolderRecord[];
  tracks: PortableTrackRecord[];
  favorites: PortableTrackRecord[];
}

const backupDatabaseSpec = defineDatabase({
  name: BACKUP_DATABASE_NAME,
  version: BACKUP_DATABASE_VERSION,
  stores: {
    [BACKUP_STORE_NAME]: defineStore<PendingBackupRestore, string>()({})
  }
});

export interface BackupRestoreResult {
  manifest: BackupManifest;
  settingsRestored: number;
  tracksMatched: number;
  tracksPending: number;
  foldersPending: number;
  favoritesRestored: number;
  progressRestored: number;
}

export interface LocateRestoreResult {
  status: 'success' | 'mismatch';
  matchedTracks: number;
  remainingTracks: number;
}

const EMPTY_PENDING_RESTORE: PendingBackupRestore = {
  createdAt: '',
  sourceOrigin: '',
  folders: [],
  tracks: [],
  favorites: []
};

function portableTrack(item: MediaEntity): PortableTrackRecord {
  return {
    id: item.id,
    name: item.name,
    format: item.format,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    path: item.path,
    sourceFolderId: item.sourceFolderId,
    metadata: projectTrackMetadata(item.metadata),
    rating: normalizeTrackRating(item.rating),
    ...(item.subsong !== undefined ? { subsong: item.subsong } : {})
  };
}

function inferredFolderName(track: PortableTrackRecord): string {
  const normalizedPath = track.path?.replace(/\\/g, '/').replace(/^\/+/, '');
  const firstSegment = normalizedPath?.split('/')[0]?.trim();
  return firstSegment || 'Library folder';
}

function folderTrackKey(
  track: Pick<PortableTrackRecord, 'path' | 'name' | 'size' | 'subsong'>,
  rootName: string
): string {
  const normalizedPath = track.path?.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalizedPath?.split('/') ?? [];
  if (segments[0]?.toLocaleLowerCase() === rootName.toLocaleLowerCase()) segments.shift();
  const relativePath = segments.join('/') || track.name;
  return `${relativePath.toLocaleLowerCase()}:${track.size}:subsong:${track.subsong ?? 'all'}`;
}

function folderSourceKey(
  track: Pick<PortableTrackRecord, 'path' | 'name' | 'size'>,
  rootName: string
): string {
  return folderTrackKey({ ...track }, rootName).replace(/:subsong:all$/, '');
}

function normalizePortableTrack(value: unknown): PortableTrackRecord | null {
  const normalized = normalizeStoredItem(value);
  if (!normalized) return null;
  return normalized;
}

function normalizePortableFolder(value: unknown): PortableFolderRecord | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<PortableFolderRecord>;
  if (typeof source.id !== 'string' || typeof source.name !== 'string') return null;
  return {
    id: source.id,
    name: source.name,
    addedAt: typeof source.addedAt === 'number' && Number.isFinite(source.addedAt)
      ? source.addedAt
      : Date.now(),
    libraryMode: source.libraryMode === 'manual' || source.libraryMode === 'launch'
      ? source.libraryMode
      : null
  };
}

function normalizeManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('invalid-backup');
  const source = value as Partial<BackupManifest>;
  if (source.kind !== 'izci-backup' || typeof source.formatVersion !== 'number') {
    throw new Error('invalid-backup');
  }
  if (source.formatVersion !== BACKUP_FORMAT_VERSION) throw new Error('unsupported-version');
  if (
    typeof source.createdAt !== 'string' ||
    typeof source.appVersion !== 'string' ||
    typeof source.sourceOrigin !== 'string' ||
    !source.contents ||
    typeof source.contents !== 'object'
  ) {
    throw new Error('invalid-backup');
  }
  const contents = source.contents as BackupManifest['contents'];
  for (const value of Object.values(contents)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid-backup');
  }
  return source as BackupManifest;
}

function parseJsonFile(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name];
  if (!bytes) throw new Error('invalid-backup');
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error('invalid-backup');
  }
}

function backupEntryLimit(name: string): number | undefined {
  return Object.prototype.hasOwnProperty.call(BACKUP_ENTRY_MAX_BYTES, name)
    ? BACKUP_ENTRY_MAX_BYTES[name as BackupEntryName]
    : undefined;
}

function assertBoundedJson(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > BACKUP_MAX_JSON_NODES || current.depth > BACKUP_MAX_JSON_DEPTH) {
      throw new Error('invalid-backup');
    }
    if (typeof current.value === 'string') {
      if (current.value.length > BACKUP_MAX_JSON_STRING_LENGTH) {
        throw new Error('invalid-backup');
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    for (const [key, nested] of Object.entries(current.value)) {
      if (key.length > BACKUP_MAX_JSON_STRING_LENGTH) throw new Error('invalid-backup');
      pending.push({ value: nested, depth: current.depth + 1 });
    }
  }
}

function assertRecordLimit(records: readonly unknown[], maximum: number): void {
  if (records.length > maximum) throw new Error('invalid-backup');
}

export function encodeBackupArchive(data: BackupArchiveData): Uint8Array {
  const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));
  return zipSync(
    {
      'manifest.json': json(data.manifest),
      'settings.json': json(data.settings),
      'library.json': json(data.library),
      'folders.json': json(data.folders),
      'favorites.json': json(data.favorites),
      'progress.json': json(data.progress)
    },
    { level: 6 }
  );
}

export function decodeBackupArchive(bytes: Uint8Array): BackupArchiveData {
  if (bytes.byteLength > BACKUP_MAX_COMPRESSED_BYTES) throw new Error('invalid-backup');

  let files: Record<string, Uint8Array>;
  const seenEntries = new Set<string>();
  let uncompressedBytes = 0;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        const entryLimit = backupEntryLimit(entry.name);
        if (
          entryLimit === undefined
          || seenEntries.has(entry.name)
          || !Number.isSafeInteger(entry.originalSize)
          || entry.originalSize < 0
          || entry.originalSize > entryLimit
          || (entry.compression !== 0 && entry.compression !== 8)
        ) {
          throw new Error('invalid-backup');
        }
        seenEntries.add(entry.name);
        uncompressedBytes += entry.originalSize;
        if (uncompressedBytes > BACKUP_MAX_UNCOMPRESSED_BYTES) {
          throw new Error('invalid-backup');
        }
        return true;
      }
    });
  } catch {
    throw new Error('invalid-backup');
  }

  if (seenEntries.size !== Object.keys(BACKUP_ENTRY_MAX_BYTES).length) {
    throw new Error('invalid-backup');
  }

  const manifest = normalizeManifest(parseJsonFile(files, 'manifest.json'));
  const rawSettings = parseJsonFile(files, 'settings.json');
  const rawLibrary = parseJsonFile(files, 'library.json');
  const rawFolders = parseJsonFile(files, 'folders.json');
  const rawFavorites = parseJsonFile(files, 'favorites.json');
  const rawProgress = parseJsonFile(files, 'progress.json');

  if (
    !rawSettings ||
    typeof rawSettings !== 'object' ||
    Array.isArray(rawSettings) ||
    !Array.isArray(rawLibrary) ||
    !Array.isArray(rawFolders) ||
    !Array.isArray(rawFavorites) ||
    !Array.isArray(rawProgress)
  ) {
    throw new Error('invalid-backup');
  }

  if (Object.keys(rawSettings).length > BACKUP_MAX_SETTINGS_RECORDS) {
    throw new Error('invalid-backup');
  }
  assertRecordLimit(rawLibrary, BACKUP_MAX_LIBRARY_RECORDS);
  assertRecordLimit(rawFolders, BACKUP_MAX_FOLDER_RECORDS);
  assertRecordLimit(rawFavorites, BACKUP_MAX_FAVORITE_RECORDS);
  assertRecordLimit(rawProgress, BACKUP_MAX_PROGRESS_RECORDS);
  for (const value of [manifest, rawSettings, rawLibrary, rawFolders, rawFavorites, rawProgress]) {
    assertBoundedJson(value);
  }

  const settings = Object.fromEntries(
    Object.entries(rawSettings)
      .filter(([key]) => isBackedUpSetting(key))
      .map(([key, value]) => [key, sanitizeBackupSetting(key, value)])
  );
  return {
    manifest,
    settings,
    library: rawLibrary.map(normalizePortableTrack).filter((track): track is PortableTrackRecord => track !== null),
    folders: rawFolders.map(normalizePortableFolder).filter((folder): folder is PortableFolderRecord => folder !== null),
    favorites: rawFavorites.map(normalizePortableTrack).filter((track): track is PortableTrackRecord => track !== null),
    progress: rawProgress
      .map(normalizePlaybackProgressRecord)
      .filter((record): record is PlaybackProgressRecord => record !== null)
  };
}

async function readPendingRestore(): Promise<PendingBackupRestore> {
  const connection = await openBrowserDatabase(backupDatabaseSpec);
  try {
    return await runTransaction(connection, {
      stores: [BACKUP_STORE_NAME],
      mode: 'readonly',
      operation: 'read pending backup restore'
    }, async (transaction) => normalizePendingRestore(
      await transaction.store(BACKUP_STORE_NAME).get(BACKUP_STATE_KEY)
    ));
  } finally {
    await connection.close();
  }
}

async function writePendingRestore(state: PendingBackupRestore): Promise<void> {
  const connection = await openBrowserDatabase(backupDatabaseSpec);
  try {
    await runTransaction(connection, {
      stores: [BACKUP_STORE_NAME],
      mode: 'readwrite',
      operation: 'persist pending backup restore',
      durability: 'strict'
    }, async (transaction) => {
      await transaction.store(BACKUP_STORE_NAME).put(state, BACKUP_STATE_KEY);
    });
  } finally {
    await connection.close();
  }
}

function normalizePendingRestore(value: unknown): PendingBackupRestore {
  if (!value || typeof value !== 'object') return EMPTY_PENDING_RESTORE;
  const source = value as Partial<PendingBackupRestore>;
  return {
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
    sourceOrigin: typeof source.sourceOrigin === 'string' ? source.sourceOrigin : '',
    folders: Array.isArray(source.folders)
      ? source.folders.map(normalizePortableFolder).filter((folder): folder is PortableFolderRecord => folder !== null)
      : [],
    tracks: Array.isArray(source.tracks)
      ? source.tracks.map(normalizePortableTrack).filter((track): track is PortableTrackRecord => track !== null)
      : [],
    favorites: Array.isArray(source.favorites)
      ? source.favorites.map(normalizePortableTrack).filter((track): track is PortableTrackRecord => track !== null)
      : []
  };
}

function createPendingRestoreStore(): Readable<PendingBackupRestore> & {
  ready(): Promise<void>;
  getSnapshot(): PendingBackupRestore;
  readonly persistenceStatus: Readable<{ state: 'hydrating' | 'ready' | 'busy' | 'degraded' | 'disposed'; error: unknown | null }>;
  replace(state: PendingBackupRestore): Promise<void>;
  update(updater: (state: PendingBackupRestore) => PendingBackupRestore): Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
} {
  const store = writable(EMPTY_PENDING_RESTORE);
  const persistenceStatus = writable<{
    state: 'hydrating' | 'ready' | 'busy' | 'degraded' | 'disposed';
    error: unknown | null;
  }>({ state: typeof window === 'undefined' ? 'ready' : 'hydrating', error: null });
  let snapshot = EMPTY_PENDING_RESTORE;
  let channel: BroadcastChannel | null = null;
  let disposed = false;
  let mutationQueue = Promise.resolve();
  store.subscribe((value) => (snapshot = value));

  const load = async (): Promise<void> => {
    if (disposed) return;
    persistenceStatus.set({ state: 'busy', error: null });
    try {
      store.set(await readPendingRestore());
      persistenceStatus.set({ state: 'ready', error: null });
    } catch (error) {
      persistenceStatus.set({ state: 'degraded', error });
      throw error;
    }
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.then(operation, operation);
    mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  };
  const handleChannelMessage = (): void => {
    void enqueue(load).catch((error) => {
      logWarning('library', 'Pending backup restore refresh failed', { error });
    });
  };
  const readyPromise = typeof window === 'undefined' ? Promise.resolve() : enqueue(load);
  if (typeof window !== 'undefined') {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(BACKUP_CHANNEL_NAME);
      channel.addEventListener('message', handleChannelMessage);
    }
    void readyPromise.catch((error) => {
      logWarning('library', 'Pending backup restore hydration failed', { error });
    });
  }

  async function replace(state: PendingBackupRestore): Promise<void> {
    const normalized = normalizePendingRestore(state);
    await enqueue(async () => {
      persistenceStatus.set({ state: 'busy', error: null });
      try {
        await writePendingRestore(normalized);
        store.set(normalized);
        channel?.postMessage({ type: 'changed' });
        persistenceStatus.set({ state: 'ready', error: null });
      } catch (error) {
        persistenceStatus.set({ state: 'degraded', error });
        throw error;
      }
    });
  }

  const controller = {
    subscribe: store.subscribe,
    ready: () => readyPromise,
    getSnapshot: () => snapshot,
    persistenceStatus: { subscribe: persistenceStatus.subscribe },
    replace,
    async update(updater: (state: PendingBackupRestore) => PendingBackupRestore) {
      await readyPromise.catch(() => undefined);
      await replace(updater(snapshot));
    },
    flush: () => mutationQueue,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await mutationQueue;
      channel?.removeEventListener('message', handleChannelMessage);
      channel?.close();
      channel = null;
      persistenceStatus.set({ state: 'disposed', error: null });
    }
  };
  registerBrowserPersistenceOwner({
    label: 'pending backup restore',
    flush: controller.flush,
    dispose: controller.dispose
  });
  return controller;
}

export const pendingBackupRestore = createPendingRestoreStore();

export async function createBackupArchive(): Promise<{
  blob: Blob;
  fileName: string;
  manifest: BackupManifest;
}> {
  await Promise.all([
    libraryStore.ready(),
    favoritesStore.ready(),
    filesystemFolders.ready()
  ]);
  await filesystemFolders.refresh();
  const library = get(libraryStore.items).map(portableTrack);
  const favorites = get(favoritesStore.items).map(portableTrack);
  const folders = filesystemFolders.getSnapshot().map((folder): PortableFolderRecord => ({
    id: folder.id,
    name: folder.name,
    addedAt: folder.addedAt,
    libraryMode: folder.libraryMode
  }));
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  for (const track of [...library, ...favorites]) {
    if (!track.sourceFolderId || knownFolderIds.has(track.sourceFolderId)) continue;
    folders.push({
      id: track.sourceFolderId,
      name: inferredFolderName(track),
      addedAt: Date.now(),
      libraryMode: 'manual'
    });
    knownFolderIds.add(track.sourceFolderId);
  }
  const progress = await readAllPlaybackProgress();
  const settings = exportBackupSettings();
  const createdAt = new Date().toISOString();
  const manifest: BackupManifest = {
    kind: 'izci-backup',
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt,
    appVersion,
    sourceOrigin: window.location.origin,
    contents: {
      settings: Object.keys(settings).length,
      libraryTracks: library.length,
      folders: folders.length,
      favorites: favorites.length,
      playbackProgress: progress.length
    }
  };
  const bytes = encodeBackupArchive({ manifest, settings, library, folders, favorites, progress });
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const date = createdAt.slice(0, 10);
  return {
    blob: new Blob([blobBytes], { type: BACKUP_MIME_TYPE }),
    fileName: `izci-backup-${date}${BACKUP_EXTENSION}`,
    manifest
  };
}

function mergeMetadata(current: TrackMetadata | undefined, restored: TrackMetadata | undefined): TrackMetadata | undefined {
  if (!current && !restored) return undefined;
  const playCount = Math.max(current?.playCount ?? 0, restored?.playCount ?? 0);
  return {
    ...current,
    ...restored,
    ...(playCount > 0 ? { playCount } : {})
  };
}

function mergeRating(current: number | undefined, restored: number | undefined): number | undefined {
  return normalizeTrackRating(restored) ?? normalizeTrackRating(current);
}

function matchExistingTracks(records: PortableTrackRecord[]): {
  matched: number;
  pending: PortableTrackRecord[];
} {
  const current = get(libraryStore.items);
  const existingByIdentity = new Map(current.map((item) => [getTrackIdentity(item), item]));
  const pending: PortableTrackRecord[] = [];
  let matched = 0;
  for (const record of records) {
    const existing = existingByIdentity.get(getTrackIdentity(record));
    if (!existing) {
      pending.push(record);
      continue;
    }
    libraryStore.updateMetadata(existing.id, mergeMetadata(existing.metadata, record.metadata));
    libraryStore.updateRating(existing.id, mergeRating(existing.rating, record.rating));
    matched += 1;
  }
  return { matched, pending };
}

function restoreFavoriteRecord(
  source: MediaEntity,
  record: PortableTrackRecord,
  favoritesByIdentity: Map<string, MediaEntity>
): boolean {
  const identity = getFavoriteIdentity(record);
  const existing = favoritesByIdentity.get(identity);
  if (existing) {
    favoritesStore.updateMetadata(existing.id, mergeMetadata(existing.metadata, record.metadata));
    favoritesStore.updateRating(existing.id, mergeRating(existing.rating, record.rating));
    return true;
  }

  if (!mediaSources.clone(source.id, record.id)) return false;
  const [added] = favoritesStore.add([{
    ...source,
    id: record.id,
    metadata: mergeMetadata(source.metadata, record.metadata),
    rating: mergeRating(source.rating, record.rating),
    ...(record.subsong === undefined ? { subsong: undefined } : { subsong: record.subsong })
  }]);
  if (!added) {
    mediaSources.discard(record.id);
    return false;
  }
  favoritesByIdentity.set(identity, added);
  return true;
}

export function restoreFavorites(records: PortableTrackRecord[]): {
  restored: number;
  pending: PortableTrackRecord[];
} {
  const libraryItems = get(libraryStore.items);
  const libraryByIdentity = new Map(libraryItems.map((item) => [getFavoriteIdentity(item), item]));
  const libraryByTrackIdentity = new Map(libraryItems.map((item) => [getTrackIdentity(item), item]));
  const favoriteByIdentity = new Map(get(favoritesStore.items).map((item) => [getFavoriteIdentity(item), item]));
  const pending: PortableTrackRecord[] = [];
  let restored = 0;
  for (const record of records) {
    const identity = getFavoriteIdentity(record);
    const libraryItem = libraryByIdentity.get(identity) ?? libraryByTrackIdentity.get(getTrackIdentity(record));
    if (!libraryItem) {
      pending.push(record);
      continue;
    }
    if (!restoreFavoriteRecord(libraryItem, record, favoriteByIdentity)) {
      pending.push(record);
      continue;
    }
    restored += 1;
  }
  return { restored, pending };
}

export async function restoreBackupArchive(file: File): Promise<BackupRestoreResult> {
  const data = decodeBackupArchive(new Uint8Array(await file.arrayBuffer()));
  await Promise.all([
    libraryStore.ready(),
    favoritesStore.ready(),
    filesystemFolders.ready(),
    pendingBackupRestore.ready()
  ]);
  const settingsRestored = restoreBackupSettings(data.settings);
  const progressRestored = await mergePlaybackProgress(data.progress);
  const tracks = matchExistingTracks(data.library);
  const favorites = restoreFavorites(data.favorites);
  const pending: PendingBackupRestore = {
    createdAt: data.manifest.createdAt,
    sourceOrigin: data.manifest.sourceOrigin,
    folders: data.folders,
    tracks: tracks.pending,
    favorites: favorites.pending
  };
  await Promise.all([libraryStore.flush(), favoritesStore.flush()]);
  await pendingBackupRestore.replace(pending);
  return {
    manifest: data.manifest,
    settingsRestored,
    tracksMatched: tracks.matched + favorites.restored,
    tracksPending: pending.tracks.length + pending.favorites.length,
    foldersPending: pending.folders.length,
    favoritesRestored: favorites.restored,
    progressRestored
  };
}

export async function locatePendingFolder(
  folderId: string,
  handle: FileSystemDirectoryHandle
): Promise<LocateRestoreResult> {
  await Promise.all([pendingBackupRestore.ready(), libraryStore.ready(), favoritesStore.ready()]);
  const pending = pendingBackupRestore.getSnapshot();
  const descriptor = pending.folders.find((folder) => folder.id === folderId);
  if (!descriptor) return { status: 'mismatch', matchedTracks: 0, remainingTracks: pending.tracks.length };

  const expected = pending.tracks.filter((track) => track.sourceFolderId === folderId);
  const expectedFavorites = pending.favorites.filter((track) => track.sourceFolderId === folderId);
  const expectedByKey = new Map(expected.map((track) => [folderTrackKey(track, descriptor.name), track]));
  const expectedFavoritesBySourceKey = new Map<string, PortableTrackRecord[]>();
  for (const favorite of expectedFavorites) {
    const key = folderSourceKey(favorite, descriptor.name);
    expectedFavoritesBySourceKey.set(key, [
      ...(expectedFavoritesBySourceKey.get(key) ?? []),
      favorite
    ]);
  }
  const files = expected.length + expectedFavorites.length > 0
    ? await prepareImportedFiles(await readDirectoryFiles(handle, {
        maxDepth: trackSettings.getSnapshot().folderNestingLimit
      }))
    : [];
  const discovered = buildMediaEntities(files);
  try {
    const matchedTrackIds = new Set(
      discovered
        .map((track) => expectedByKey.get(folderTrackKey(track, handle.name))?.id)
        .filter((id): id is string => typeof id === 'string')
    );
    const matchedFavoriteIds = new Set(
      discovered
        .flatMap((track) => expectedFavoritesBySourceKey.get(folderSourceKey(track, handle.name)) ?? [])
        .map((track) => track.id)
    );
    if (expected.length + expectedFavorites.length > 0 && matchedTrackIds.size + matchedFavoriteIds.size === 0) {
      return { status: 'mismatch', matchedTracks: 0, remainingTracks: expected.length + expectedFavorites.length };
    }

    const remembered = await filesystemFolders.remember(handle, {
      libraryMode: descriptor.libraryMode,
      preferredId: descriptor.id
    });
    const restoredEntries = discovered.map((item): ScannedLibraryFolderEntry | null => {
      const restored = expectedByKey.get(folderTrackKey(item, handle.name));
      const fileHandle = mediaSources.get(item.id)?.fileHandle;
      if (!fileHandle) return null;
      const restoredId = restored?.id ?? item.id;
      if (!mediaSources.clone(item.id, restoredId)) return null;
      return { entity: {
        ...item,
        id: restoredId,
        sourceFolderId: remembered.id,
        metadata: mergeMetadata(item.metadata, restored?.metadata),
        rating: mergeRating(item.rating, restored?.rating)
      }, fileHandle };
    }).filter((entry): entry is ScannedLibraryFolderEntry => entry !== null);
    const restoredItems = restoredEntries.map((entry) => entry.entity);
    if (descriptor.libraryMode) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const snapshot = libraryStore.getCatalogSnapshot();
        const currentSourceHandles = snapshot.entities.flatMap((entity): CurrentMediaSourceHandle[] => {
          const fileHandle = mediaSources.get(entity.id)?.fileHandle;
          return fileHandle ? [{ entityId: entity.id, fileHandle }] : [];
        });
        const reconciliation = await planLibraryFolderReconciliation({
          catalog: snapshot.entities,
          folderId: remembered.id,
          activeFolderIds: filesystemFolders.getSnapshot()
            .filter((folder) => folder.libraryMode !== null)
            .map((folder) => folder.id),
          scanned: restoredEntries,
          currentSourceHandles,
          createId: () => crypto.randomUUID()
        });
        const applied = await libraryStore.applyCatalogIfRevision(
          snapshot.catalogRevision,
          reconciliation
        );
        if (applied.status === 'applied') break;
        if (attempt === 1) throw new Error('backup-folder-catalog-conflict');
      }
      await filesystemFolders.updateScan(remembered.id, {
        lastScanAt: Date.now(),
        lastScanStatus: 'success',
        lastScanTrackCount: restoredItems.length,
        lastScanFailure: undefined
      });
    } else {
      libraryStore.add(restoredItems.filter((item) => matchedTrackIds.has(item.id)));
    }

    const libraryByFolderKey = new Map(
      get(libraryStore.items)
        .filter((item) => item.sourceFolderId === remembered.id)
        .map((item) => [folderSourceKey(item, handle.name), item])
    );
    const discoveredByFolderKey = new Map(discovered.map((item) => [folderSourceKey(item, handle.name), item]));
    const favoriteByIdentity = new Map(get(favoritesStore.items).map((item) => [getFavoriteIdentity(item), item]));
    const restoredFavoriteIds = new Set<string>();
    for (const favorite of pending.favorites) {
      if (favorite.sourceFolderId !== folderId) continue;
      const key = folderSourceKey(favorite, descriptor.name);
      const materializedItem = libraryByFolderKey.get(key) ?? discoveredByFolderKey.get(key);
      if (!materializedItem) continue;
      if (restoreFavoriteRecord(materializedItem, favorite, favoriteByIdentity)) {
        restoredFavoriteIds.add(favorite.id);
      }
    }

    await Promise.all([libraryStore.flush(), favoritesStore.flush()]);
    await pendingBackupRestore.update((state) => {
      const remainingTracks = state.tracks.filter(
        (track) => track.sourceFolderId !== folderId || !matchedTrackIds.has(track.id)
      );
      const remainingFavorites = state.favorites.filter((favorite) => !restoredFavoriteIds.has(favorite.id));
      const hasRemainingFolderTracks =
        remainingTracks.some((track) => track.sourceFolderId === folderId) ||
        remainingFavorites.some((track) => track.sourceFolderId === folderId);
      return {
        ...state,
        folders: hasRemainingFolderTracks ? state.folders : state.folders.filter((folder) => folder.id !== folderId),
        tracks: remainingTracks,
        favorites: remainingFavorites
      };
    });
    return {
      status: 'success',
      matchedTracks: matchedTrackIds.size + restoredFavoriteIds.size,
      remainingTracks:
        pendingBackupRestore.getSnapshot().tracks.filter((track) => track.sourceFolderId === folderId).length +
        pendingBackupRestore.getSnapshot().favorites.filter((track) => track.sourceFolderId === folderId).length
    };
  } finally {
    for (const item of discovered) mediaSources.discard(item.id);
  }
}

function trackFingerprint(track: Pick<PortableTrackRecord, 'name' | 'size' | 'lastModified'>): string {
  return `${track.name.toLocaleLowerCase()}:${track.size}:${track.lastModified}`;
}

export async function locatePendingFiles(handles: FileSystemFileHandle[]): Promise<LocateRestoreResult> {
  await Promise.all([pendingBackupRestore.ready(), libraryStore.ready(), favoritesStore.ready()]);
  const pending = pendingBackupRestore.getSnapshot();
  const looseTracks = pending.tracks.filter((track) => !track.sourceFolderId);
  const expectedByIdentity = new Map(looseTracks.map((track) => [getTrackIdentity(track), track]));
  const expectedByFingerprint = new Map(looseTracks.map((track) => [trackFingerprint(track), track]));
  const files = await prepareImportedFiles(await readFileHandleFiles(handles));
  const selected = buildMediaEntities(files);
  try {
    const restoredIds = new Set<string>();
    for (const item of selected) {
      const restored = expectedByIdentity.get(getTrackIdentity(item)) ?? expectedByFingerprint.get(trackFingerprint(item));
      if (!restored) continue;
      if (!mediaSources.clone(item.id, restored.id)) continue;
      const candidate = {
        ...item,
        id: restored.id,
        metadata: mergeMetadata(item.metadata, restored.metadata),
        rating: mergeRating(item.rating, restored.rating)
      };
      const [added] = libraryStore.add([candidate]);
      const materializedItem = added ?? libraryStore.findEquivalent(candidate);
      if (!materializedItem) {
        mediaSources.discard(restored.id);
        continue;
      }
      if (materializedItem.id !== restored.id) mediaSources.discard(restored.id);
      restoredIds.add(restored.id);
    }

    const restoredFavoriteIds = new Set<string>();
    const selectedByIdentity = new Map(selected.map((item) => [getFavoriteIdentity(item), item]));
    const selectedByFingerprint = new Map(selected.map((item) => [trackFingerprint(item), item]));
    const favoriteByIdentity = new Map(get(favoritesStore.items).map((item) => [getFavoriteIdentity(item), item]));
    for (const favorite of pending.favorites.filter((track) => !track.sourceFolderId)) {
      const materializedItem = selectedByIdentity.get(getFavoriteIdentity(favorite))
        ?? selectedByFingerprint.get(trackFingerprint(favorite));
      if (!materializedItem) continue;
      if (restoreFavoriteRecord(materializedItem, favorite, favoriteByIdentity)) {
        restoredFavoriteIds.add(favorite.id);
      }
    }
    await Promise.all([libraryStore.flush(), favoritesStore.flush()]);
    await pendingBackupRestore.update((state) => ({
      ...state,
      tracks: state.tracks.filter((track) => !restoredIds.has(track.id)),
      favorites: state.favorites.filter((favorite) => !restoredFavoriteIds.has(favorite.id))
    }));
    const remainingTracks =
      pendingBackupRestore.getSnapshot().tracks.filter((track) => !track.sourceFolderId).length +
      pendingBackupRestore.getSnapshot().favorites.filter((track) => !track.sourceFolderId).length;
    const matchedTracks = restoredIds.size + restoredFavoriteIds.size;
    return {
      status: matchedTracks > 0 ? 'success' : 'mismatch',
      matchedTracks,
      remainingTracks
    };
  } finally {
    for (const item of selected) mediaSources.discard(item.id);
  }
}
