import { derived, writable } from 'svelte/store';
import { metadataSettings } from '$lib/stores/metadata-settings';
import type {
  PlaylistItem,
  PlaylistPlaybackOptions,
  PlaylistRepeatMode,
  PlaylistSelection,
  TrackMetadata
} from '$lib/types';
import { getTrackIdentity, inferExtension, inferKind, mergeInferredArtistTitle } from '$lib/utils/files';

interface SelectOptions {
  range?: boolean;
  toggle?: boolean;
}

interface StoredPlaylistItem {
  id: string;
  name: string;
  extension: string;
  kind: PlaylistItem['kind'];
  size: number;
  lastModified: number;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  metadata?: PlaylistItem['metadata'];
}

interface StoredPlaylistState {
  items?: StoredPlaylistItem[];
  selection: PlaylistSelection;
  playbackOptions?: PlaylistPlaybackOptions;
}

interface BackgroundDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface TrackCollectionStoreConfig {
  dbName: string;
  dedupe: boolean;
}

interface ShuffleSessionState {
  history: string[];
  cursor: number;
  upcoming: string[];
}

const emptySelection: PlaylistSelection = {
  ids: [],
  anchorId: null,
  focusId: null
};

const defaultPlaybackOptions: PlaylistPlaybackOptions = {
  shuffle: false,
  repeatMode: 'off'
};

const PLAYLIST_DB_VERSION = 1;
const PLAYLIST_STORE_NAME = 'playlist';
const PLAYLIST_STATE_KEY = 'state';

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

function isFileSystemFileHandle(value: unknown): value is FileSystemFileHandle {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const source = value as Partial<FileSystemFileHandle>;
  return source.kind === 'file' && typeof source.getFile === 'function';
}

function createObjectUrl(item: Pick<PlaylistItem, 'kind'>, file: File): string | undefined {
  return item.kind === 'stream' ? URL.createObjectURL(file) : undefined;
}

function revokeObjectUrl(item: Pick<PlaylistItem, 'objectUrl'>): void {
  if (item.objectUrl) {
    URL.revokeObjectURL(item.objectUrl);
  }
}

function normalizeStoredItem(value: unknown): StoredPlaylistItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<StoredPlaylistItem> & { file?: unknown };

  if (
    typeof source.id !== 'string' ||
    typeof source.name !== 'string' ||
    typeof source.extension !== 'string' ||
    (source.kind !== 'stream' && source.kind !== 'module') ||
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
    metadata: source.metadata
  };
}

function serializeItem(item: PlaylistItem): StoredPlaylistItem | null {
  if (!item.fileHandle) {
    return null;
  }

  return {
    id: item.id,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: item.size,
    lastModified: item.lastModified,
    fileHandle: item.fileHandle,
    path: item.path,
    metadata: item.metadata
  };
}

async function queryHandlePermission(handle: FileSystemFileHandle): Promise<FileSystemPermissionState> {
  if (typeof handle.queryPermission !== 'function') {
    return 'granted';
  }

  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'prompt';
  }
}

async function requestHandlePermission(handle: FileSystemFileHandle): Promise<FileSystemPermissionState> {
  if (typeof handle.requestPermission !== 'function') {
    return 'granted';
  }

  try {
    return await handle.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

async function materializePlaylistItem(item: PlaylistItem, prompt = false): Promise<PlaylistItem | null> {
  if (item.file && (item.kind !== 'stream' || item.objectUrl)) {
    return item;
  }

  if (!item.fileHandle) {
    return null;
  }

  const permission = await queryHandlePermission(item.fileHandle);

  if (permission !== 'granted' && (!prompt || (await requestHandlePermission(item.fileHandle)) !== 'granted')) {
    return null;
  }

  const file = await item.fileHandle.getFile();
  const extension = inferExtension(file.name);
  const kind = inferKind(extension);

  if (!kind) {
    return null;
  }

  return {
    ...item,
    file,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: createObjectUrl({ kind }, file)
  };
}

function scheduleBackgroundTask(callback: (deadline: BackgroundDeadline) => void): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 100 });
    return;
  }

  setTimeout(() => {
    callback({
      didTimeout: true,
      timeRemaining: () => 0
    });
  }, 0);
}

function normalizeStoredSelection(value: unknown, itemIds: Set<string>): PlaylistSelection {
  const source = value && typeof value === 'object' ? (value as Partial<PlaylistSelection>) : {};
  const ids = Array.isArray(source.ids) ? source.ids.filter((id): id is string => typeof id === 'string' && itemIds.has(id)) : [];
  const focusId = typeof source.focusId === 'string' && itemIds.has(source.focusId) ? source.focusId : ids.at(-1) ?? null;
  const anchorId =
    typeof source.anchorId === 'string' && itemIds.has(source.anchorId) ? source.anchorId : focusId;

  if (ids.length === 0) {
    return emptySelection;
  }

  return {
    ids,
    anchorId,
    focusId
  };
}

function buildInitialMetadata(item: PlaylistItem): TrackMetadata | undefined {
  const metadata = mergeInferredArtistTitle(item.metadata, item.name, metadataSettings.getSnapshot().inferFromFilename);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

async function readStreamDuration(item: PlaylistItem): Promise<number | undefined> {
  if (typeof window === 'undefined' || item.kind !== 'stream' || !item.objectUrl) {
    return undefined;
  }

  const objectUrl = item.objectUrl;

  return await new Promise((resolve) => {
    const audio = new Audio();

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };

    const handleError = () => {
      cleanup();
      resolve(undefined);
    };

    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    audio.src = objectUrl;
  });
}

function normalizePlaybackOptions(value: unknown): PlaylistPlaybackOptions {
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

async function readStoredState(dbName: string): Promise<StoredPlaylistState | null> {
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

async function persistStoredState(dbName: string, state: StoredPlaylistState): Promise<void> {
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

function createTrackCollectionStore(config: TrackCollectionStoreConfig) {
  const items = writable<PlaylistItem[]>([]);
  const selection = writable<PlaylistSelection>(emptySelection);
  const playbackOptions = writable<PlaylistPlaybackOptions>(defaultPlaybackOptions);

  let itemList: PlaylistItem[] = [];
  let selectionState: PlaylistSelection = emptySelection;
  let playbackOptionsState: PlaylistPlaybackOptions = defaultPlaybackOptions;
  let hydrated = typeof window === 'undefined';
  let persistQueued = false;
  let shouldCompactStoredState = false;
  const pendingOperations: Array<() => void> = [];
  let shuffleSession: ShuffleSessionState = {
    history: [],
    cursor: -1,
    upcoming: []
  };

  items.subscribe((value) => {
    itemList = value;
  });

  selection.subscribe((value) => {
    selectionState = value;
  });

  playbackOptions.subscribe((value) => {
    playbackOptionsState = value;
  });

  const selectedIds = derived(selection, ($selection) => $selection.ids);
  const shuffleEnabled = derived(playbackOptions, ($playbackOptions) => $playbackOptions.shuffle);
  const repeatMode = derived(playbackOptions, ($playbackOptions) => $playbackOptions.repeatMode);

  const selectedTrack = derived([items, selection], ([$items, $selection]) => {
    const primaryId = $selection.focusId ?? $selection.ids.at(-1);

    if (!primaryId) {
      return null;
    }

    return $items.find((item) => item.id === primaryId) ?? null;
  });

  function orderIds(ids: Iterable<string>): string[] {
    const selected = new Set(ids);
    return itemList.filter((item) => selected.has(item.id)).map((item) => item.id);
  }

  function normalizeSelection(nextSelection: PlaylistSelection): PlaylistSelection {
    const ids = orderIds(nextSelection.ids);
    const focusId = ids.includes(nextSelection.focusId ?? '') ? nextSelection.focusId : ids.at(-1) ?? null;
    const anchorId =
      ids.includes(nextSelection.anchorId ?? '') || itemList.some((item) => item.id === nextSelection.anchorId)
        ? nextSelection.anchorId
        : focusId;

    if (ids.length === 0) {
      return emptySelection;
    }

    return {
      ids,
      anchorId,
      focusId
    };
  }

  function rangeIds(fromId: string, toId: string): string[] {
    const fromIndex = itemList.findIndex((item) => item.id === fromId);
    const toIndex = itemList.findIndex((item) => item.id === toId);

    if (fromIndex === -1 || toIndex === -1) {
      return [toId];
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    return itemList.slice(start, end + 1).map((item) => item.id);
  }

  function queuePersist(): void {
    if (!hydrated || persistQueued) {
      return;
    }

    persistQueued = true;

    queueMicrotask(() => {
      persistQueued = false;

      void persistStoredState(config.dbName, {
        items: itemList.map(serializeItem).filter((item): item is StoredPlaylistItem => item !== null),
        selection: selectionState,
        playbackOptions: playbackOptionsState
      });
    });
  }

  function resetShuffleSession(): void {
    shuffleSession = {
      history: [],
      cursor: -1,
      upcoming: []
    };
  }

  function shuffleIds(ids: string[]): string[] {
    const shuffled = [...ids];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
  }

  function getTrackById(id: string | null): PlaylistItem | null {
    if (!id) {
      return null;
    }

    return itemList.find((item) => item.id === id) ?? null;
  }

  function buildShuffleCycle(currentId: string | null): string[] {
    if (itemList.length === 0) {
      return [];
    }

    if (itemList.length === 1) {
      return currentId ? [currentId] : [itemList[0].id];
    }

    return shuffleIds(itemList.map((item) => item.id).filter((id) => id !== currentId));
  }

  function initializeShuffleSession(currentId: string | null): void {
    const initialTrack = getTrackById(currentId) ?? itemList[0] ?? null;

    if (!initialTrack) {
      resetShuffleSession();
      return;
    }

    shuffleSession = {
      history: [initialTrack.id],
      cursor: 0,
      upcoming: shuffleIds(itemList.map((item) => item.id).filter((id) => id !== initialTrack.id))
    };
  }

  function syncShuffleSession(currentId: string | null): void {
    if (itemList.length === 0) {
      resetShuffleSession();
      return;
    }

    if (!currentId || !getTrackById(currentId)) {
      if (shuffleSession.cursor === -1 || !getTrackById(shuffleSession.history[shuffleSession.cursor] ?? null)) {
        initializeShuffleSession(itemList[0]?.id ?? null);
      }

      return;
    }

    if (shuffleSession.history[shuffleSession.cursor] === currentId) {
      return;
    }

    const existingIndex = shuffleSession.history.lastIndexOf(currentId);

    if (existingIndex !== -1) {
      shuffleSession.cursor = existingIndex;
      return;
    }

    initializeShuffleSession(currentId);
  }

  function splitUniqueItems(sourceItems: PlaylistItem[], existingItems: PlaylistItem[] = []): {
    uniqueItems: PlaylistItem[];
    duplicateItems: PlaylistItem[];
  } {
    if (!config.dedupe) {
      return {
        uniqueItems: [...sourceItems],
        duplicateItems: []
      };
    }

    const seen = new Set(existingItems.map((item) => getTrackIdentity(item)));
    const uniqueItems: PlaylistItem[] = [];
    const duplicateItems: PlaylistItem[] = [];

    for (const item of sourceItems) {
      const key = getTrackIdentity(item);

      if (seen.has(key)) {
        duplicateItems.push(item);
        continue;
      }

      seen.add(key);
      uniqueItems.push(item);
    }

    return {
      uniqueItems,
      duplicateItems
    };
  }

  function applyStoredState(state: StoredPlaylistState | null): void {
    const storedItems = Array.isArray(state?.items) ? state.items : [];
    const normalizedItems = storedItems
      .map(normalizeStoredItem)
      .filter((item): item is StoredPlaylistItem => item !== null)
      .filter((item) => item.fileHandle)
      .map(
        (item): PlaylistItem => ({
          id: item.id,
          fileHandle: item.fileHandle,
          path: item.path,
          name: item.name,
          extension: item.extension,
          kind: item.kind,
          size: item.size,
          lastModified: item.lastModified,
          metadata: item.metadata
        })
      );

    const { uniqueItems } = splitUniqueItems(normalizedItems);
    const restoredItemIds = new Set(uniqueItems.map((item) => item.id));
    const restoredSelection = normalizeStoredSelection(state?.selection, restoredItemIds);

    shouldCompactStoredState =
      storedItems.length > 0 &&
      (uniqueItems.length !== storedItems.length ||
        storedItems.some((item) => Boolean(item && typeof item === 'object' && 'file' in (item as object))));

    items.set(uniqueItems);
    selection.set(restoredSelection);
    playbackOptions.set(normalizePlaybackOptions(state?.playbackOptions));
    resetShuffleSession();
  }

  function scheduleMetadataParsing(targetItems: PlaylistItem[]): void {
    if (targetItems.length === 0) {
      return;
    }

    let index = 0;
    let active = false;

    const processChunk = (deadline: BackgroundDeadline) => {
      if (active) {
        return;
      }

      const updates: Array<{ id: string; metadata: TrackMetadata }> = [];
      let pendingDurationItem: PlaylistItem | null = null;

      while (index < targetItems.length && (deadline.didTimeout || deadline.timeRemaining() > 2)) {
        const item = targetItems[index];
        index += 1;

        const currentItem = itemList.find((entry) => entry.id === item.id);

        if (!currentItem) {
          continue;
        }

        const metadata = buildInitialMetadata(item);
        const mergedMetadata = metadata ? { ...currentItem.metadata, ...metadata } : currentItem.metadata;

        if (metadata && JSON.stringify(currentItem.metadata ?? {}) !== JSON.stringify(mergedMetadata ?? {})) {
          updates.push({ id: item.id, metadata: mergedMetadata ?? {} });
        }

        if (item.kind === 'stream' && item.objectUrl && (currentItem.metadata?.duration ?? 0) <= 0) {
          pendingDurationItem = item;
          break;
        }
      }

      if (updates.length > 0) {
        items.update((existing) =>
          existing.map((item) => {
            const update = updates.find((entry) => entry.id === item.id);

            if (!update) {
              return item;
            }

            return {
              ...item,
              metadata: update.metadata
            };
          })
        );
        queuePersist();
      }

      if (pendingDurationItem) {
        active = true;

        void readStreamDuration(pendingDurationItem)
          .then((duration) => {
            if (!duration || duration <= 0) {
              return;
            }

            const currentItem = itemList.find((entry) => entry.id === pendingDurationItem?.id);

            if (!currentItem) {
              return;
            }

            const metadata = {
              ...currentItem.metadata,
              duration
            };

            items.update((existing) =>
              existing.map((item) =>
                item.id === pendingDurationItem?.id
                  ? {
                      ...item,
                      metadata
                    }
                  : item
              )
            );
            queuePersist();
          })
          .finally(() => {
            active = false;

            if (index < targetItems.length) {
              scheduleBackgroundTask(processChunk);
            }
          });

        return;
      }

      if (index < targetItems.length) {
        scheduleBackgroundTask(processChunk);
      }
    };

    scheduleBackgroundTask(processChunk);
  }

  function resolveLinearTrack(baseId: string | null, direction: -1 | 1, wrap: boolean): PlaylistItem | null {
    if (itemList.length === 0) {
      return null;
    }

    const currentIndex = baseId ? itemList.findIndex((item) => item.id === baseId) : -1;

    if (currentIndex === -1) {
      return direction > 0 ? itemList[0] : itemList[itemList.length - 1];
    }

    const nextIndex = currentIndex + direction;

    if (nextIndex >= 0 && nextIndex < itemList.length) {
      return itemList[nextIndex];
    }

    if (!wrap) {
      return null;
    }

    return direction > 0 ? itemList[0] : itemList[itemList.length - 1];
  }

  function resolveShuffledTrack(baseId: string | null, direction: -1 | 1, wrap: boolean): PlaylistItem | null {
    if (itemList.length === 0) {
      return null;
    }

    syncShuffleSession(baseId);

    if (shuffleSession.cursor === -1) {
      return null;
    }

    if (direction < 0) {
      if (shuffleSession.cursor > 0) {
        return getTrackById(shuffleSession.history[shuffleSession.cursor - 1] ?? null);
      }

      if (!wrap) {
        return null;
      }

      const previousCycle = buildShuffleCycle(baseId);

      if (previousCycle.length === 0) {
        return getTrackById(baseId);
      }

      shuffleSession = {
        history: [...previousCycle, ...shuffleSession.history],
        cursor: previousCycle.length,
        upcoming: shuffleSession.upcoming
      };

      return getTrackById(shuffleSession.history[shuffleSession.cursor - 1] ?? null);
    }

    if (shuffleSession.cursor < shuffleSession.history.length - 1) {
      return getTrackById(shuffleSession.history[shuffleSession.cursor + 1] ?? null);
    }

    if (shuffleSession.upcoming.length > 0) {
      const [nextId, ...remaining] = shuffleSession.upcoming;

      shuffleSession = {
        history: [...shuffleSession.history, nextId],
        cursor: shuffleSession.history.length,
        upcoming: remaining
      };

      return getTrackById(nextId);
    }

    if (!wrap) {
      return null;
    }

    const nextCycle = buildShuffleCycle(baseId);

    if (nextCycle.length === 0) {
      return getTrackById(baseId);
    }

    const [nextId, ...remaining] = nextCycle;

    shuffleSession = {
      history: [...shuffleSession.history, nextId],
      cursor: shuffleSession.history.length,
      upcoming: remaining
    };

    return getTrackById(nextId);
  }

  function flushPendingOperations(): void {
    if (pendingOperations.length === 0) {
      return;
    }

    const operations = pendingOperations.splice(0, pendingOperations.length);

    for (const operation of operations) {
      operation();
    }
  }

  function runOrQueue(operation: () => void): boolean {
    if (!hydrated) {
      pendingOperations.push(operation);
      return false;
    }

    operation();
    return true;
  }

  if (typeof window !== 'undefined') {
    void readStoredState(config.dbName)
      .then((state) => {
        applyStoredState(state);
        scheduleMetadataParsing(itemList);
      })
      .finally(() => {
        hydrated = true;
        flushPendingOperations();

        if (shouldCompactStoredState) {
          queuePersist();
        }
      });
  }

  return {
    items,
    selection,
    selectedIds,
    selectedTrack,
    shuffleEnabled,
    repeatMode,
    async ensureLoaded(id: string, options: { prompt?: boolean } = {}) {
      const item = itemList.find((entry) => entry.id === id);

      if (!item) {
        return null;
      }

      const materializedItem = await materializePlaylistItem(item, options.prompt === true);

      if (!materializedItem) {
        return null;
      }

      if (materializedItem === item) {
        return item;
      }

      items.update((existing) =>
        existing.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          if (entry.objectUrl && entry.objectUrl !== materializedItem.objectUrl) {
            revokeObjectUrl(entry);
          }

          return materializedItem;
        })
      );
      queuePersist();

      return materializedItem;
    },
    add(newItems: PlaylistItem[]) {
      let addedItems: PlaylistItem[] = [];

      const executed = runOrQueue(() => {
        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, itemList);

        for (const item of duplicateItems) {
          revokeObjectUrl(item);
        }

        addedItems = uniqueItems;

        if (uniqueItems.length === 0) {
          return;
        }

        items.update((existing) => [...existing, ...uniqueItems]);
        selection.update((value) => normalizeSelection(value));
        resetShuffleSession();
        scheduleMetadataParsing(uniqueItems);
        queuePersist();
      });

      return executed ? addedItems : [];
    },
    replaceAll(newItems: PlaylistItem[]) {
      let removedItems: PlaylistItem[] = [];
      let addedItems: PlaylistItem[] = [];

      const executed = runOrQueue(() => {
        removedItems = [...itemList];

        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems);

        for (const item of duplicateItems) {
          revokeObjectUrl(item);
        }

        addedItems = uniqueItems;
        items.set(uniqueItems);
        selection.set(emptySelection);
        resetShuffleSession();
        scheduleMetadataParsing(uniqueItems);
        queuePersist();
      });

      return executed
        ? {
            removedItems,
            addedItems
          }
        : {
            removedItems: [],
            addedItems: []
          };
    },
    select(id: string, options: SelectOptions = {}) {
      const { range = false, toggle = false } = options;

      runOrQueue(() => {
        selection.update((value) => {
          if (!itemList.some((item) => item.id === id)) {
            return normalizeSelection(value);
          }

          if (range) {
            const anchorId = value.anchorId ?? value.focusId ?? id;
            const ids = toggle ? orderIds(new Set([...value.ids, ...rangeIds(anchorId, id)])) : rangeIds(anchorId, id);

            return normalizeSelection({
              ids,
              anchorId,
              focusId: id
            });
          }

          if (toggle) {
            const ids = value.ids.includes(id) ? value.ids.filter((selectedId) => selectedId !== id) : orderIds([...value.ids, id]);

            return normalizeSelection({
              ids,
              anchorId: ids.length > 0 ? id : null,
              focusId: ids.includes(id) ? id : ids.at(-1) ?? null
            });
          }

          return normalizeSelection({
            ids: [id],
            anchorId: id,
            focusId: id
          });
        });
        queuePersist();
      });
    },
    selectAll() {
      runOrQueue(() => {
        if (itemList.length === 0) {
          selection.set(emptySelection);
          queuePersist();
          return;
        }

        const ids = itemList.map((item) => item.id);

        selection.set({
          ids,
          anchorId: ids[0] ?? null,
          focusId: ids.at(-1) ?? null
        });
        queuePersist();
      });
    },
    setSelection(nextSelection: PlaylistSelection) {
      runOrQueue(() => {
        selection.set(normalizeSelection(nextSelection));
        queuePersist();
      });
    },
    remove(ids: string[]) {
      if (ids.length === 0 || !hydrated) {
        return [];
      }

      const idsToRemove = new Set(ids);
      const removedItems = itemList.filter((item) => idsToRemove.has(item.id));

      items.update((existing) => existing.filter((item) => !idsToRemove.has(item.id)));
      selection.update((value) =>
        normalizeSelection({
          ids: value.ids.filter((id) => !idsToRemove.has(id)),
          anchorId: idsToRemove.has(value.anchorId ?? '') ? null : value.anchorId,
          focusId: idsToRemove.has(value.focusId ?? '') ? null : value.focusId
        })
      );
      resetShuffleSession();
      queuePersist();

      return removedItems;
    },
    updateMetadata(id: string, metadata: PlaylistItem['metadata']) {
      runOrQueue(() => {
        items.update((existing) =>
          existing.map((item) =>
            item.id === id
              ? {
                  ...item,
                  metadata: { ...item.metadata, ...metadata }
                }
              : item
          )
        );
        queuePersist();
      });
    },
    toggleShuffle() {
      runOrQueue(() => {
        playbackOptions.update((value) => ({
          ...value,
          shuffle: !value.shuffle
        }));
        resetShuffleSession();
        queuePersist();
      });
    },
    cycleRepeatMode() {
      runOrQueue(() => {
        playbackOptions.update((value) => ({
          ...value,
          repeatMode: value.repeatMode === 'off' ? 'one' : value.repeatMode === 'one' ? 'all' : 'off'
        }));
        queuePersist();
      });
    },
    resolveStepTrack(options: {
      currentId?: string | null;
      selectedId?: string | null;
      direction: -1 | 1;
      shuffle?: boolean;
      wrap?: boolean;
    }) {
      const { currentId = null, selectedId = null, direction, shuffle = false, wrap = false } = options;
      const baseId = currentId ?? selectedId;

      if (shuffle) {
        if (!baseId) {
          const initialTrack = direction > 0 ? itemList[0] ?? null : itemList[itemList.length - 1] ?? null;

          if (!initialTrack) {
            return null;
          }

          initializeShuffleSession(initialTrack.id);
          return initialTrack;
        }

        return resolveShuffledTrack(baseId, direction, wrap);
      }

      return resolveLinearTrack(baseId, direction, wrap);
    },
    resolveTrackEnd(options: {
      currentId?: string | null;
      shuffle?: boolean;
      repeatMode?: PlaylistRepeatMode;
    }) {
      const { currentId = null, shuffle = false, repeatMode = 'off' } = options;

      if (!currentId) {
        return null;
      }

      if (repeatMode === 'one') {
        return itemList.find((item) => item.id === currentId) ?? null;
      }

      if (shuffle) {
        return resolveShuffledTrack(currentId, 1, repeatMode === 'all');
      }

      return resolveLinearTrack(currentId, 1, repeatMode === 'all');
    }
  };
}

export const playlistStore = createTrackCollectionStore({
  dbName: 'izci-playlist',
  dedupe: false
});

export const libraryStore = createTrackCollectionStore({
  dbName: 'izci-library',
  dedupe: true
});
