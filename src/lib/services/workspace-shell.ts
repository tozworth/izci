import { writable } from 'svelte/store';
import type {
  WorkspacePanelHandlers,
  WorkspacePanelProps,
  WorkspaceTabDefinition
} from '$lib/components/workspace/types';
import {
  COMPACT_WORKSPACE_RESIZER_WIDTH,
  getWideContentWidth,
  resolveResizedPanelLayout,
  resolveWidePanelWidths
} from '$lib/services/workspace-layout';
import { libraryStore, playlistStore } from '$lib/stores/playlist';
import { workspacePanelLayout } from '$lib/stores/workspace-panel-layout';
import type {
  MenuActionItem,
  PlaylistItem,
  PlaylistRepeatMode,
  PlaylistSelection,
  WorkspaceCollection,
  WorkspaceJumpRequest,
  WorkspacePanelLayoutSettings,
  WorkspaceResizeHandle,
  WorkspaceTab
} from '$lib/types';
import { getOtherWorkspaceCollection } from '$lib/services/workspace-actions';

type TrackCollectionStore = typeof playlistStore;

type PanelResizeState = {
  handle: WorkspaceResizeHandle;
  startX: number;
  startLayout: WorkspacePanelLayoutSettings;
};

interface WorkspaceShellInputs {
  innerWidth: number;
  compactShell: boolean;
  playlistItems: PlaylistItem[];
  libraryItems: PlaylistItem[];
  playlistSelectionIds: string[];
  librarySelectionIds: string[];
  librarySelectionAnchorId: string | null;
  playingTrackId: string | null;
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
}

interface CreateWorkspaceShellControllerOptions {
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[];
  getLibraryContextActions: () => MenuActionItem[];
}

export interface WorkspaceShellState {
  activeCollection: WorkspaceCollection;
  activeWorkspaceTab: WorkspaceTab;
  isDetailsPanelVisible: boolean;
  isTabbedLayout: boolean;
  isResizing: boolean;
  widePanelWidths: Record<'playlist' | 'library' | 'details', number>;
  workspaceTabs: WorkspaceTabDefinition[];
  playlistPanelProps: WorkspacePanelProps;
  libraryPanelProps: WorkspacePanelProps;
  playlistJumpRequest: WorkspaceJumpRequest | null;
}

const allWorkspaceTabs: WorkspaceTabDefinition[] = [
  { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
  { id: 'library', icon: 'library_music', label: 'Library' },
  { id: 'details', icon: 'info', label: 'Details' }
];

function createInitialState(
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[],
  getLibraryContextActions: () => MenuActionItem[]
): WorkspaceShellState {
  return {
    activeCollection: 'playlist',
    activeWorkspaceTab: 'playlist',
    isDetailsPanelVisible: true,
    isTabbedLayout: false,
    isResizing: false,
    widePanelWidths: resolveWidePanelWidths(workspacePanelLayout.getSnapshot(), 0),
    workspaceTabs: allWorkspaceTabs.filter((tab) => tab.id !== 'details'),
    playlistJumpRequest: null,
    playlistPanelProps: {
      items: [],
      selectedIds: [],
      playingId: null,
      jumpToItemRequest: null,
      panelTitle: 'Playlist',
      regionLabel: 'Playlist',
      shuffleEnabled: false,
      repeatMode: 'off',
      getContextMenuActions: getPlaylistContextActions
    },
    libraryPanelProps: {
      items: [],
      selectedIds: [],
      selectionAnchorId: null,
      playingId: null,
      panelTitle: 'Library',
      regionLabel: 'Library',
      layout: 'columns',
      showShuffleControl: false,
      showRepeatControl: false,
      showSearchControl: true,
      getContextMenuActions: getLibraryContextActions
    }
  };
}

export function createWorkspaceShellController({
  getPlaylistContextActions,
  getLibraryContextActions
}: CreateWorkspaceShellControllerOptions) {
  let panelLayout = workspacePanelLayout.getSnapshot();
  let resizeState: PanelResizeState | null = null;
  let lastInputs: WorkspaceShellInputs | null = null;
  let state = createInitialState(getPlaylistContextActions, getLibraryContextActions);
  const store = writable(state);

  function publishState(): void {
    store.set(state);
  }

  function getCollectionStore(collection: WorkspaceCollection): TrackCollectionStore {
    return collection === 'library' ? libraryStore : playlistStore;
  }

  function getSelectionIds(collection: WorkspaceCollection): string[] {
    if (!lastInputs) {
      return [];
    }

    return collection === 'library' ? lastInputs.librarySelectionIds : lastInputs.playlistSelectionIds;
  }

  function clearSelection(collection: WorkspaceCollection): void {
    if (getSelectionIds(collection).length === 0) {
      return;
    }

    getCollectionStore(collection).setSelection({
      ids: [],
      anchorId: null,
      focusId: null
    });
  }

  function clearOtherSelection(collection: WorkspaceCollection): void {
    clearSelection(getOtherWorkspaceCollection(collection));
  }

  function recomputeDerivedState(): void {
    if (!lastInputs) {
      return;
    }

    if (lastInputs.playlistSelectionIds.length > 0 && lastInputs.librarySelectionIds.length > 0) {
      clearSelection(getOtherWorkspaceCollection(state.activeCollection));
    }

    const isTabbedLayout = lastInputs.innerWidth <= 750;
    const viewportWidth =
      lastInputs.innerWidth > 0
        ? lastInputs.innerWidth
        : typeof window !== 'undefined'
          ? window.innerWidth
          : 0;
    const wideContentWidth = getWideContentWidth(viewportWidth, {
      detailsVisible: state.isDetailsPanelVisible,
      horizontalPadding: lastInputs.compactShell ? 0 : undefined,
      resizerWidth: lastInputs.compactShell ? COMPACT_WORKSPACE_RESIZER_WIDTH : undefined
    });
    const widePanelWidths = resolveWidePanelWidths(panelLayout, wideContentWidth, {
      detailsVisible: state.isDetailsPanelVisible
    });
    const activeWorkspaceTab =
      !state.isDetailsPanelVisible && state.activeWorkspaceTab === 'details'
        ? state.activeCollection
        : state.activeWorkspaceTab;

    state = {
      ...state,
      activeWorkspaceTab,
      isTabbedLayout,
      isResizing: Boolean(resizeState),
      widePanelWidths,
      workspaceTabs: allWorkspaceTabs.filter(
        (tab) => tab.id !== 'details' || state.isDetailsPanelVisible
      ),
      playlistPanelProps: {
        items: lastInputs.playlistItems,
        selectedIds: lastInputs.playlistSelectionIds,
        playingId: lastInputs.playingTrackId,
        jumpToItemRequest: state.playlistJumpRequest,
        panelTitle: 'Playlist',
        regionLabel: 'Playlist',
        shuffleEnabled: lastInputs.shuffleEnabled,
        repeatMode: lastInputs.repeatMode,
        getContextMenuActions: getPlaylistContextActions
      },
      libraryPanelProps: {
        items: lastInputs.libraryItems,
        selectedIds: lastInputs.librarySelectionIds,
        selectionAnchorId: lastInputs.librarySelectionAnchorId,
        playingId: null,
        panelTitle: 'Library',
        regionLabel: 'Library',
        layout: 'columns',
        showShuffleControl: false,
        showRepeatControl: false,
        showSearchControl: true,
        getContextMenuActions: getLibraryContextActions
      }
    };
    publishState();
  }

  const unsubscribePanelLayout = workspacePanelLayout.subscribe((value) => {
    panelLayout = value;
    recomputeDerivedState();
  });

  return {
    subscribe: store.subscribe,
    getSnapshot(): WorkspaceShellState {
      return state;
    },
    sync(inputs: WorkspaceShellInputs): void {
      lastInputs = inputs;
      recomputeDerivedState();
    },
    clearSelection,
    selectTrack(
      collection: WorkspaceCollection,
      id: string,
      options?: { range?: boolean; toggle?: boolean }
    ): void {
      clearOtherSelection(collection);
      state = { ...state, activeCollection: collection };
      publishState();
      getCollectionStore(collection).select(id, options);
    },
    setCollectionSelection(collection: WorkspaceCollection, nextSelection: PlaylistSelection): void {
      clearOtherSelection(collection);
      state = { ...state, activeCollection: collection };
      publishState();
      getCollectionStore(collection).setSelection(nextSelection);
    },
    selectAllTracks(collection: WorkspaceCollection): void {
      clearOtherSelection(collection);
      state = { ...state, activeCollection: collection };
      publishState();
      getCollectionStore(collection).selectAll();
    },
    focusCollection(collection: WorkspaceCollection): void {
      if (state.activeCollection === collection) {
        return;
      }

      state = { ...state, activeCollection: collection };
      publishState();
    },
    setActiveWorkspaceTab(tab: WorkspaceTab): void {
      state = {
        ...state,
        activeWorkspaceTab: tab,
        activeCollection: tab !== 'details' ? tab : state.activeCollection
      };
      recomputeDerivedState();
    },
    showPlaylistTrack(id: string): void {
      this.setActiveWorkspaceTab('playlist');
      this.selectTrack('playlist', id);
      state = {
        ...state,
        playlistJumpRequest: {
          id,
          token: (state.playlistJumpRequest?.token ?? 0) + 1
        }
      };
      publishState();
    },
    showTrackDetails(): void {
      state = { ...state, isDetailsPanelVisible: true };
      this.setActiveWorkspaceTab('details');
    },
    closeTrackDetails(): void {
      state = { ...state, isDetailsPanelVisible: false };
      recomputeDerivedState();
    },
    beginPanelResize(event: PointerEvent, handle: WorkspaceResizeHandle): void {
      if (state.isTabbedLayout) {
        return;
      }

      event.preventDefault();
      resizeState = {
        handle,
        startX: event.clientX,
        startLayout: panelLayout
      };
      recomputeDerivedState();
    },
    handleWideWorkspaceResizeStart(detail: {
      event: PointerEvent;
      handle: WorkspaceResizeHandle;
    }): void {
      this.beginPanelResize(detail.event, detail.handle);
    },
    handlePanelResizeMove(event: PointerEvent): void {
      if (!resizeState || state.isTabbedLayout || !lastInputs) {
        return;
      }

      const viewportWidth =
        lastInputs.innerWidth > 0
          ? lastInputs.innerWidth
          : typeof window !== 'undefined'
            ? window.innerWidth
            : 0;
      const wideContentWidth = getWideContentWidth(viewportWidth, {
        detailsVisible: state.isDetailsPanelVisible,
        horizontalPadding: lastInputs.compactShell ? 0 : undefined,
        resizerWidth: lastInputs.compactShell ? COMPACT_WORKSPACE_RESIZER_WIDTH : undefined
      });

      workspacePanelLayout.set(
        resolveResizedPanelLayout({
          handle: resizeState.handle,
          startLayout: resizeState.startLayout,
          delta: event.clientX - resizeState.startX,
          contentWidth: wideContentWidth,
          detailsVisible: state.isDetailsPanelVisible
        })
      );
    },
    endPanelResize(): void {
      if (!resizeState) {
        return;
      }

      resizeState = null;
      recomputeDerivedState();
    },
    destroy(): void {
      unsubscribePanelLayout();
    }
  };
}
