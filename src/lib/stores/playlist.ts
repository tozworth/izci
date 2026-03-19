import { derived, writable } from 'svelte/store';
import type {
  PlaylistItem,
  PlaylistPlaybackOptions,
  PlaylistRepeatMode,
  PlaylistSelection
} from '$lib/types';
import { splitUniqueItems } from './playlist-dedupe';
import { materializePlaylistItem, revokeObjectUrl } from './playlist-materialization';
import { scheduleMetadataParsing } from './playlist-metadata';
import { createPlaylistNavigation } from './playlist-navigation';
import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  normalizeStoredItem,
  persistStoredState,
  readStoredState,
  serializeItem,
  type StoredPlaylistItem,
  type StoredPlaylistState
} from './playlist-persistence';
import {
  buildSelectAllSelection,
  emptySelection,
  normalizeSelection,
  normalizeStoredSelection,
  removeIdsFromSelection,
  resolveSelectSelection,
  type SelectOptions
} from './playlist-selection';

interface TrackCollectionStoreConfig {
  dbName: string;
  dedupe: boolean;
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
  const navigation = createPlaylistNavigation(() => itemList);
  let resolveReady: (() => void) | null = null;
  const readyPromise = hydrated
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        resolveReady = resolve;
      });

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

    const { uniqueItems } = splitUniqueItems(normalizedItems, { dedupe: config.dedupe });
    const restoredItemIds = new Set(uniqueItems.map((item) => item.id));
    const restoredSelection = normalizeStoredSelection(state?.selection, restoredItemIds);

    shouldCompactStoredState =
      storedItems.length > 0 &&
      (uniqueItems.length !== storedItems.length ||
        storedItems.some((item) => Boolean(item && typeof item === 'object' && 'file' in (item as object))));

    items.set(uniqueItems);
    selection.set(restoredSelection);
    playbackOptions.set(normalizePlaybackOptions(state?.playbackOptions));
    navigation.reset();
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
        scheduleMetadataParsing({
          targetItems: itemList,
          getItemList: () => itemList,
          updateItems: (updater) => items.update(updater),
          queuePersist
        });
      })
      .finally(() => {
        hydrated = true;
        flushPendingOperations();

        if (shouldCompactStoredState) {
          queuePersist();
        }

        resolveReady?.();
        resolveReady = null;
      });
  }

  return {
    items,
    selection,
    selectedIds,
    selectedTrack,
    shuffleEnabled,
    repeatMode,
    ready() {
      return readyPromise;
    },
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
        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, {
          dedupe: config.dedupe,
          existingItems: itemList
        });

        for (const item of duplicateItems) {
          revokeObjectUrl(item);
        }

        addedItems = uniqueItems;

        if (uniqueItems.length === 0) {
          return;
        }

        items.update((existing) => [...existing, ...uniqueItems]);
        selection.update((value) => normalizeSelection(itemList, value));
        navigation.reset();
        scheduleMetadataParsing({
          targetItems: uniqueItems,
          getItemList: () => itemList,
          updateItems: (updater) => items.update(updater),
          queuePersist
        });
        queuePersist();
      });

      return executed ? addedItems : [];
    },
    replaceAll(newItems: PlaylistItem[]) {
      let removedItems: PlaylistItem[] = [];
      let addedItems: PlaylistItem[] = [];

      const executed = runOrQueue(() => {
        removedItems = [...itemList];

        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, { dedupe: config.dedupe });

        for (const item of duplicateItems) {
          revokeObjectUrl(item);
        }

        addedItems = uniqueItems;
        items.set(uniqueItems);
        selection.set(emptySelection);
        navigation.reset();
        scheduleMetadataParsing({
          targetItems: uniqueItems,
          getItemList: () => itemList,
          updateItems: (updater) => items.update(updater),
          queuePersist
        });
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
      runOrQueue(() => {
        selection.update((value) => resolveSelectSelection(itemList, value, id, options));
        queuePersist();
      });
    },
    selectAll() {
      runOrQueue(() => {
        selection.set(buildSelectAllSelection(itemList));
        queuePersist();
      });
    },
    setSelection(nextSelection: PlaylistSelection) {
      runOrQueue(() => {
        selection.set(normalizeSelection(itemList, nextSelection));
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
      selection.update((value) => removeIdsFromSelection(itemList, value, idsToRemove));
      navigation.reset();
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
        navigation.reset();
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
      return navigation.resolveStepTrack(options);
    },
    resolveTrackEnd(options: {
      currentId?: string | null;
      shuffle?: boolean;
      repeatMode?: PlaylistRepeatMode;
    }) {
      return navigation.resolveTrackEnd(options);
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
