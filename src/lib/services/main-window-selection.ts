import { favoritesStore, libraryStore, queueStore } from '$lib/stores/queue';
import {
  buildSelectAllSelection,
  emptySelection,
  resolveSelectSelection
} from '$lib/stores/queue-selection';
import type { LibraryViewId, TrackItem, TrackSelection, WorkspaceCollection } from '$lib/types';

export interface RemoteSelectionSnapshot {
  track: TrackSelection;
  library: TrackSelection;
  favorites: TrackSelection;
}

interface WindowSelectionDeps {
  getIsMultiplayerClient(): boolean;
  getQueueItems(): TrackItem[];
  getLibraryItems(): TrackItem[];
  getFavoriteItems(): TrackItem[];
  getRemoteSelections(): RemoteSelectionSnapshot;
  setRemoteSelections(selections: RemoteSelectionSnapshot): void;
  getActiveView(): LibraryViewId;
  focusCollection(collection: WorkspaceCollection): void;
  selectTrack(
    collection: WorkspaceCollection,
    id: string,
    options?: { range?: boolean; toggle?: boolean }
  ): void;
  setCollectionSelection(collection: WorkspaceCollection, selection: TrackSelection): void;
}

/**
 * Main-window collection selection plumbing: the multiplayer-aware
 * clear/select/set/selectAll entry points (used by workspace-shell and the
 * library panel handlers) plus the favorites-view variants. Selection state
 * itself stays in the component (reactive lets); this controller owns the
 * routing between remote (client) and local stores.
 */
export function createWindowSelectionController(deps: WindowSelectionDeps) {
  function setRemote(collection: 'queue' | 'library' | 'favorites', selection: TrackSelection): void {
    const current = deps.getRemoteSelections();
    deps.setRemoteSelections(
      collection === 'queue'
        ? { ...current, track: selection }
        : collection === 'library'
          ? { ...current, library: selection }
          : { ...current, favorites: selection }
    );
  }

  function getRemote(collection: WorkspaceCollection): TrackSelection {
    return collection === 'queue'
      ? deps.getRemoteSelections().track
      : deps.getRemoteSelections().library;
  }

  function clear(collection: WorkspaceCollection): void {
    if (deps.getIsMultiplayerClient()) {
      setRemote(collection === 'queue' ? 'queue' : 'library', emptySelection);
      return;
    }
    (collection === 'queue' ? queueStore : libraryStore).setSelection(emptySelection);
  }

  function select(
    collection: WorkspaceCollection,
    id: string,
    options?: { range?: boolean; toggle?: boolean }
  ): void {
    if (!deps.getIsMultiplayerClient()) {
      (collection === 'queue' ? queueStore : libraryStore).select(id, options);
      return;
    }
    const items = collection === 'queue' ? deps.getQueueItems() : deps.getLibraryItems();
    setRemote(
      collection === 'queue' ? 'queue' : 'library',
      resolveSelectSelection(items, getRemote(collection), id, options)
    );
  }

  function set(collection: WorkspaceCollection, selection: TrackSelection): void {
    if (deps.getIsMultiplayerClient()) {
      const items = collection === 'queue' ? deps.getQueueItems() : deps.getLibraryItems();
      const itemIds = new Set(items.map((item) => item.id));
      const ids = selection.ids.filter((id) => itemIds.has(id));
      setRemote(collection === 'queue' ? 'queue' : 'library', {
        ids,
        anchorId: selection.anchorId && itemIds.has(selection.anchorId)
          ? selection.anchorId
          : ids[0] ?? null,
        focusId: selection.focusId && itemIds.has(selection.focusId)
          ? selection.focusId
          : ids.at(-1) ?? null
      });
      return;
    }
    (collection === 'queue' ? queueStore : libraryStore).setSelection(selection);
  }

  function selectAll(collection: WorkspaceCollection): void {
    if (deps.getIsMultiplayerClient()) {
      setRemote(
        collection === 'queue' ? 'queue' : 'library',
        buildSelectAllSelection(collection === 'queue' ? deps.getQueueItems() : deps.getLibraryItems())
      );
      return;
    }
    (collection === 'queue' ? queueStore : libraryStore).selectAll();
  }

  function selectAllFavorites(): void {
    if (deps.getIsMultiplayerClient()) {
      setRemote('favorites', buildSelectAllSelection(deps.getFavoriteItems()));
      return;
    }
    favoritesStore.selectAll();
  }

  function handleLibraryPanelSelect(
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ): void {
    if (deps.getActiveView() !== 'favorites') {
      deps.selectTrack('library', event.detail.id, {
        range: event.detail.range,
        toggle: event.detail.toggle
      });
      return;
    }

    deps.focusCollection('library');
    if (deps.getIsMultiplayerClient()) {
      setRemote(
        'favorites',
        resolveSelectSelection(
          deps.getFavoriteItems(),
          deps.getRemoteSelections().favorites,
          event.detail.id,
          { range: event.detail.range, toggle: event.detail.toggle }
        )
      );
    } else {
      favoritesStore.select(event.detail.id, {
        range: event.detail.range,
        toggle: event.detail.toggle
      });
    }
  }

  function handleLibraryPanelSetSelection(event: CustomEvent<TrackSelection>): void {
    if (deps.getActiveView() === 'favorites') {
      deps.focusCollection('library');
      if (deps.getIsMultiplayerClient()) {
        setRemote('favorites', event.detail);
      } else {
        favoritesStore.setSelection(event.detail);
      }
      return;
    }

    deps.setCollectionSelection('library', event.detail);
  }

  return {
    clear,
    select,
    set,
    selectAll,
    selectAllFavorites,
    handleLibraryPanelSelect,
    handleLibraryPanelSetSelection
  };
}
