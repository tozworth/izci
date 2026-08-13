import { derived, writable } from 'svelte/store';
import { logDebug, logError, logInfo } from '$lib/logging/api';
import type { MediaEntity, PlaylistPlaybackOptions, PlaylistRepeatMode, PlaylistSelection } from '$lib/contracts/catalog';
import { splitUniqueItems } from './playlist-dedupe';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import { materializeMediaEntity, type MediaMaterializationPurpose } from './playlist-materialization';
import { mediaSources } from '$lib/media/media-source';
import { deleteMediaSources, persistMediaSources, readMediaSources } from '$lib/media/media-source-persistence';
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
  type StoredMediaEntity,
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
  getIdentity?: (item: MediaEntity) => string;
}

export interface CollectionPersistenceStatus {
  state: 'hydrating' | 'ready' | 'persisting' | 'degraded';
  dirty: boolean;
  error: unknown | null;
}

export type ExternalTrackUpdate = Partial<
  Pick<
    MediaEntity,
    | 'path'
    | 'sourceFolderId'
    | 'name'
    | 'format'
    | 'kind'
    | 'size'
    | 'lastModified'
    | 'metadata'
  >
>;

const PERSIST_DEBOUNCE_MS = 400;
const BACKGROUND_PERSIST_DEBOUNCE_MS = 5_000;

export function createTrackCollectionStore(config: TrackCollectionStoreConfig) {
  const items = writable<MediaEntity[]>([]);
  const selection = writable<PlaylistSelection>(emptySelection);
  const playbackOptions = writable<PlaylistPlaybackOptions>(defaultPlaybackOptions);
  const persistenceStatus = writable<CollectionPersistenceStatus>({
    state: typeof window === 'undefined' ? 'ready' : 'hydrating',
    dirty: false,
    error: null
  });

  let itemList: MediaEntity[] = [];
  let selectionState: PlaylistSelection = emptySelection;
  let playbackOptionsState: PlaylistPlaybackOptions = defaultPlaybackOptions;
  let hydrated = typeof window === 'undefined';
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  let persistInFlight = false;
  let persistDirty = false;
  let persistDueAt = 0;
  let pendingPersistDelayMs = Number.POSITIVE_INFINITY;
  let shouldCompactStoredState = false;
  const pendingSourceDeletes = new Set<string>();
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
    persistenceStatus.set({ state: 'ready', dirty: true, error: null });
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
      persistenceStatus.set({ state: 'persisting', dirty: false, error: null });
      logDebug('library', 'Collection persistence started', { database: config.dbName, items: itemList.length });
      const durableItems = itemList.filter((item) => Boolean(mediaSources.get(item.id)?.fileHandle));
      const sources = durableItems.flatMap((item) => {
        const fileHandle = mediaSources.get(item.id)?.fileHandle;
        return fileHandle ? [{ entityId: item.id, fileHandle }] : [];
      });
      const deletedSourceIds = [...pendingSourceDeletes];
      void persistMediaSources(sources, config.dbName)
        .then(() => persistStoredState(config.dbName, {
          items: durableItems.map(serializeItem),
          selection: normalizeSelection(durableItems, selectionState),
          playbackOptions: playbackOptionsState
        }))
        .then(async () => {
          await deleteMediaSources(deletedSourceIds, config.dbName);
          for (const id of deletedSourceIds) pendingSourceDeletes.delete(id);
        }).catch((error) => {
        logError('library', 'Collection persistence failed', { database: config.dbName, error });
        persistenceStatus.set({ state: 'degraded', dirty: persistDirty, error });
      }).finally(() => {
        persistInFlight = false;
        if (!persistDirty) {
          persistenceStatus.update((status) => status.state === 'degraded'
            ? status
            : { state: 'ready', dirty: false, error: null });
        }
        logDebug('library', 'Collection persistence completed', { database: config.dbName });
        if (persistDirty) queuePersist(pendingPersistDelayMs);
      });
    }, Math.max(0, requestedDueAt - Date.now()));
  }

  async function applyStoredState(state: StoredPlaylistState | null): Promise<void> {
    const storedItems = Array.isArray(state?.items) ? state.items : [];
    const normalizedItems = storedItems
      .map(restoreStoredItem)
      .filter((item): item is MediaEntity => item !== null);

    const storedSources = await readMediaSources(normalizedItems.map((item) => item.id));
    const sourcesById = new Map(storedSources.map((source) => [source.entityId, source]));
    const sourcedItems = normalizedItems.filter((item) => sourcesById.has(item.id));
    for (const item of sourcedItems) {
      mediaSources.registerHandle(item.id, sourcesById.get(item.id)!.fileHandle, 'prompt');
    }
    const { uniqueItems } = splitUniqueItems(sourcedItems, {
      dedupe: shouldDedupe(),
      getIdentity
    });
    const restoredItemIds = new Set(uniqueItems.map((item) => item.id));
    const restoredSelection = normalizeStoredSelection(state?.selection, restoredItemIds);

    shouldCompactStoredState =
      storedItems.length > 0 && uniqueItems.length !== storedItems.length;

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
      .then(async (state) => {
        await applyStoredState(state);
        scheduleMetadataParsing({
          targetItems: itemList,
          getItemList: () => itemList,
          updateItems: (updater) => items.update(updater),
          queuePersist: (complete) => queuePersist(
            complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
          )
        });
      })
      .catch((error) => {
        logError('library', 'Collection hydration failed', { database: config.dbName, error });
        persistenceStatus.set({ state: 'degraded', dirty: false, error });
      })
      .finally(() => {
        hydrated = true;
        logInfo('library', 'Collection hydration completed', { database: config.dbName, items: itemList.length });
        persistenceStatus.update((status) => status.state === 'degraded'
          ? status
          : { state: 'ready', dirty: false, error: null });
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
    persistenceStatus,
    ready() {
      return readyPromise;
    },
    findEquivalent(item: MediaEntity) {
      const identity = getIdentity(item);
      return itemList.find((entry) => getIdentity(entry) === identity) ?? null;
    },
    async ensureLoaded(
      id: string,
      options: { prompt?: boolean; purpose?: MediaMaterializationPurpose } = {}
    ) {
      const item = itemList.find((entry) => entry.id === id);

      if (!item) {
        return null;
      }

      let lease;
      try {
        lease = await materializeMediaEntity(item, options.prompt === true, options.purpose ?? 'file-read');
      } catch (error) {
        logError('files', 'Collection item materialization failed', { database: config.dbName, id: item.id, error });
        throw error;
      }

      if (!lease) {
        return null;
      }
      return lease;
    },
    add(newItems: MediaEntity[]) {
      let addedItems: MediaEntity[] = [];

      const executed = runOrQueue(() => {
        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, {
          dedupe: shouldDedupe(),
          existingItems: itemList,
          getIdentity
        });

        for (const item of duplicateItems) mediaSources.remove(item.id);

        addedItems = uniqueItems;
        logInfo('library', 'Items added to collection', { database: config.dbName, added: uniqueItems.length, duplicatesDropped: duplicateItems.length });

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
    replaceAll(newItems: MediaEntity[]) {
      let removedItems: MediaEntity[] = [];
      let addedItems: MediaEntity[] = [];

      const executed = runOrQueue(() => {
        removedItems = [...itemList];

        const { uniqueItems, duplicateItems } = splitUniqueItems(newItems, {
          dedupe: shouldDedupe(),
          getIdentity
        });

        for (const item of duplicateItems) mediaSources.remove(item.id);

        addedItems = uniqueItems;
        logInfo('library', 'Collection replaced', { database: config.dbName, removed: removedItems.length, added: uniqueItems.length });
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
      logInfo('library', 'Items removed from collection', { database: config.dbName, removed: removedItems.length });

      items.update((existing) => existing.filter((item) => !idsToRemove.has(item.id)));
      selection.update((value) => removeIdsFromSelection(itemList, value, idsToRemove, previousItems));
      navigation.reset();
      for (const id of idsToRemove) {
        pendingSourceDeletes.add(id);
      }
      queuePersist();

      return removedItems;
    },
    replaceItem(id: string, replacements: MediaEntity[]) {
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
      if (!replacements.some((item) => item.id === id)) {
        pendingSourceDeletes.add(id);
      }
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
    updateMetadata(id: string, metadata: MediaEntity['metadata']) {
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
      let updatedItem: MediaEntity | null = null;

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
              patch.path !== undefined
              || patch.name !== undefined
              || patch.format !== undefined
              || patch.kind !== undefined
              || patch.size !== undefined
              || patch.lastModified !== undefined;

            updatedItem = {
              ...item,
              ...patch,
              id: item.id,
              metadata,
              subsong: item.subsong
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
    setShuffleEnabled(enabled: boolean) {
      runOrQueue(() => {
        if (playbackOptionsState.shuffle === enabled) return;
        playbackOptions.update((value) => ({
          ...value,
          shuffle: enabled
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
    reconcileFolder(folderId: string, scannedItems: MediaEntity[], activeFolderIds: string[] = []) {
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
      const replacements = new Map<string, MediaEntity>();
      const retainedManagedIds = new Set<string>();
      const addedItems: MediaEntity[] = [];
      const updatedItems: MediaEntity[] = [];

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
          existing.format !== candidate.format;
        const preservedMetadata = contentChanged
          ? existing.metadata?.playCount === undefined
            ? undefined
            : { playCount: existing.metadata.playCount }
          : existing.metadata;
        const candidateSource = mediaSources.get(scannedItem.id);
        if (candidateSource) {
          mediaSources.register({ ...candidateSource, entityId: existing.id });
          if (scannedItem.id !== existing.id) mediaSources.remove(scannedItem.id);
        }
        const replacement: MediaEntity = {
          ...candidate,
          id: existing.id,
          metadata: preservedMetadata,
          rating: existing.rating
        };

        replacements.set(existing.id, replacement);
        if (contentChanged) updatedItems.push(replacement);
      }

      const removedItems = managedItems.filter((item) => !retainedManagedIds.has(item.id));
      const removedIds = new Set(removedItems.map((item) => item.id));
      for (const item of removedItems) {
        pendingSourceDeletes.add(item.id);
      }

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
