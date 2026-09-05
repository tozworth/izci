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
import { favoritesStore, libraryStore } from '$lib/stores/queue';
import { normalizeStoredItem } from '$lib/stores/queue-persistence';
import { trackSettings } from '$lib/stores/track-settings';
import type { TrackItem, TrackMetadata } from '$lib/types';
import { normalizeTrackRating } from '$lib/services/track-ratings';
import {
  buildTrackItems,
  getFavoriteIdentity,
  getTrackIdentity,
  readDirectoryFiles,
  readFileHandleFiles
} from '$lib/utils/files';

export const BACKUP_EXTENSION = '.izci';
const BACKUP_MIME_TYPE = 'application/vnd.izci.backup+zip';
export const BACKUP_FORMAT_VERSION = 1;

const BACKUP_DATABASE_NAME = 'izci-backup-restore';
const BACKUP_DATABASE_VERSION = 1;
const BACKUP_STORE_NAME = 'restore';
const BACKUP_STATE_KEY = 'pending';
const BACKUP_CHANNEL_NAME = 'izci-backup-restore';

// This is deliberately an allowlist. Coordination, window, update, and transient keys do not belong in backups.
const BACKED_UP_SETTINGS_KEYS = [
  'izci.appearance-settings',
  'izci.multiplayer-settings',
  'izci.library-view-settings.v5',
  'izci.loadout-ui-settings',
  'izci.loadouts',
  'izci.locale',
  'izci.metadata-settings',
  'izci.module-playback-settings.v1',
  'izci.pattern-viewer-settings',
  'izci.playback-settings',
  'izci.player-volume.v1',
  'izci.raf-presets',
  'izci.raf-settings',
  'izci.track-settings',
  'izci.video-settings',
  'izci.visualizer-settings',
  'izci.workspace-panel-layout.v2',
  'izci.workspace-panel-state.v2'
] as const;

interface BackupManifest {
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

interface PortableTrackRecord {
  id: string;
  name: string;
  extension: string;
  kind: TrackItem['kind'];
  size: number;
  lastModified: number;
  path?: string;
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

interface PendingBackupRestore {
  createdAt: string;
  sourceOrigin: string;
  folders: PortableFolderRecord[];
  tracks: PortableTrackRecord[];
  favorites: PortableTrackRecord[];
}

export interface BackupRestoreResult {
  manifest: BackupManifest;
  settingsRestored: number;
  tracksMatched: number;
  tracksPending: number;
  foldersPending: number;
  favoritesRestored: number;
  progressRestored: number;
}

interface LocateRestoreResult {
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

function portableTrack(item: TrackItem): PortableTrackRecord {
  return {
    id: item.id,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    path: item.path,
    sourceFolderId: item.sourceFolderId,
    metadata: item.metadata,
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

function normalizePortableTrack(value: unknown): PortableTrackRecord | null {
  const normalized = normalizeStoredItem(value);
  if (!normalized) return null;
  const { fileHandle: _fileHandle, ...portable } = normalized;
  return portable;
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
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
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

  const allowedSettings = new Set<string>(BACKED_UP_SETTINGS_KEYS);
  const settings = Object.fromEntries(
    Object.entries(rawSettings).filter(([key]) => allowedSettings.has(key))
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

function readSettings(): Record<string, unknown> {
  const settings: Record<string, unknown> = {};
  for (const key of BACKED_UP_SETTINGS_KEYS) {
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    try {
      settings[key] = JSON.parse(raw);
    } catch {
      // Corrupt settings are already treated as defaults by their owning stores.
    }
  }
  return settings;
}

function restoreSettings(settings: Record<string, unknown>): number {
  let restored = 0;
  for (const key of BACKED_UP_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) {
      window.localStorage.setItem(key, JSON.stringify(settings[key]));
      restored += 1;
    } else {
      window.localStorage.removeItem(key);
    }
    // Native storage events only reach other windows. Notify stores in the
    // window performing the restore as well so they cannot overwrite the
    // restored snapshot with stale in-memory state.
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }
  return restored;
}

function openBackupDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(BACKUP_DATABASE_NAME, BACKUP_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        request.result.createObjectStore(BACKUP_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readPendingRestore(): Promise<PendingBackupRestore> {
  const database = await openBackupDatabase();
  if (!database) return EMPTY_PENDING_RESTORE;
  return await new Promise((resolve) => {
    const transaction = database.transaction(BACKUP_STORE_NAME, 'readonly');
    const request = transaction.objectStore(BACKUP_STORE_NAME).get(BACKUP_STATE_KEY);
    request.onsuccess = () => resolve(normalizePendingRestore(request.result));
    request.onerror = () => resolve(EMPTY_PENDING_RESTORE);
    transaction.oncomplete = () => database.close();
    transaction.onerror = transaction.onabort = () => database.close();
  });
}

async function writePendingRestore(state: PendingBackupRestore): Promise<void> {
  const database = await openBackupDatabase();
  if (!database) {
    if (typeof window !== 'undefined') throw new Error('backup-restore-persistence-failed');
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BACKUP_STORE_NAME, 'readwrite');
    transaction.objectStore(BACKUP_STORE_NAME).put(state, BACKUP_STATE_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      const error = transaction.error ?? new Error('backup-restore-persistence-failed');
      database.close();
      reject(error);
    };
  });
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
  replace(state: PendingBackupRestore): Promise<void>;
  update(updater: (state: PendingBackupRestore) => PendingBackupRestore): Promise<void>;
} {
  const store = writable(EMPTY_PENDING_RESTORE);
  let snapshot = EMPTY_PENDING_RESTORE;
  let channel: BroadcastChannel | null = null;
  let resolveReady: (() => void) | null = null;
  const readyPromise = typeof window === 'undefined'
    ? Promise.resolve()
    : new Promise<void>((resolve) => (resolveReady = resolve));
  store.subscribe((value) => (snapshot = value));

  const load = async () => store.set(await readPendingRestore());
  if (typeof window !== 'undefined') {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(BACKUP_CHANNEL_NAME);
      channel.addEventListener('message', () => void load());
    }
    void load().finally(() => {
      resolveReady?.();
      resolveReady = null;
    });
  }

  async function replace(state: PendingBackupRestore): Promise<void> {
    const normalized = normalizePendingRestore(state);
    await writePendingRestore(normalized);
    store.set(normalized);
    channel?.postMessage({ type: 'changed' });
  }

  return {
    subscribe: store.subscribe,
    ready: () => readyPromise,
    getSnapshot: () => snapshot,
    replace,
    async update(updater) {
      await readyPromise;
      await replace(updater(snapshot));
    }
  };
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
  const settings = readSettings();
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
  const lastPlayed = Math.max(current?.lastPlayed ?? 0, restored?.lastPlayed ?? 0);
  return {
    ...current,
    ...restored,
    ...(playCount > 0 ? { playCount } : {}),
    ...(lastPlayed > 0 ? { lastPlayed } : {})
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

function restoreFavorites(records: PortableTrackRecord[]): {
  restored: number;
  pending: PortableTrackRecord[];
} {
  const libraryByIdentity = new Map(get(libraryStore.items).map((item) => [getFavoriteIdentity(item), item]));
  const favoriteByIdentity = new Map(get(favoritesStore.items).map((item) => [getFavoriteIdentity(item), item]));
  const pending: PortableTrackRecord[] = [];
  let restored = 0;
  for (const record of records) {
    const identity = getFavoriteIdentity(record);
    const libraryItem = libraryByIdentity.get(identity);
    if (!libraryItem) {
      pending.push(record);
      continue;
    }
    const existing = favoriteByIdentity.get(identity);
    if (existing) {
      favoritesStore.updateMetadata(existing.id, mergeMetadata(existing.metadata, record.metadata));
      favoritesStore.updateRating(existing.id, mergeRating(existing.rating, record.rating));
    } else {
      favoritesStore.add([{
        ...libraryItem,
        id: record.id,
        metadata: mergeMetadata(libraryItem.metadata, record.metadata),
        rating: mergeRating(libraryItem.rating, record.rating)
      }]);
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
  const settingsRestored = restoreSettings(data.settings);
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

function releaseRuntimeFiles(items: TrackItem[]): TrackItem[] {
  return items.map((item) => {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    return { ...item, file: undefined, objectUrl: undefined };
  });
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
  const expectedFavoriteByKey = new Map(
    expectedFavorites.map((track) => [folderTrackKey(track, descriptor.name), track])
  );
  const files = expected.length + expectedFavorites.length > 0
    ? await prepareImportedFiles(await readDirectoryFiles(handle, {
        maxDepth: trackSettings.getSnapshot().folderNestingLimit
      }))
    : [];
  const discovered = releaseRuntimeFiles(buildTrackItems(files));
  const matchedTrackIds = new Set(
    discovered
      .map((track) => expectedByKey.get(folderTrackKey(track, handle.name))?.id)
      .filter((id): id is string => typeof id === 'string')
  );
  const matchedFavoriteIds = new Set(
    discovered
      .map((track) => expectedFavoriteByKey.get(folderTrackKey(track, handle.name))?.id)
      .filter((id): id is string => typeof id === 'string')
  );
  if (expected.length + expectedFavorites.length > 0 && matchedTrackIds.size + matchedFavoriteIds.size === 0) {
    return { status: 'mismatch', matchedTracks: 0, remainingTracks: expected.length + expectedFavorites.length };
  }

  const remembered = await filesystemFolders.remember(handle, {
    libraryMode: descriptor.libraryMode,
    preferredId: descriptor.id
  });
  const restoredItems = discovered.map((item) => {
    const restored = expectedByKey.get(folderTrackKey(item, handle.name));
    return {
      ...item,
      id: restored?.id ?? item.id,
      sourceFolderId: remembered.id,
      metadata: mergeMetadata(item.metadata, restored?.metadata),
      rating: mergeRating(item.rating, restored?.rating)
    };
  });
  if (descriptor.libraryMode && restoredItems.length > 0) {
    const reconciliation = libraryStore.reconcileFolder(
      remembered.id,
      restoredItems,
      filesystemFolders.getSnapshot().map((folder) => folder.id)
    );
    await filesystemFolders.updateScan(remembered.id, {
      lastScanAt: Date.now(),
      lastScanStatus: 'success',
      lastScanTrackCount: restoredItems.length,
      lastScanFailure: undefined
    });
    void reconciliation;
  } else {
    libraryStore.add(restoredItems.filter((item) => matchedTrackIds.has(item.id)));
  }

  const libraryByFolderKey = new Map(
    get(libraryStore.items)
      .filter((item) => item.sourceFolderId === remembered.id)
      .map((item) => [folderTrackKey(item, handle.name), item])
  );
  const discoveredByFolderKey = new Map(discovered.map((item) => [folderTrackKey(item, handle.name), item]));
  for (const favorite of pending.favorites) {
    if (favorite.sourceFolderId !== folderId) continue;
    const key = folderTrackKey(favorite, descriptor.name);
    const materializedItem = libraryByFolderKey.get(key) ?? discoveredByFolderKey.get(key);
    if (!materializedItem) continue;
    favoritesStore.add([{
      ...materializedItem,
      id: favorite.id,
      metadata: mergeMetadata(materializedItem.metadata, favorite.metadata),
      rating: mergeRating(materializedItem.rating, favorite.rating)
    }]);
  }

  await pendingBackupRestore.update((state) => {
    const remainingTracks = state.tracks.filter(
      (track) => track.sourceFolderId !== folderId || !matchedTrackIds.has(track.id)
    );
    const remainingFavorites = state.favorites.filter((favorite) => !matchedFavoriteIds.has(favorite.id));
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
    matchedTracks: matchedTrackIds.size + matchedFavoriteIds.size,
    remainingTracks:
      pendingBackupRestore.getSnapshot().tracks.filter((track) => track.sourceFolderId === folderId).length +
      pendingBackupRestore.getSnapshot().favorites.filter((track) => track.sourceFolderId === folderId).length
  };
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
  const selected = releaseRuntimeFiles(buildTrackItems(files));
  const restoredIds = new Set<string>();
  const added: TrackItem[] = [];
  for (const item of selected) {
    const restored = expectedByIdentity.get(getTrackIdentity(item)) ?? expectedByFingerprint.get(trackFingerprint(item));
    if (!restored) continue;
    restoredIds.add(restored.id);
    added.push({
      ...item,
      id: restored.id,
      metadata: mergeMetadata(item.metadata, restored.metadata),
      rating: mergeRating(item.rating, restored.rating)
    });
  }
  libraryStore.add(added);

  const restoredFavoriteIds = new Set<string>();
  const selectedByIdentity = new Map(selected.map((item) => [getFavoriteIdentity(item), item]));
  const selectedByFingerprint = new Map(selected.map((item) => [trackFingerprint(item), item]));
  for (const favorite of pending.favorites.filter((track) => !track.sourceFolderId)) {
    const materializedItem = selectedByIdentity.get(getFavoriteIdentity(favorite)) ?? selectedByFingerprint.get(trackFingerprint(favorite));
    if (!materializedItem) continue;
    favoritesStore.add([{
      ...materializedItem,
      id: favorite.id,
      metadata: mergeMetadata(materializedItem.metadata, favorite.metadata),
      rating: mergeRating(materializedItem.rating, favorite.rating)
    }]);
    restoredFavoriteIds.add(favorite.id);
  }
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
}
