import { writable, type Readable } from 'svelte/store';
import { logError, logInfo, logWarning } from '$lib/services/logging';
import { filesystem } from '$platform';
import type { FileReference, FolderReference, NativeFolderReference, SelectedFolder } from './platform-files-types';

export type FilesystemFolderPermission = 'granted' | 'prompt' | 'denied' | 'unavailable';
export type LibraryFolderMode = 'manual' | 'launch';
export type LibraryFolderScanFailure =
  | 'not-library-folder'
  | 'permission-required'
  | 'cancelled'
  | 'scan-failed';
type LibraryFolderScanStatus =
  | 'never'
  | 'scanning'
  | 'success'
  | 'permission-required'
  | 'error';

export interface FilesystemFolder extends SelectedFolder {
  id: string;
  addedAt: number;
  permission: FilesystemFolderPermission;
  libraryMode: LibraryFolderMode | null;
  lastScanAt?: number;
  lastScanStatus: LibraryFolderScanStatus;
  lastScanTrackCount?: number;
  lastScanFailure?: LibraryFolderScanFailure;
}

interface FilesystemFileLocation {
  folderId: string;
  path: string;
}

type StoredFilesystemFolder = Omit<FilesystemFolder, 'permission'>;

const DATABASE_NAME = 'izci-filesystem';
const DATABASE_VERSION = 1;
const STORE_NAME = 'folders';
const STATE_KEY = 'state';
const CHANNEL_NAME = 'izci-filesystem-folders';
function normalizeStoredFolder(value: unknown): StoredFilesystemFolder | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<StoredFilesystemFolder>;
  const reference = filesystem.normalizeFolderReference(source);

  if (
    typeof source.id !== 'string' ||
    typeof source.name !== 'string' ||
    !reference
  ) {
    return null;
  }

  const lastScanStatus: LibraryFolderScanStatus =
    source.lastScanStatus === 'scanning' ||
    source.lastScanStatus === 'success' ||
    source.lastScanStatus === 'permission-required' ||
    source.lastScanStatus === 'error'
      ? source.lastScanStatus
      : 'never';

  return {
    id: source.id,
    ...reference,
    name: source.name,
    addedAt: typeof source.addedAt === 'number' ? source.addedAt : Date.now(),
    libraryMode: source.libraryMode === 'manual' || source.libraryMode === 'launch' ? source.libraryMode : null,
    lastScanAt: typeof source.lastScanAt === 'number' ? source.lastScanAt : undefined,
    lastScanStatus,
    lastScanTrackCount:
      typeof source.lastScanTrackCount === 'number' ? source.lastScanTrackCount : undefined,
    lastScanFailure:
      source.lastScanFailure === 'not-library-folder' ||
      source.lastScanFailure === 'permission-required' ||
      source.lastScanFailure === 'cancelled' ||
      source.lastScanFailure === 'scan-failed'
        ? source.lastScanFailure
        : undefined
  };
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return null;

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readStoredFolders(): Promise<StoredFilesystemFolder[]> {
  const database = await openDatabase();
  if (!database) return [];

  return await new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => {
      const values = Array.isArray(request.result) ? request.result : [];
      resolve(values.map(normalizeStoredFolder).filter((value): value is StoredFilesystemFolder => value !== null));
    };
    request.onerror = () => resolve([]);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  });
}

async function writeStoredFolders(folders: StoredFilesystemFolder[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(folders, STATE_KEY);
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

export function queryFilesystemFolderAccess(
  folder: FolderReference, probe = false, timeoutMs?: number
): Promise<FilesystemFolderPermission> {
  return filesystem.queryFolderPermission(folder, probe, timeoutMs);
}

export async function resolveFilesystemFileLocation(
  reference: FileReference,
  folders: FilesystemFolder[]
): Promise<FilesystemFileLocation | null> {
  const matches: FilesystemFileLocation[] = [];

  for (const folder of folders) {
    const relativePath = await filesystem.resolveFilePath(reference, folder);
    if (relativePath?.length) matches.push({ folderId: folder.id, path: [folder.name, ...relativePath].join('/') });
  }

  return matches.length === 1 ? matches[0] : null;
}

function stripRuntimeState(folder: FilesystemFolder): StoredFilesystemFolder {
  const { permission: _permission, ...stored } = folder;
  return stored;
}

function createFilesystemFoldersStore(): Readable<FilesystemFolder[]> & {
  ready(): Promise<void>;
  refresh(options?: { probe?: boolean }): Promise<FilesystemFolder[]>;
  remember(
    handle: SelectedFolder | FileSystemDirectoryHandle | NativeFolderReference,
    options?: { libraryMode?: LibraryFolderMode | null; preferredId?: string }
  ): Promise<FilesystemFolder>;
  rememberMany(handles: FileSystemDirectoryHandle[]): Promise<FilesystemFolder[]>;
  requestPermission(id: string): Promise<FilesystemFolderPermission>;
  forget(id: string): Promise<void>;
  setLibraryMode(id: string, mode: LibraryFolderMode | null): Promise<void>;
  updateScan(
    id: string,
    patch: Partial<Pick<FilesystemFolder, 'lastScanAt' | 'lastScanStatus' | 'lastScanTrackCount' | 'lastScanFailure'>>
  ): Promise<void>;
  getSnapshot(): FilesystemFolder[];
} {
  const store = writable<FilesystemFolder[]>([]);
  let snapshot: FilesystemFolder[] = [];
  let channel: BroadcastChannel | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  let resolveReady: (() => void) | null = null;
  const readyPromise =
    typeof window === 'undefined'
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          resolveReady = resolve;
        });

  store.subscribe((value) => (snapshot = value));

  async function load(probe = false): Promise<FilesystemFolder[]> {
    const stored = await readStoredFolders();
    store.set(
      stored.map((folder) => ({
        ...folder,
        permission: snapshot.find((candidate) => candidate.id === folder.id)?.permission ?? 'unavailable'
      }))
    );
    const folders = await Promise.all(
      stored.map(async (folder) => ({
        ...folder,
        permission: await queryFilesystemFolderAccess(folder, probe)
      }))
    );
    store.set(folders);
    return folders;
  }

  async function persist(next: FilesystemFolder[]): Promise<void> {
    store.set(next);
    await writeStoredFolders(next.map(stripRuntimeState));
    channel?.postMessage({ type: 'changed' });
  }

  async function mutate(
    updater: (current: FilesystemFolder[]) => Promise<FilesystemFolder[]> | FilesystemFolder[]
  ): Promise<FilesystemFolder[]> {
    await readyPromise;
    let result: FilesystemFolder[] = [];
    const operation = mutationQueue.then(async () => {
      const freshStored = await readStoredFolders();
      const current = await Promise.all(
        freshStored.map(async (folder) => {
          const existing = snapshot.find((candidate) => candidate.id === folder.id);
          return {
            ...folder,
            permission: existing?.permission ?? (await queryFilesystemFolderAccess(folder))
          };
        })
      );
      result = await updater(current);
      await persist(result);
    });
    mutationQueue = operation.catch(() => {});
    await operation;
    return result;
  }

  if (typeof window !== 'undefined') {
    if ('BroadcastChannel' in window) {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', () => void load(false));
    }
    void load(false).finally(() => {
      resolveReady?.();
      resolveReady = null;
    });
  }

  return {
    subscribe: store.subscribe,
    ready: () => readyPromise,
    refresh: (options = {}) => load(options.probe === true),
    getSnapshot: () => snapshot,
    async remember(handle, options = {}) {
      const source = filesystem.normalizeFolderReference(handle);
      if (!source) throw new Error('This platform cannot remember the selected folder.');
      let remembered: FilesystemFolder | null = null;
      await mutate(async (current) => {
        for (const folder of current) {
          if (await filesystem.sameFolder(folder, source)) {
            remembered = {
              ...folder,
              ...source,
              permission: await queryFilesystemFolderAccess(source),
              libraryMode: options.libraryMode === undefined ? folder.libraryMode : options.libraryMode
            };
            return current.map((candidate) => (candidate.id === folder.id ? remembered! : candidate));
          }
        }

        remembered = {
          id:
            options.preferredId && !current.some((folder) => folder.id === options.preferredId)
              ? options.preferredId
              : crypto.randomUUID(),
          ...source,
          addedAt: Date.now(),
          permission: await queryFilesystemFolderAccess(source),
          libraryMode: options.libraryMode ?? null,
          lastScanStatus: 'never'
        };
        return [...current, remembered];
      });
      logInfo('files', 'Managed folder remembered', { id: remembered!.id, name: remembered!.name, mode: remembered!.libraryMode });
      return remembered!;
    },
    async rememberMany(handles) {
      const remembered: FilesystemFolder[] = [];
      for (const handle of handles) remembered.push(await this.remember(handle));
      return remembered;
    },
    async requestPermission(id) {
      const target = snapshot.find((folder) => folder.id === id);
      if (!target) return 'unavailable';

      // Keep the permission API call directly on the button's user activation.
      // IndexedDB work before requestPermission() can consume Chromium's gesture window.
      const permission = await filesystem.requestFolderPermission(target);
      await mutate((current) =>
        current.map((folder) => (folder.id === id ? { ...folder, permission } : folder))
      );
      return permission;
    },
    async forget(id) {
      const target = snapshot.find((folder) => folder.id === id);
      await mutate((current) => current.filter((folder) => folder.id !== id));
      logInfo('files', 'Managed folder forgotten', { id, name: target?.name });
    },
    async setLibraryMode(id, mode) {
      await mutate((current) =>
        current.map((folder) => (folder.id === id ? { ...folder, libraryMode: mode } : folder))
      );
    },
    async updateScan(id, patch) {
      await mutate((current) =>
        current.map((folder) => (folder.id === id ? { ...folder, ...patch } : folder))
      );
      const folder = snapshot.find((candidate) => candidate.id === id);
      if (patch.lastScanStatus === 'scanning') logInfo('library', 'Managed-folder scan started', { id, name: folder?.name });
      else if (patch.lastScanStatus === 'success') logInfo('library', 'Managed-folder scan completed', { id, name: folder?.name, tracks: patch.lastScanTrackCount });
      else if (patch.lastScanStatus === 'permission-required') logWarning('library', 'Managed-folder scan requires permission', { id, name: folder?.name });
      else if (patch.lastScanStatus === 'error') logError('library', 'Managed-folder scan failed', { id, name: folder?.name, failure: patch.lastScanFailure });
    }
  };
}

export const filesystemFolders = createFilesystemFoldersStore();
