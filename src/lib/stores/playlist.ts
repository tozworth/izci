import { derived, writable } from 'svelte/store';
import type { PlaylistItem } from '$lib/types';

interface PlaylistSelection {
  ids: string[];
  anchorId: string | null;
  focusId: string | null;
}

interface SelectOptions {
  range?: boolean;
  toggle?: boolean;
}

interface StoredPlaylistItem {
  id: string;
  file: File;
  name: string;
  extension: string;
  kind: PlaylistItem['kind'];
  size: number;
  metadata?: PlaylistItem['metadata'];
}

interface StoredPlaylistState {
  items: StoredPlaylistItem[];
  selection: PlaylistSelection;
}

const emptySelection: PlaylistSelection = {
  ids: [],
  anchorId: null,
  focusId: null
};

const PLAYLIST_DB_NAME = 'izci-playlist';
const PLAYLIST_DB_VERSION = 1;
const PLAYLIST_STORE_NAME = 'playlist';
const PLAYLIST_STATE_KEY = 'state';

function normalizeStoredItem(value: unknown): PlaylistItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<StoredPlaylistItem>;

  if (
    typeof source.id !== 'string' ||
    !(source.file instanceof File) ||
    typeof source.name !== 'string' ||
    typeof source.extension !== 'string' ||
    (source.kind !== 'stream' && source.kind !== 'module') ||
    typeof source.size !== 'number'
  ) {
    return null;
  }

  return {
    id: source.id,
    file: source.file,
    name: source.name,
    extension: source.extension,
    kind: source.kind,
    size: source.size,
    metadata: source.metadata,
    objectUrl: source.kind === 'stream' ? URL.createObjectURL(source.file) : undefined
  };
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

function serializeItem(item: PlaylistItem): StoredPlaylistItem {
  return {
    id: item.id,
    file: item.file,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: item.size,
    metadata: item.metadata
  };
}

async function openPlaylistDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(PLAYLIST_DB_NAME, PLAYLIST_DB_VERSION);

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

async function readStoredState(): Promise<StoredPlaylistState | null> {
  const database = await openPlaylistDatabase();

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

async function persistStoredState(state: StoredPlaylistState): Promise<void> {
  const database = await openPlaylistDatabase();

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

function createPlaylistStore() {
  const items = writable<PlaylistItem[]>([]);
  const selection = writable<PlaylistSelection>(emptySelection);

  let itemList: PlaylistItem[] = [];
  let selectionState: PlaylistSelection = emptySelection;
  let hydrated = typeof window === 'undefined';
  let persistQueued = false;
  const pendingOperations: Array<() => void> = [];

  items.subscribe((value) => {
    itemList = value;
  });

  selection.subscribe((value) => {
    selectionState = value;
  });

  const selectedIds = derived(selection, ($selection) => $selection.ids);

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

      void persistStoredState({
        items: itemList.map(serializeItem),
        selection: selectionState
      });
    });
  }

  function applyStoredState(state: StoredPlaylistState | null): void {
    const restoredItems = (state?.items ?? []).map(normalizeStoredItem).filter((item): item is PlaylistItem => item !== null);
    const restoredItemIds = new Set(restoredItems.map((item) => item.id));
    const restoredSelection = normalizeStoredSelection(state?.selection, restoredItemIds);

    items.set(restoredItems);
    selection.set(restoredSelection);
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

  function runOrQueue(operation: () => void): void {
    if (!hydrated) {
      pendingOperations.push(operation);
      return;
    }

    operation();
  }

  if (typeof window !== 'undefined') {
    void readStoredState()
      .then((state) => {
        applyStoredState(state);
      })
      .finally(() => {
        hydrated = true;
        flushPendingOperations();
      });
  }

  return {
    items,
    selectedIds,
    selectedTrack,
    add(newItems: PlaylistItem[]) {
      runOrQueue(() => {
        items.update((existing) => [...existing, ...newItems]);
        selection.update((value) => normalizeSelection(value));
        queuePersist();
      });
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
    remove(ids: string[]) {
      if (ids.length === 0) {
        return [];
      }

      if (!hydrated) {
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
    }
  };
}

export const playlistStore = createPlaylistStore();
