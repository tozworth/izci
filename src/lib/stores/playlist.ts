import { derived, writable } from 'svelte/store';
import { logDebug, logError, logInfo } from '$lib/logging/api';
import type {
  MediaEntity,
  PlaylistPlaybackOptions,
  PlaylistRepeatMode,
  PlaylistSelection
} from '$lib/contracts/catalog';
import {
  CollectionRepository,
  type CollectionRepositoryStatus,
  type CollectionStorage
} from '$lib/collections/collection-repository';
import type { CollectionReduction } from '$lib/collections/collection-reducer';
import type { LibraryFolderReconciliationPlan } from '$lib/services/library-folder-plan';
import { materializeMediaEntity, type MediaMaterializationPurpose } from './playlist-materialization';
import { mediaSources } from '$lib/media/media-source';
import { deleteMediaSources, persistMediaSources, readMediaSources } from '$lib/media/media-source-persistence';
import { registerBrowserPersistenceOwner } from '$lib/persistence/browser-indexed-db';
import { scheduleMetadataParsing } from './playlist-metadata';
import { trackSettings } from './track-settings';
import { createPlaylistNavigation } from './playlist-navigation';
import {
  defaultPlaybackOptions,
  normalizePlaybackOptions,
  persistStoredState,
  readStoredState,
  restoreStoredItem,
  serializeItem,
  type StoredPlaylistState
} from './playlist-persistence';
import { emptySelection, normalizeSelection, normalizeStoredSelection, type SelectOptions } from './playlist-selection';
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

function publicPersistenceStatus(status: CollectionRepositoryStatus): CollectionPersistenceStatus {
  const state = status.phase === 'degraded'
    ? 'degraded'
    : status.phase === 'persisting' || status.phase === 'shutting-down'
      ? 'persisting'
      : status.phase === 'ready' || status.phase === 'disposed'
        ? 'ready'
        : 'hydrating';
  return { state, dirty: status.dirty, error: status.error };
}

export function createTrackCollectionStore(config: TrackCollectionStoreConfig) {
  const getIdentity = config.getIdentity ?? getTrackIdentity;
  const pendingSourceDeletes = new Set<string>();
  const metadataBatches = new Set<NonNullable<ReturnType<typeof scheduleMetadataParsing>>>();
  const storage: CollectionStorage<MediaEntity> = {
    async load() {
      const state: StoredPlaylistState | null = await readStoredState(config.dbName);
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

      const seen = new Set<string>();
      const shouldDedupe = typeof config.dedupe === 'function' ? config.dedupe() : config.dedupe;
      const entities = shouldDedupe
        ? sourcedItems.filter((item) => {
            const identity = getIdentity(item);
            if (seen.has(identity)) {
              pendingSourceDeletes.add(item.id);
              mediaSources.remove(item.id);
              return false;
            }
            seen.add(identity);
            return true;
          })
        : sourcedItems;
      const entityIds = new Set(entities.map((item) => item.id));
      return {
        record: {
          entities,
          selection: normalizeStoredSelection(state?.selection, entityIds),
          playbackOptions: normalizePlaybackOptions(state?.playbackOptions)
        },
        requiresRewrite: storedItems.length !== entities.length
      };
    },
    async save(record) {
      logDebug('library', 'Collection persistence started', {
        database: config.dbName,
        items: record.entities.length
      });
      const durableItems = record.entities.filter((item) => Boolean(mediaSources.get(item.id)?.fileHandle));
      const durableIds = new Set(durableItems.map((item) => item.id));
      const sources = durableItems.flatMap((item) => {
        const fileHandle = mediaSources.get(item.id)?.fileHandle;
        return fileHandle ? [{ entityId: item.id, fileHandle }] : [];
      });
      const deletedSourceIds = [...pendingSourceDeletes].filter((id) => !durableIds.has(id));
      await persistMediaSources(sources, config.dbName);
      await persistStoredState(config.dbName, {
        items: durableItems.map(serializeItem),
        selection: normalizeSelection([...durableItems], record.selection),
        playbackOptions: record.playbackOptions
      });
      await deleteMediaSources(deletedSourceIds, config.dbName);
      for (const id of deletedSourceIds) pendingSourceDeletes.delete(id);
      logDebug('library', 'Collection persistence completed', { database: config.dbName });
    }
  };
  const repository = new CollectionRepository<MediaEntity>({
    storage,
    scheduler: {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    policy: { dedupe: config.dedupe, identity: getIdentity },
    defaultPlaybackOptions,
    persistDelayMs: PERSIST_DEBOUNCE_MS,
    initiallyHydrated: typeof window === 'undefined'
  });

  const items = writable<MediaEntity[]>([]);
  const selection = writable<PlaylistSelection>(emptySelection);
  const playbackOptions = writable<PlaylistPlaybackOptions>(defaultPlaybackOptions);
  const persistenceStatus = writable<CollectionPersistenceStatus>(
    publicPersistenceStatus(repository.getStatus())
  );
  let itemList: MediaEntity[] = [];
  let selectionState: PlaylistSelection = emptySelection;
  let playbackOptionsState: PlaylistPlaybackOptions = defaultPlaybackOptions;
  const navigation = createPlaylistNavigation(() => itemList);
  let lastCatalogRevision = -1;
  let lastShuffle = false;

  repository.subscribe((state) => {
    itemList = [...state.entities];
    selectionState = state.selection;
    playbackOptionsState = state.playbackOptions;
    items.set(itemList);
    selection.set(state.selection);
    playbackOptions.set(state.playbackOptions);
    if (state.catalogRevision !== lastCatalogRevision || state.playbackOptions.shuffle !== lastShuffle) {
      navigation.reset();
    }
    lastCatalogRevision = state.catalogRevision;
    lastShuffle = state.playbackOptions.shuffle;
  });
  repository.subscribeStatus((status) => persistenceStatus.set(publicPersistenceStatus(status)));

  const selectedIds = derived(selection, ($selection) => $selection.ids);
  const shuffleEnabled = derived(playbackOptions, ($options) => $options.shuffle);
  const repeatMode = derived(playbackOptions, ($options) => $options.repeatMode);
  const selectedTrack = derived([items, selection], ([$items, $selection]) => {
    const primaryId = $selection.focusId ?? $selection.ids.at(-1);
    return primaryId ? $items.find((item) => item.id === primaryId) ?? null : null;
  });

  function canMutateSynchronously(): boolean {
    const status = repository.getStatus();
    return status.phase === 'ready'
      || status.phase === 'persisting'
      || (status.phase === 'degraded' && status.dirty);
  }

  function stageReduction(reduction: CollectionReduction<MediaEntity>): void {
    const currentIds = new Set(repository.getSnapshot().entities.map((item) => item.id));
    for (const item of reduction.duplicates) {
      if (!currentIds.has(item.id)) mediaSources.remove(item.id);
    }
    for (const item of reduction.removed) {
      if (!currentIds.has(item.id)) pendingSourceDeletes.add(item.id);
    }
  }

  function observe(
    operation: Promise<CollectionReduction<MediaEntity>>,
    after?: (reduction: CollectionReduction<MediaEntity>) => void
  ): void {
    void operation.then((reduction) => {
      stageReduction(reduction);
      after?.(reduction);
    }).catch((error) => {
      logError('library', 'Collection mutation failed', { database: config.dbName, error });
    });
  }

  function scheduleMetadata(targetItems: readonly MediaEntity[]): void {
    const batch = scheduleMetadataParsing({
      targetItems: [...targetItems],
      getItemList: () => itemList,
      updateItems: (updater) => {
        observe(repository.dispatch({
          type: 'apply-catalog',
          entities: updater([...repository.getSnapshot().entities])
        }, BACKGROUND_PERSIST_DEBOUNCE_MS));
      },
      queuePersist: (complete) => repository.requestPersist(
        complete ? PERSIST_DEBOUNCE_MS : BACKGROUND_PERSIST_DEBOUNCE_MS
      )
    });
    if (batch) {
      metadataBatches.add(batch);
      void batch.settled.finally(() => metadataBatches.delete(batch));
    }
  }

  const hydration = repository.hydrate().then(() => {
    const status = repository.getStatus();
    if (status.phase !== 'degraded') scheduleMetadata(repository.getSnapshot().entities);
    logInfo('library', 'Collection hydration completed', {
      database: config.dbName,
      items: repository.getSnapshot().entities.length
    });
  });
  void hydration.catch((error) => {
    logError('library', 'Collection hydration failed', { database: config.dbName, error });
  });

  return {
    items,
    selection,
    selectedIds,
    selectedTrack,
    shuffleEnabled,
    repeatMode,
    persistenceStatus,
    ready() {
      return repository.ready().catch(() => undefined);
    },
    flush() {
      return repository.flush();
    },
    shutdown() {
      for (const batch of metadataBatches) batch.cancel();
      metadataBatches.clear();
      return repository.shutdown();
    },
    getCatalogSnapshot() {
      const snapshot = repository.getSnapshot();
      return { entities: snapshot.entities, catalogRevision: snapshot.catalogRevision };
    },
    async applyCatalogIfRevision(
      expectedCatalogRevision: number,
      plan: LibraryFolderReconciliationPlan
    ): Promise<{ status: 'applied' | 'conflict'; actualCatalogRevision?: number }> {
      const result = await repository.dispatchIfCatalogRevision(expectedCatalogRevision, {
        type: 'apply-catalog',
        entities: plan.nextCatalog
      });
      if (result.status === 'conflict') {
        return { status: 'conflict', actualCatalogRevision: result.actualCatalogRevision };
      }
      stageReduction(result.reduction);
      for (const locator of plan.sourceRegistrations) mediaSources.register(locator);
      const currentIds = new Set(repository.getSnapshot().entities.map((item) => item.id));
      for (const id of plan.sourceDeletions) {
        if (currentIds.has(id)) continue;
        pendingSourceDeletes.add(id);
        mediaSources.remove(id);
      }
      // In browser-backed stores a successful folder commit is not observable until its
      // catalog and source-owner writes have both settled. Non-browser stores are ephemeral.
      if (typeof window !== 'undefined') await repository.flush();
      scheduleMetadata([...plan.addedItems, ...plan.updatedItems]);
      return { status: 'applied' };
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
      if (!item) return null;
      try {
        return await materializeMediaEntity(item, options.prompt === true, options.purpose ?? 'file-read');
      } catch (error) {
        logError('files', 'Collection item materialization failed', {
          database: config.dbName,
          id: item.id,
          error
        });
        throw error;
      }
    },
    add(newItems: MediaEntity[]) {
      const synchronous = canMutateSynchronously();
      const beforeLength = repository.getSnapshot().entities.length;
      const operation = repository.dispatch({ type: 'add', entities: newItems });
      observe(operation, (reduction) => {
        logInfo('library', 'Items added to collection', {
          database: config.dbName,
          added: reduction.added.length,
          duplicatesDropped: reduction.duplicates.length
        });
        scheduleMetadata(reduction.added);
      });
      return synchronous
        ? [...repository.getSnapshot().entities.slice(beforeLength)]
        : [];
    },
    replaceAll(newItems: MediaEntity[]) {
      const synchronous = canMutateSynchronously();
      const removedItems = synchronous ? [...repository.getSnapshot().entities] : [];
      const operation = repository.dispatch({ type: 'replace-all', entities: newItems });
      observe(operation, (reduction) => {
        logInfo('library', 'Collection replaced', {
          database: config.dbName,
          removed: reduction.removed.length,
          added: reduction.added.length
        });
        scheduleMetadata(reduction.added);
      });
      return synchronous
        ? { removedItems, addedItems: [...repository.getSnapshot().entities] }
        : { removedItems: [], addedItems: [] };
    },
    select(id: string, options: SelectOptions = {}) {
      observe(repository.dispatch({ type: 'select', id, ...options }));
    },
    selectAll() {
      observe(repository.dispatch({ type: 'select-all' }));
    },
    setSelection(nextSelection: PlaylistSelection) {
      observe(repository.dispatch({ type: 'set-selection', selection: nextSelection }));
    },
    remove(ids: string[]) {
      if (ids.length === 0 || !canMutateSynchronously()) return [];
      const removedItems = itemList.filter((item) => ids.includes(item.id));
      observe(repository.dispatch({ type: 'remove', ids }));
      logInfo('library', 'Items removed from collection', {
        database: config.dbName,
        removed: removedItems.length
      });
      return removedItems;
    },
    replaceItem(id: string, replacements: MediaEntity[]) {
      if (!canMutateSynchronously() || replacements.length === 0) return false;
      const beforeRevision = repository.getSnapshot().revision;
      observe(repository.dispatch({ type: 'replace-one', id, replacements }), (reduction) => {
        scheduleMetadata(reduction.added);
      });
      return repository.getSnapshot().revision !== beforeRevision;
    },
    updateMetadata(id: string, metadata: MediaEntity['metadata']) {
      if (!metadata) return;
      observe(repository.dispatch({ type: 'merge-object', id, field: 'metadata', value: metadata }));
    },
    updateRating(id: string, rating: number | undefined) {
      observe(repository.dispatch({ type: 'patch', id, patch: { rating } }));
    },
    applyExternalUpdate(id: string, patch: ExternalTrackUpdate) {
      const synchronous = canMutateSynchronously();
      const { metadata, ...fields } = patch;
      observe(repository.dispatch({
        type: 'patch',
        id,
        patch: fields,
        ...(metadata === undefined ? {} : {
          replaceObject: {
            field: 'metadata' as const,
            value: metadata,
            preserveKeys: ['playCount']
          }
        })
      }));
      return synchronous ? repository.getSnapshot().entities.find((item) => item.id === id) ?? null : null;
    },
    toggleShuffle() {
      observe(repository.dispatch({ type: 'toggle-shuffle' }));
    },
    setShuffleEnabled(enabled: boolean) {
      observe(repository.dispatch({ type: 'set-shuffle', enabled }));
    },
    cycleRepeatMode() {
      observe(repository.dispatch({ type: 'cycle-repeat' }));
    },
    resolveStartTrack(options: { selectedId?: string | null; shuffle?: boolean } = {}) {
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

export type TrackCollectionStore = ReturnType<typeof createTrackCollectionStore>;

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

for (const [label, store] of [
  ['playlist collection', playlistStore],
  ['library collection', libraryStore],
  ['favorites collection', favoritesStore]
] as const) {
  registerBrowserPersistenceOwner({
    label,
    flush: () => store.flush(),
    dispose: () => store.shutdown()
  });
}
