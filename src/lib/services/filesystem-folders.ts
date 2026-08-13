import { writable, type Readable } from 'svelte/store';
import { logError, logInfo, logWarning } from '$lib/logging/api';
import {
  openBrowserDatabase,
  registerBrowserPersistenceOwner
} from '$lib/persistence/browser-indexed-db';
import {
  PersistenceError,
  defineDatabase,
  defineStore,
  runTransaction
} from '$lib/persistence/indexed-db';

export type FilesystemFolderPermission = 'granted' | 'prompt' | 'denied' | 'unavailable';
export type LibraryFolderMode = 'manual' | 'launch';
export type LibraryFolderScanFailure =
  | 'not-library-folder'
  | 'permission-required'
  | 'cancelled'
  | 'scan-failed';
export type LibraryFolderScanStatus =
  | 'never'
  | 'scanning'
  | 'success'
  | 'permission-required'
  | 'error';

export interface FilesystemFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  addedAt: number;
  permission: FilesystemFolderPermission;
  libraryMode: LibraryFolderMode | null;
  lastScanAt?: number;
  lastScanStatus: LibraryFolderScanStatus;
  lastScanTrackCount?: number;
  lastScanFailure?: LibraryFolderScanFailure;
}

export interface FilesystemFileLocation {
  folderId: string;
  path: string;
}

export type StoredFilesystemFolder = Omit<FilesystemFolder, 'permission'>;

export type FilesystemFoldersPersistenceState =
  | { readonly status: 'loading' | 'ready' | 'disposed'; readonly error?: undefined }
  | { readonly status: 'error'; readonly error: PersistenceError };

export interface FilesystemFoldersPersistence {
  read(): Promise<StoredFilesystemFolder[]>;
  write(folders: StoredFilesystemFolder[]): Promise<void>;
}

export interface FilesystemFoldersChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export interface FilesystemFoldersStoreOptions {
  readonly persistence?: FilesystemFoldersPersistence;
  readonly initialize?: boolean;
  readonly createChannel?: () => FilesystemFoldersChannel | null;
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface FilesystemFoldersStore extends Readable<FilesystemFolder[]> {
  readonly persistenceState: Readable<FilesystemFoldersPersistenceState>;
  ready(): Promise<void>;
  refresh(options?: { probe?: boolean }): Promise<FilesystemFolder[]>;
  remember(
    handle: FileSystemDirectoryHandle,
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
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

const DATABASE_NAME = 'izci-filesystem';
const DATABASE_VERSION = 1;
const STORE_NAME = 'folders';
const STATE_KEY = 'state';
const CHANNEL_NAME = 'izci-filesystem-folders';
const FOLDER_ACCESS_TIMEOUT_MS = 3_000;

export const filesystemFoldersDatabase = defineDatabase({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: {
    [STORE_NAME]: defineStore<StoredFilesystemFolder[], string>()({})
  }
});

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeoutId = setTimeout(() => resolve(undefined), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<FileSystemDirectoryHandle>;
  return source.kind === 'directory' && typeof source.values === 'function';
}

function normalizeStoredFolder(value: unknown): StoredFilesystemFolder | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<StoredFilesystemFolder>;

  if (
    typeof source.id !== 'string' ||
    typeof source.name !== 'string' ||
    !isDirectoryHandle(source.handle)
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
    name: source.name,
    handle: source.handle,
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

export async function readStoredFilesystemFolders(): Promise<StoredFilesystemFolder[]> {
  const connection = await openBrowserDatabase(filesystemFoldersDatabase);
  try {
    const stored = await runTransaction(connection, {
      stores: [STORE_NAME],
      mode: 'readonly',
      operation: 'read remembered filesystem folders'
    }, (transaction) => transaction.store(STORE_NAME).get(STATE_KEY));
    const values = Array.isArray(stored) ? stored : [];
    return values
      .map(normalizeStoredFolder)
      .filter((value): value is StoredFilesystemFolder => value !== null);
  } finally {
    await connection.close();
  }
}

export async function writeStoredFilesystemFolders(folders: StoredFilesystemFolder[]): Promise<void> {
  const connection = await openBrowserDatabase(filesystemFoldersDatabase);
  try {
    await runTransaction(connection, {
      stores: [STORE_NAME],
      mode: 'readwrite',
      operation: 'persist remembered filesystem folders',
      durability: 'strict'
    }, async (transaction) => {
      await transaction.store(STORE_NAME).put(folders, STATE_KEY);
    });
  } finally {
    await connection.close();
  }
}

export async function queryFilesystemFolderPermission(
  handle: FileSystemDirectoryHandle,
  probe = true,
  timeoutMs = FOLDER_ACCESS_TIMEOUT_MS
): Promise<FilesystemFolderPermission> {
  let permission: FileSystemPermissionState = 'granted';

  try {
    if (typeof handle.queryPermission === 'function') {
      const queriedPermission = await settleWithin(handle.queryPermission({ mode: 'read' }), timeoutMs);
      if (!queriedPermission) return 'unavailable';
      permission = queriedPermission;
    }
  } catch {
    return 'unavailable';
  }

  if (permission !== 'granted' || !probe) return permission;

  try {
    const probeResult = await settleWithin(handle.values().next(), timeoutMs);
    if (!probeResult) return 'unavailable';
    return 'granted';
  } catch {
    return 'unavailable';
  }
}

async function requestFilesystemFolderPermission(
  handle: FileSystemDirectoryHandle
): Promise<FilesystemFolderPermission> {
  try {
    if (typeof handle.requestPermission === 'function') {
      const permission = await handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') return permission;
    }
    return await queryFilesystemFolderPermission(handle);
  } catch {
    return 'denied';
  }
}

async function sameDirectory(
  first: FileSystemDirectoryHandle,
  second: FileSystemDirectoryHandle
): Promise<boolean> {
  if (first === second) return true;
  try {
    return typeof first.isSameEntry === 'function' ? await first.isSameEntry(second) : false;
  } catch {
    return false;
  }
}

export async function resolveFilesystemFileLocation(
  handle: FileSystemFileHandle,
  folders: FilesystemFolder[]
): Promise<FilesystemFileLocation | null> {
  const matches: FilesystemFileLocation[] = [];

  for (const folder of folders) {
    if (typeof folder.handle.resolve !== 'function') continue;

    try {
      const relativePath = await folder.handle.resolve(handle);

      if (relativePath && relativePath.length > 0) {
        matches.push({
          folderId: folder.id,
          path: [folder.name, ...relativePath].join('/')
        });
      }
    } catch {
      // A stale or unavailable remembered root cannot identify this file.
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

function stripRuntimeState(folder: FilesystemFolder): StoredFilesystemFolder {
  const { permission: _permission, ...stored } = folder;
  return stored;
}

function filesystemFoldersPersistenceError(cause: unknown, operation: string): PersistenceError {
  return cause instanceof PersistenceError
    ? cause
    : new PersistenceError({
        category: 'io',
        code: 'persistence.io-failed',
        operation,
        retryable: true,
        cause
      });
}

function defaultFilesystemFoldersChannel(): FilesystemFoldersChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
  try {
    return new window.BroadcastChannel(CHANNEL_NAME);
  } catch (cause) {
    logWarning('files', 'Managed-folder synchronization is unavailable', cause);
    return null;
  }
}

const browserFilesystemFoldersPersistence: FilesystemFoldersPersistence = {
  read: readStoredFilesystemFolders,
  write: writeStoredFilesystemFolders
};

export function createFilesystemFoldersStore(
  options: FilesystemFoldersStoreOptions = {}
): FilesystemFoldersStore {
  const store = writable<FilesystemFolder[]>([]);
  const persistenceStore = writable<FilesystemFoldersPersistenceState>(
    (options.initialize ?? typeof window !== 'undefined') ? { status: 'loading' } : { status: 'ready' }
  );
  const persistence = options.persistence ?? browserFilesystemFoldersPersistence;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  let snapshot: FilesystemFolder[] = [];
  let channel: FilesystemFoldersChannel | null = null;
  let channelListener: ((event: MessageEvent<unknown>) => void) | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  let pendingMutation: Promise<unknown> = Promise.resolve();
  let pendingLoad: Promise<unknown> = Promise.resolve();
  let readyPromise: Promise<void> = Promise.resolve();
  let disposeStarted = false;
  let disposePromise: Promise<void> | undefined;

  const stopSnapshot = store.subscribe((value) => (snapshot = value));

  function assertActive(operation: string): void {
    if (!disposeStarted) return;
    throw new PersistenceError({
      category: 'closed',
      code: 'persistence.connection-closed',
      operation,
      retryable: false,
      message: 'The managed-folder service has been disposed'
    });
  }

  function reportPersistenceFailure(cause: unknown, operation: string): PersistenceError {
    const error = filesystemFoldersPersistenceError(cause, operation);
    persistenceStore.set({ status: 'error', error });
    logError('files', 'Managed-folder persistence failed', {
      operation,
      category: error.category,
      code: error.code,
      cause: error.safeCause
    });
    return error;
  }

  async function readPersisted(operation: string): Promise<StoredFilesystemFolder[]> {
    try {
      return await persistence.read();
    } catch (cause) {
      throw reportPersistenceFailure(cause, operation);
    }
  }

  async function load(probe = false): Promise<FilesystemFolder[]> {
    assertActive('load remembered filesystem folders');
    const stored = await readPersisted('load remembered filesystem folders');
    store.set(
      stored.map((folder) => ({
        ...folder,
        permission: snapshot.find((candidate) => candidate.id === folder.id)?.permission ?? 'unavailable'
      }))
    );
    const folders = await Promise.all(
      stored.map(async (folder) => ({
        ...folder,
        permission: await queryFilesystemFolderPermission(folder.handle, probe)
      }))
    );
    store.set(folders);
    persistenceStore.set({ status: 'ready' });
    return folders;
  }

  async function persist(next: FilesystemFolder[]): Promise<void> {
    try {
      await persistence.write(next.map(stripRuntimeState));
    } catch (cause) {
      throw reportPersistenceFailure(cause, 'persist remembered filesystem folders');
    }
    store.set(next);
    persistenceStore.set({ status: 'ready' });
    try {
      channel?.postMessage({ type: 'changed' });
    } catch (cause) {
      logWarning('files', 'Managed-folder synchronization notification failed', cause);
    }
  }

  async function mutate(
    updater: (current: FilesystemFolder[]) => Promise<FilesystemFolder[]> | FilesystemFolder[]
  ): Promise<FilesystemFolder[]> {
    assertActive('mutate remembered filesystem folders');
    await readyPromise;
    let result: FilesystemFolder[] = [];
    const operation = mutationQueue.then(async () => {
      const freshStored = await readPersisted('refresh remembered filesystem folders before mutation');
      const current = await Promise.all(
        freshStored.map(async (folder) => {
          const existing = snapshot.find((candidate) => candidate.id === folder.id);
          return {
            ...folder,
            permission: existing?.permission ?? (await queryFilesystemFolderPermission(folder.handle, false))
          };
        })
      );
      result = await updater(current);
      await persist(result);
    });
    pendingMutation = operation;
    mutationQueue = operation.then(() => undefined, () => undefined);
    await operation;
    return result;
  }

  const initialize = options.initialize ?? typeof window !== 'undefined';
  if (initialize) {
    try {
      channel = (options.createChannel ?? defaultFilesystemFoldersChannel)();
      if (channel) {
        channelListener = () => {
          if (disposeStarted) return;
          const loading = load(false);
          pendingLoad = loading;
          void loading.catch(() => undefined);
        };
        channel.addEventListener('message', channelListener);
      }
    } catch (cause) {
      channel = null;
      channelListener = null;
      logWarning('files', 'Managed-folder synchronization is unavailable', cause);
    }
    const loading = load(false);
    pendingLoad = loading;
    readyPromise = loading.then(() => undefined);
    void readyPromise.catch(() => undefined);
  }

  const api: FilesystemFoldersStore = {
    subscribe: store.subscribe,
    persistenceState: { subscribe: persistenceStore.subscribe },
    ready: () => readyPromise,
    refresh: (refreshOptions = {}) => {
      const loading = load(refreshOptions.probe === true);
      pendingLoad = loading;
      readyPromise = loading.then(() => undefined);
      void readyPromise.catch(() => undefined);
      return loading;
    },
    getSnapshot: () => snapshot,
    async remember(handle, options = {}) {
      let remembered: FilesystemFolder | null = null;
      await mutate(async (current) => {
        for (const folder of current) {
          if (await sameDirectory(folder.handle, handle)) {
            remembered = {
              ...folder,
              name: handle.name,
              handle,
              permission: await queryFilesystemFolderPermission(handle, false),
              libraryMode: options.libraryMode === undefined ? folder.libraryMode : options.libraryMode
            };
            return current.map((candidate) => (candidate.id === folder.id ? remembered! : candidate));
          }
        }

        remembered = {
          id:
            options.preferredId && !current.some((folder) => folder.id === options.preferredId)
              ? options.preferredId
              : createId(),
          name: handle.name,
          handle,
          addedAt: now(),
          permission: await queryFilesystemFolderPermission(handle, false),
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
      for (const handle of handles) remembered.push(await api.remember(handle));
      return remembered;
    },
    async requestPermission(id) {
      const target = snapshot.find((folder) => folder.id === id);
      if (!target) return 'unavailable';

      // Keep the permission API call directly on the button's user activation.
      // IndexedDB work before requestPermission() can consume Chromium's gesture window.
      const permission = await requestFilesystemFolderPermission(target.handle);
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
    },
    async flush() {
      await readyPromise;
      await pendingLoad;
      await pendingMutation;
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposeStarted = true;
      disposePromise = (async () => {
        let pendingFailure: unknown;
        try {
          await readyPromise;
          await pendingLoad;
          await pendingMutation;
        } catch (cause) {
          pendingFailure = cause;
        }
        if (channel && channelListener) {
          try {
            channel.removeEventListener('message', channelListener);
          } catch (cause) {
            logWarning('files', 'Managed-folder synchronization listener cleanup failed', cause);
          }
        }
        try {
          channel?.close();
        } catch (cause) {
          logWarning('files', 'Managed-folder synchronization close failed', cause);
        }
        channel = null;
        channelListener = null;
        stopSnapshot();
        persistenceStore.set({ status: 'disposed' });
        if (pendingFailure !== undefined) throw pendingFailure;
      })();
      return disposePromise;
    }
  };
  return api;
}

export async function getDroppedDirectoryHandles(
  dataTransfer: DataTransfer
): Promise<FileSystemDirectoryHandle[]> {
  const handles: FileSystemDirectoryHandle[] = [];

  for (const item of Array.from(dataTransfer.items)) {
    try {
      const handle = await item.getAsFileSystemHandle?.();
      if (handle?.kind === 'directory') handles.push(handle as FileSystemDirectoryHandle);
    } catch {
      // Legacy directory drops still import their files, but cannot be remembered as FSA roots.
    }
  }

  return handles;
}

export const filesystemFolders = createFilesystemFoldersStore();

const unregisterFilesystemFoldersPersistence = registerBrowserPersistenceOwner({
  label: 'remembered filesystem folders',
  flush: () => filesystemFolders.flush(),
  dispose: async () => {
    unregisterFilesystemFoldersPersistence();
    await filesystemFolders.dispose();
  }
});
