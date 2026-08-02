import { derived, writable } from 'svelte/store';
import type {
  PlaylistItem,
  PlaylistPlaybackOptions,
  PlaylistRepeatMode,
  PlaylistSelection
} from '$lib/types';
import { splitUniqueItems } from './playlist-dedupe';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import { materializePlaylistItem, revokeObjectUrl } from './playlist-materialization';
import { scheduleMetadataParsing } from './playlist-metadata';
import { playbackSettings } from './playback-settings';
import { trackSettings } from './track-settings';
import { createPlaylistNavigation } from './playlist-navigation';
import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  persistStoredState,
  readStoredState,
  restoreStoredItem,
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
import { getFavoriteIdentity, getTrackIdentity } from '$lib/utils/files';

export interface TrackCollectionStoreConfig {
  dbName: string;
  dedupe: boolean | (() => boolean);
  getIdentity?: (item: PlaylistItem) => string;
}

export type ExternalTrackUpdate = Partial<
  Pick<
    PlaylistItem,
    | 'file'
    | 'fileHandle'
    | 'path'
    | 'sourceFolderId'
    | 'name'
    | 'extension'
    | 'kind'
    | 'size'
    | 'lastModified'
    | 'metadata'
  >
>;

const PERSIST_DEBOUNCE_MS = 400;
const BACKGROUND_PERSIST_DEBOUNCE_MS = 5_000;

export function createTrackCollectionStore(config: TrackCollectionStoreConfig) {
  const items = writable<PlaylistItem[]>([]);
  const selection = writable<PlaylistSelection>(emptySelection);
  const playbackOptions = writable<PlaylistPlaybackOptions>(defaultPlaybackOptions);

  let itemList: PlaylistItem[] = [];
  let selectionState: PlaylistSelection = emptySelection;
  let playbackOptionsState: PlaylistPlaybackOptions = defaultPlaybackOptions;
  let hydrated = typeof window === 'undefined';
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistInFlight = false;
  let persistDirty = false;
  let persistDueAt = 0;
  let pendingPersistDelayMs = Number.POSITIVE_INFINITY;
  let shouldCompactStoredState = false;
  const pendingOperations: Array<() => void> = [];
  const navigation = createPlaylistNavigation(() => itemList);
  const shouldDedupe = () => typeof config.dedupe === 'function' ? config.dedupe() : config.dedupe;
  const getIdentity = config.getIdentity ?? getTrackIdentity;
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

  function queuePersist(delayMs = PERSIST_DEBOUNCE_MS): void {
    if (!hydrated) {
      return;
    }

    persistDirty = true;
    pendingPersistDelayMs = Math.min(pendingPersistDelayMs, Math.max(0, delayMs));
    if (persistInFlight) return;

    const requestedDueAt = Date.now() + pendingPersistDelayMs;
    if (persistTimer !== undefined) {
      if (persistDueAt <= requestedDueAt) return;
      clearTimeout(persistTimer);
    }

    persistDueAt = requestedDueAt;

    persistTimer = setTimeout(() => {
      persistTimer = undefined;
      persistDueAt = 0;
      if (!persistDirty || persistInFlight) return;

      persistDirty = false;
      pendingPersistDelayMs = Number.POSITIVE_INFINITY;
      persistInFlight = true;
      void persistStoredState(config.dbName, {
        items: itemList.map(serializeItem).filter((item): item is StoredPlaylistItem => item !== null),
        selection: selectionState,
        playbackOptions: playbackOptionsState
      }).finally(() => {
        persistInFlight = false;
        if (persistDirty) queuePersist(pendingPersistDelayMs);
      });
    }, Math.max(0, requestedDueAt - Date.now()));
  }

  function applyStoredState(state: StoredPlaylistState | null): void {
    const storedItems = Array.isArray(state?.items) ? state.items : [];
    const normalizedItems = storedItems
      .map(restoreStoredItem)
      .filter((item): item is PlaylistItem => item !== null);

    const { uniqueItems } = splitUniqueItems(normalizedItems, {
      dedupe: shouldDedupe(),
      getIdentity
    });
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
          queuePersist: (complete) => queuePersist(
            complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
          )
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
    findEquivalent(item: PlaylistItem) {
      const identity = getIdentity(item);
      return itemList.find((entry) => getIdentity(entry) === identity) ?? null;
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

      let playableItem = materializedItem;

      if (
        playableItem.kind === 'stream' &&
        playbackSettings.getSnapshot().replayGainMode !== 'off' &&
        playableItem.metadata?.embeddedMetadataLoaded !== true
      ) {
        const embeddedMetadata = await loadTrackMetadata(playableItem).catch(() => null);

        if (embeddedMetadata) {
          const latestItem = itemList.find((entry) => entry.id === id) ?? playableItem;
          playableItem = {
            ...playableItem,
            metadata: {
              ...latestItem.metadata,
              ...embeddedMetadata
            }
          };
        }
      }

      if (playableItem === item) {
        return item;
      }

      items.update((existing) =>
        existing.map((entry) => {
          if (entry.id !== id) {
            return entry;
          }

          if (entry.objectUrl && entry.objectUrl !== playableItem.objectUrl) {
            revokeObjectUrl(entry);
          }

          return playableItem;
        })
      );
      queuePersist();

      return playableItem;
    },
    add(newItems: PlaylistItem[]) {
      let addedItems: PlaylistItem[] = [];

      const executed = runOrQueue(() => {
        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, {
          dedupe: shouldDedupe(),
          existingItems: itemList,
          getIdentity
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
          queuePersist: (complete) => queuePersist(
            complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
          )
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

        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, {
          dedupe: shouldDedupe(),
          getIdentity
        });

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
          queuePersist: (complete) => queuePersist(
            complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
          )
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

      const previousItems = itemList;
      const idsToRemove = new Set(ids);
      const removedItems = itemList.filter((item) => idsToRemove.has(item.id));

      items.update((existing) => existing.filter((item) => !idsToRemove.has(item.id)));
      selection.update((value) => removeIdsFromSelection(itemList, value, idsToRemove, previousItems));
      navigation.reset();
      queuePersist();

      return removedItems;
    },
    replaceItem(id: string, replacements: PlaylistItem[]) {
      if (!hydrated || replacements.length === 0) {
        return false;
      }

      const index = itemList.findIndex((item) => item.id === id);

      if (index < 0) {
        return false;
      }

      const nextItems = [
        ...itemList.slice(0, index),
        ...replacements,
        ...itemList.slice(index + 1)
      ];
      const replacementIds = new Set(replacements.map((item) => item.id));
      const fallbackId = replacements[0].id;
      const nextSelection: PlaylistSelection = {
        ids: selectionState.ids.flatMap((selectedId) =>
          selectedId === id ? [replacementIds.has(id) ? id : fallbackId] : [selectedId]
        ),
        anchorId:
          selectionState.anchorId === id
            ? replacementIds.has(id) ? id : fallbackId
            : selectionState.anchorId,
        focusId:
          selectionState.focusId === id
            ? replacementIds.has(id) ? id : fallbackId
            : selectionState.focusId
      };

      items.set(nextItems);
      selection.set(normalizeSelection(nextItems, nextSelection));
      navigation.reset();
      queuePersist();
      return true;
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
    updateRating(id: string, rating: number | undefined) {
      runOrQueue(() => {
        items.update((existing) =>
          existing.map((item) => item.id === id ? { ...item, rating } : item)
        );
        queuePersist();
      });
    },
    applyExternalUpdate(id: string, patch: ExternalTrackUpdate) {
      let updatedItem: PlaylistItem | null = null;

      const executed = runOrQueue(() => {
        items.update((existing) =>
          existing.map((item) => {
            if (item.id !== id) return item;

            const existingPlayCount = item.metadata?.playCount;
            const { playCount: _externalPlayCount, ...externalMetadata } = patch.metadata ?? {};
            const metadata = patch.metadata === undefined
              ? item.metadata
              : {
                  ...externalMetadata,
                  ...(existingPlayCount === undefined ? {} : { playCount: existingPlayCount })
                };
            const fileChanged =
              patch.file !== undefined
              || patch.fileHandle !== undefined
              || patch.path !== undefined
              || patch.name !== undefined
              || patch.extension !== undefined
              || patch.kind !== undefined
              || patch.size !== undefined
              || patch.lastModified !== undefined;

            if (fileChanged) revokeObjectUrl(item);

            updatedItem = {
              ...item,
              ...patch,
              id: item.id,
              metadata,
              subsong: item.subsong,
              ...(fileChanged ? { file: patch.file, objectUrl: undefined } : {})
            };
            return updatedItem;
          })
        );

        if (updatedItem) {
          navigation.reset();
          queuePersist();
        }
      });

      return executed ? updatedItem : null;
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
          repeatMode:
            value.repeatMode === 'off'
              ? 'all'
              : value.repeatMode === 'all'
                ? 'one'
                : 'off'
        }));
        queuePersist();
      });
    },
    reconcileFolder(folderId: string, scannedItems: PlaylistItem[], activeFolderIds: string[] = []) {
      if (!hydrated) {
        return { addedItems: [], updatedItems: [], removedItems: [] };
      }

      const managedItems = itemList.filter((item) => item.sourceFolderId === folderId);
      const managedByIdentity = new Map(managedItems.map((item) => [getTrackIdentity(item), item]));
      const activeFolderIdSet = new Set(activeFolderIds);
      const adoptableByIdentity = new Map(
        itemList
          .filter((item) => !item.sourceFolderId || !activeFolderIdSet.has(item.sourceFolderId))
          .map((item) => [getTrackIdentity(item), item])
      );
      const replacements = new Map<string, PlaylistItem>();
      const retainedManagedIds = new Set<string>();
      const addedItems: PlaylistItem[] = [];
      const updatedItems: PlaylistItem[] = [];

      for (const scannedItem of scannedItems) {
        const candidate = { ...scannedItem, sourceFolderId: folderId };
        const identity = getTrackIdentity(candidate);
        const existing = managedByIdentity.get(identity) ?? adoptableByIdentity.get(identity);

        if (!existing) {
          addedItems.push(candidate);
          continue;
        }

        retainedManagedIds.add(existing.id);
        const contentChanged =
          existing.size !== candidate.size ||
          existing.lastModified !== candidate.lastModified ||
          existing.kind !== candidate.kind ||
          existing.extension !== candidate.extension;
        const preservedMetadata = contentChanged
          ? existing.metadata?.playCount === undefined
            ? undefined
            : { playCount: existing.metadata.playCount }
          : existing.metadata;
        const replacement: PlaylistItem = {
          ...candidate,
          id: existing.id,
          metadata: preservedMetadata,
          rating: existing.rating,
          file: contentChanged ? candidate.file : existing.file ?? candidate.file,
          objectUrl: contentChanged ? candidate.objectUrl : existing.objectUrl ?? candidate.objectUrl
        };

        if (contentChanged && existing.objectUrl && existing.objectUrl !== replacement.objectUrl) {
          revokeObjectUrl(existing);
        }

        replacements.set(existing.id, replacement);
        if (contentChanged) updatedItems.push(replacement);
      }

      const removedItems = managedItems.filter((item) => !retainedManagedIds.has(item.id));
      const removedIds = new Set(removedItems.map((item) => item.id));
      for (const item of removedItems) revokeObjectUrl(item);

      const previousItems = itemList;
      const nextItems = itemList
        .filter((item) => !removedIds.has(item.id))
        .map((item) => replacements.get(item.id) ?? item)
        .concat(addedItems);

      items.set(nextItems);
      selection.set(removeIdsFromSelection(nextItems, selectionState, removedIds, previousItems));
      navigation.reset();
      scheduleMetadataParsing({
        targetItems: [...addedItems, ...updatedItems],
        getItemList: () => itemList,
        updateItems: (updater) => items.update(updater),
        queuePersist: (complete) => queuePersist(
          complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
        )
      });
      queuePersist();

      return { addedItems, updatedItems, removedItems };
    },
    resolveStartTrack(options: {
      selectedId?: string | null;
      shuffle?: boolean;
    } = {}) {
      return navigation.resolveStartTrack(options);
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
  dedupe: () => trackSettings.getSnapshot().deduplicatePlaylist,
  getIdentity: getFavoriteIdentity
});

export const libraryStore = createTrackCollectionStore({
  dbName: 'izci-library',
  dedupe: true
});

export const favoritesStore = createTrackCollectionStore({
  dbName: 'izci-favorites',
  dedupe: true,
  getIdentity: getFavoriteIdentity
});
