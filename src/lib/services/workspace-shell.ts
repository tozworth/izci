import { writable } from 'svelte/store';
import type {
  WorkspacePanelDefinition,
  WorkspacePanelHandlers,
  WorkspacePanelProps,
  WorkspaceTabDefinition,
  WorkspaceTabMoveDetail
} from '$lib/components/workspace/types';
import {
  getWideContentWidth,
  resolveResizedPanelLayout,
  resolveWidePanelWidths
} from '$lib/services/workspace-layout';
import { libraryStore, playlistStore } from '$lib/stores/playlist';
import { workspacePanelLayout } from '$lib/stores/workspace-panel-layout';
import {
  getDefaultWorkspacePanelForTab,
  workspacePanelState
} from '$lib/stores/workspace-panel-state';
import type {
  MenuActionItem,
  PlaylistItem,
  PlaylistRepeatMode,
  PlaylistSelection,
  WorkspaceCollection,
  WorkspaceJumpRequest,
  WorkspacePanelActiveTabsSettings,
  WorkspacePanelId,
  WorkspacePanelLayoutSettings,
  WorkspacePanelStateSettings,
  WorkspacePanelTabsSettings,
  WorkspaceResizeHandle,
  WorkspaceTab,
  WorkspaceTabPanelMemorySettings
} from '$lib/types';
import { WORKSPACE_PANEL_IDS } from '$lib/types';
import { getOtherWorkspaceCollection } from '$lib/services/workspace-actions';

type TrackCollectionStore = typeof playlistStore;

type PanelResizeState = {
  handle: WorkspaceResizeHandle;
  startX: number;
  startLayout: WorkspacePanelLayoutSettings;
  visiblePanels: WorkspacePanelId[];
};

interface WorkspaceShellInputs {
  innerWidth: number;
  playlistItems: PlaylistItem[];
  libraryItems: PlaylistItem[];
  playlistSelectionIds: string[];
  librarySelectionIds: string[];
  librarySelectionAnchorId: string | null;
  playingTrackId: string | null;
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  keepEmptyWorkspacePanelsOpen: boolean;
}

interface CreateWorkspaceShellControllerOptions {
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[];
  getLibraryContextActions: () => MenuActionItem[];
}

export interface WorkspaceShellState {
  activeCollection: WorkspaceCollection;
  activeWorkspaceTab: WorkspaceTab;
  isDetailsPanelVisible: boolean;
  isLyricsPanelVisible: boolean;
  isRightPanelVisible: boolean;
  isTabbedLayout: boolean;
  isResizing: boolean;
  widePanelWidths: Record<WorkspacePanelId, number>;
  visibleWorkspacePanels: WorkspacePanelId[];
  workspacePanels: WorkspacePanelDefinition[];
  workspaceTabs: WorkspaceTabDefinition[];
  playlistPanelProps: WorkspacePanelProps;
  libraryPanelProps: WorkspacePanelProps;
  playlistJumpRequest: WorkspaceJumpRequest | null;
}

const allWorkspaceTabs: Record<WorkspaceTab, WorkspaceTabDefinition> = {
  playlist: { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
  library: { id: 'library', icon: 'library_music', label: 'Library' },
  details: { id: 'details', icon: 'info', label: 'Details' },
  lyrics: { id: 'lyrics', icon: 'lyrics', label: 'Lyrics' }
};

function isWorkspaceCollection(tab: WorkspaceTab): tab is WorkspaceCollection {
  return tab === 'playlist' || tab === 'library';
}

function isWorkspaceTabOpen(settings: WorkspacePanelStateSettings, tab: WorkspaceTab): boolean {
  return WORKSPACE_PANEL_IDS.some((panelId) => settings.panels[panelId].includes(tab));
}

function clonePanels(panels: WorkspacePanelTabsSettings): WorkspacePanelTabsSettings {
  return {
    left: [...panels.left],
    center: [...panels.center],
    right: [...panels.right]
  };
}

function cloneActiveTabs(
  activeTabsByPanel: WorkspacePanelActiveTabsSettings
): WorkspacePanelActiveTabsSettings {
  return {
    left: activeTabsByPanel.left,
    center: activeTabsByPanel.center,
    right: activeTabsByPanel.right
  };
}

function cloneLastPanelByTab(
  lastPanelByTab: WorkspaceTabPanelMemorySettings
): WorkspaceTabPanelMemorySettings {
  return {
    playlist: lastPanelByTab.playlist,
    library: lastPanelByTab.library,
    details: lastPanelByTab.details,
    lyrics: lastPanelByTab.lyrics
  };
}

function clonePanelState(settings: WorkspacePanelStateSettings): WorkspacePanelStateSettings {
  return {
    ...settings,
    panels: clonePanels(settings.panels),
    openPanels: [...settings.openPanels],
    activeTabsByPanel: cloneActiveTabs(settings.activeTabsByPanel),
    lastPanelByTab: cloneLastPanelByTab(settings.lastPanelByTab),
    tabbedTabOrder: [...settings.tabbedTabOrder]
  };
}

function getWorkspacePanelForTab(
  settings: WorkspacePanelStateSettings,
  tab: WorkspaceTab
): WorkspacePanelId {
  for (const panelId of WORKSPACE_PANEL_IDS) {
    if (settings.panels[panelId].includes(tab)) {
      return panelId;
    }
  }

  return settings.lastPanelByTab[tab] ?? getDefaultWorkspacePanelForTab(tab);
}

function getOpenTabs(settings: WorkspacePanelStateSettings): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [];

  for (const panelId of WORKSPACE_PANEL_IDS) {
    tabs.push(...settings.panels[panelId]);
  }

  return tabs;
}

function getFirstOpenTab(settings: WorkspacePanelStateSettings): WorkspaceTab | null {
  for (const tab of settings.tabbedTabOrder) {
    if (isWorkspaceTabOpen(settings, tab)) {
      return tab;
    }
  }

  return getOpenTabs(settings)[0] ?? null;
}

function normalizeTabbedOrder(settings: WorkspacePanelStateSettings): WorkspaceTab[] {
  const openTabs = new Set(getOpenTabs(settings));
  const order = settings.tabbedTabOrder.filter((tab) => openTabs.has(tab));

  for (const tab of getOpenTabs(settings)) {
    if (!order.includes(tab)) {
      order.push(tab);
    }
  }

  return order;
}

function normalizePanelActivity(
  settings: WorkspacePanelStateSettings,
  preferredActiveTab?: WorkspaceTab
): WorkspacePanelStateSettings {
  const activeTabsByPanel = cloneActiveTabs(settings.activeTabsByPanel);

  for (const panelId of WORKSPACE_PANEL_IDS) {
    const activeTab = activeTabsByPanel[panelId];
    activeTabsByPanel[panelId] =
      activeTab && settings.panels[panelId].includes(activeTab)
        ? activeTab
        : settings.panels[panelId][0] ?? null;
  }

  const tabbedTabOrder = normalizeTabbedOrder({
    ...settings,
    activeTabsByPanel
  });
  const requestedActiveTab = preferredActiveTab ?? settings.activeWorkspaceTab;
  const activeWorkspaceTab = isWorkspaceTabOpen(settings, requestedActiveTab)
    ? requestedActiveTab
    : getFirstOpenTab({ ...settings, activeTabsByPanel, tabbedTabOrder }) ??
      requestedActiveTab;
  const activeCollection = isWorkspaceCollection(activeWorkspaceTab)
    ? activeWorkspaceTab
    : settings.activeCollection;

  return {
    ...settings,
    activeWorkspaceTab,
    activeCollection,
    activeTabsByPanel,
    tabbedTabOrder
  };
}

function ensurePanelOpen(
  settings: WorkspacePanelStateSettings,
  panelId: WorkspacePanelId
): void {
  if (!settings.openPanels.includes(panelId)) {
    settings.openPanels.push(panelId);
  }

  settings.openPanels = WORKSPACE_PANEL_IDS.filter((id) => settings.openPanels.includes(id));
}

function collapseEmptyPanels(
  settings: WorkspacePanelStateSettings,
  keepEmptyWorkspacePanelsOpen: boolean
): void {
  if (keepEmptyWorkspacePanelsOpen) {
    settings.openPanels = WORKSPACE_PANEL_IDS.filter((panelId) =>
      settings.openPanels.includes(panelId) || settings.panels[panelId].length > 0
    );
    return;
  }

  settings.openPanels = WORKSPACE_PANEL_IDS.filter(
    (panelId) => settings.panels[panelId].length > 0
  );
}

function getVisibleWorkspacePanels(
  settings: WorkspacePanelStateSettings,
  keepEmptyWorkspacePanelsOpen: boolean
): WorkspacePanelId[] {
  if (keepEmptyWorkspacePanelsOpen) {
    const openPanels = new Set(settings.openPanels);

    return WORKSPACE_PANEL_IDS.filter(
      (panelId) => openPanels.has(panelId) || settings.panels[panelId].length > 0
    );
  }

  return WORKSPACE_PANEL_IDS.filter((panelId) => settings.panels[panelId].length > 0);
}

function buildWorkspacePanels(
  settings: WorkspacePanelStateSettings,
  visiblePanels: WorkspacePanelId[]
): WorkspacePanelDefinition[] {
  const visiblePanelSet = new Set(visiblePanels);

  return WORKSPACE_PANEL_IDS.map((panelId) => ({
    id: panelId,
    tabs: settings.panels[panelId].map((tab) => allWorkspaceTabs[tab]),
    activeTab: settings.activeTabsByPanel[panelId],
    isOpen: visiblePanelSet.has(panelId)
  }));
}

function buildWorkspaceTabs(settings: WorkspacePanelStateSettings): WorkspaceTabDefinition[] {
  return settings.tabbedTabOrder
    .filter((tab) => isWorkspaceTabOpen(settings, tab))
    .map((tab) => allWorkspaceTabs[tab]);
}

function createPlaylistPanelProps(
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[]
): WorkspacePanelProps {
  return {
    items: [],
    selectedIds: [],
    playingId: null,
    jumpToItemRequest: null,
    panelTitle: 'Playlist',
    regionLabel: 'Playlist',
    shuffleEnabled: false,
    repeatMode: 'off',
    getContextMenuActions: getPlaylistContextActions
  };
}

function createLibraryPanelProps(
  getLibraryContextActions: () => MenuActionItem[]
): WorkspacePanelProps {
  return {
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
  };
}

function createInitialState(
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[],
  getLibraryContextActions: () => MenuActionItem[]
): WorkspaceShellState {
  const savedPanelState = workspacePanelState.getSnapshot();
  const visibleWorkspacePanels = getVisibleWorkspacePanels(savedPanelState, false);

  return {
    activeCollection: savedPanelState.activeCollection,
    activeWorkspaceTab: savedPanelState.activeWorkspaceTab,
    isDetailsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'details'),
    isLyricsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'lyrics'),
    isRightPanelVisible: visibleWorkspacePanels.includes('right'),
    isTabbedLayout: false,
    isResizing: false,
    widePanelWidths: resolveWidePanelWidths(workspacePanelLayout.getSnapshot(), 0, {
      visiblePanels: visibleWorkspacePanels
    }),
    visibleWorkspacePanels,
    workspacePanels: buildWorkspacePanels(savedPanelState, visibleWorkspacePanels),
    workspaceTabs: buildWorkspaceTabs(savedPanelState),
    playlistJumpRequest: null,
    playlistPanelProps: createPlaylistPanelProps(getPlaylistContextActions),
    libraryPanelProps: createLibraryPanelProps(getLibraryContextActions)
  };
}

export function createWorkspaceShellController({
  getPlaylistContextActions,
  getLibraryContextActions
}: CreateWorkspaceShellControllerOptions) {
  let panelLayout = workspacePanelLayout.getSnapshot();
  let savedPanelState = workspacePanelState.getSnapshot();
  let resizeState: PanelResizeState | null = null;
  let lastInputs: WorkspaceShellInputs | null = null;
  let state = createInitialState(getPlaylistContextActions, getLibraryContextActions);
  const store = writable(state);

  function publishState(): void {
    store.set(state);
  }

  function isSameSavedPanelState(
    a: WorkspacePanelStateSettings,
    b: WorkspacePanelStateSettings
  ): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function persistPanelState(nextPanelState: WorkspacePanelStateSettings): void {
    const normalizedPanelState = normalizePanelActivity(nextPanelState);

    if (isSameSavedPanelState(savedPanelState, normalizedPanelState)) {
      return;
    }

    savedPanelState = workspacePanelState.set(normalizedPanelState);
    recomputeDerivedState();
  }

  function applySavedPanelState(nextPanelState: WorkspacePanelStateSettings): void {
    savedPanelState = nextPanelState;
    recomputeDerivedState();
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

  function updateActiveWorkspaceTab(tab: WorkspaceTab): void {
    const nextPanelState = clonePanelState(savedPanelState);
    const panelId = getWorkspacePanelForTab(nextPanelState, tab);

    if (!isWorkspaceTabOpen(nextPanelState, tab)) {
      nextPanelState.panels[panelId].push(tab);
      nextPanelState.lastPanelByTab[tab] = panelId;
      ensurePanelOpen(nextPanelState, panelId);
    }

    nextPanelState.activeTabsByPanel[panelId] = tab;
    persistPanelState(normalizePanelActivity(nextPanelState, tab));
  }

  function recomputeDerivedState(): void {
    if (!lastInputs) {
      return;
    }

    if (lastInputs.playlistSelectionIds.length > 0 && lastInputs.librarySelectionIds.length > 0) {
      clearSelection(getOtherWorkspaceCollection(state.activeCollection));
    }

    const isTabbedLayout = lastInputs.innerWidth <= 660;
    const viewportWidth =
      lastInputs.innerWidth > 0
        ? lastInputs.innerWidth
        : typeof window !== 'undefined'
          ? window.innerWidth
          : 0;
    const visibleWorkspacePanels = getVisibleWorkspacePanels(
      savedPanelState,
      lastInputs.keepEmptyWorkspacePanelsOpen
    );
    const wideContentWidth = getWideContentWidth(viewportWidth, {
      visiblePanels: visibleWorkspacePanels
    });
    const widePanelWidths = resolveWidePanelWidths(panelLayout, wideContentWidth, {
      visiblePanels: visibleWorkspacePanels
    });

    state = {
      ...state,
      activeCollection: savedPanelState.activeCollection,
      activeWorkspaceTab: savedPanelState.activeWorkspaceTab,
      isDetailsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'details'),
      isLyricsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'lyrics'),
      isRightPanelVisible: visibleWorkspacePanels.includes('right'),
      isTabbedLayout,
      isResizing: Boolean(resizeState),
      widePanelWidths,
      visibleWorkspacePanels,
      workspacePanels: buildWorkspacePanels(savedPanelState, visibleWorkspacePanels),
      workspaceTabs: buildWorkspaceTabs(savedPanelState),
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
  const unsubscribePanelState = workspacePanelState.subscribe((value) => {
    if (isSameSavedPanelState(value, savedPanelState)) {
      savedPanelState = value;
      return;
    }

    applySavedPanelState(value);
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
      updateActiveWorkspaceTab(collection);
      getCollectionStore(collection).select(id, options);
    },
    setCollectionSelection(collection: WorkspaceCollection, nextSelection: PlaylistSelection): void {
      clearOtherSelection(collection);
      updateActiveWorkspaceTab(collection);
      getCollectionStore(collection).setSelection(nextSelection);
    },
    selectAllTracks(collection: WorkspaceCollection): void {
      clearOtherSelection(collection);
      updateActiveWorkspaceTab(collection);
      getCollectionStore(collection).selectAll();
    },
    focusCollection(collection: WorkspaceCollection): void {
      if (state.activeCollection === collection && state.activeWorkspaceTab === collection) {
        return;
      }

      updateActiveWorkspaceTab(collection);
    },
    setActiveWorkspaceTab(tab: WorkspaceTab): void {
      updateActiveWorkspaceTab(tab);
    },
    showWorkspaceTab(tab: WorkspaceTab, targetPanelId?: WorkspacePanelId): void {
      const nextPanelState = clonePanelState(savedPanelState);
      const panelId =
        targetPanelId ??
        nextPanelState.lastPanelByTab[tab] ??
        getDefaultWorkspacePanelForTab(tab);

      if (!nextPanelState.panels[panelId].includes(tab)) {
        for (const existingPanelId of WORKSPACE_PANEL_IDS) {
          nextPanelState.panels[existingPanelId] = nextPanelState.panels[existingPanelId].filter(
            (panelTab) => panelTab !== tab
          );
        }

        nextPanelState.panels[panelId].push(tab);
      }

      nextPanelState.lastPanelByTab[tab] = panelId;
      nextPanelState.activeTabsByPanel[panelId] = tab;
      ensurePanelOpen(nextPanelState, panelId);

      if (!nextPanelState.tabbedTabOrder.includes(tab)) {
        nextPanelState.tabbedTabOrder.push(tab);
      }

      persistPanelState(normalizePanelActivity(nextPanelState, tab));
    },
    closeWorkspaceTab(tab: WorkspaceTab): void {
      if (!isWorkspaceTabOpen(savedPanelState, tab)) {
        return;
      }

      const nextPanelState = clonePanelState(savedPanelState);
      const panelId = getWorkspacePanelForTab(nextPanelState, tab);
      const tabIndex = nextPanelState.panels[panelId].indexOf(tab);

      nextPanelState.panels[panelId] = nextPanelState.panels[panelId].filter(
        (panelTab) => panelTab !== tab
      );
      nextPanelState.tabbedTabOrder = nextPanelState.tabbedTabOrder.filter(
        (panelTab) => panelTab !== tab
      );
      nextPanelState.lastPanelByTab[tab] = panelId;
      nextPanelState.activeTabsByPanel[panelId] =
        nextPanelState.panels[panelId][Math.min(tabIndex, nextPanelState.panels[panelId].length - 1)] ??
        null;

      collapseEmptyPanels(
        nextPanelState,
        lastInputs?.keepEmptyWorkspacePanelsOpen === true
      );

      persistPanelState(normalizePanelActivity(nextPanelState));
    },
    moveWorkspaceTab(detail: WorkspaceTabMoveDetail): void {
      if (!isWorkspaceTabOpen(savedPanelState, detail.tabId) || !detail.targetPanelId) {
        return;
      }

      const nextPanelState = clonePanelState(savedPanelState);
      const sourcePanelId = getWorkspacePanelForTab(nextPanelState, detail.tabId);
      const targetPanelId = detail.targetPanelId;

      if (
        sourcePanelId === targetPanelId &&
        detail.targetTabId === detail.tabId &&
        detail.position !== 'end'
      ) {
        return;
      }

      nextPanelState.panels[sourcePanelId] = nextPanelState.panels[sourcePanelId].filter(
        (tab) => tab !== detail.tabId
      );
      const targetTabs = nextPanelState.panels[targetPanelId].filter(
        (tab) => tab !== detail.tabId
      );
      let insertIndex = targetTabs.length;

      if (detail.targetTabId && detail.targetTabId !== detail.tabId) {
        const targetIndex = targetTabs.indexOf(detail.targetTabId);

        if (targetIndex >= 0) {
          insertIndex = detail.position === 'before' ? targetIndex : targetIndex + 1;
        }
      }

      targetTabs.splice(insertIndex, 0, detail.tabId);
      nextPanelState.panels[targetPanelId] = targetTabs;
      nextPanelState.activeTabsByPanel[targetPanelId] = detail.tabId;
      nextPanelState.lastPanelByTab[detail.tabId] = targetPanelId;
      ensurePanelOpen(nextPanelState, targetPanelId);
      collapseEmptyPanels(
        nextPanelState,
        lastInputs?.keepEmptyWorkspacePanelsOpen === true
      );

      persistPanelState(normalizePanelActivity(nextPanelState, detail.tabId));
    },
    moveTabbedWorkspaceTab(detail: WorkspaceTabMoveDetail): void {
      if (!isWorkspaceTabOpen(savedPanelState, detail.tabId)) {
        return;
      }

      const nextPanelState = clonePanelState(savedPanelState);
      const order = normalizeTabbedOrder(nextPanelState).filter((tab) => tab !== detail.tabId);
      let insertIndex = order.length;

      if (detail.targetTabId && detail.targetTabId !== detail.tabId) {
        const targetIndex = order.indexOf(detail.targetTabId);

        if (targetIndex >= 0) {
          insertIndex = detail.position === 'before' ? targetIndex : targetIndex + 1;
        }
      }

      order.splice(insertIndex, 0, detail.tabId);
      nextPanelState.tabbedTabOrder = order;
      persistPanelState(normalizePanelActivity(nextPanelState, detail.tabId));
    },
    showPlaylistTrack(id: string): void {
      this.showWorkspaceTab('playlist');
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
      this.showWorkspaceTab('details');
    },
    closeTrackDetails(): void {
      this.closeWorkspaceTab('details');
    },
    showTrackLyrics(): void {
      this.showWorkspaceTab('lyrics');
    },
    closeTrackLyrics(): void {
      this.closeWorkspaceTab('lyrics');
    },
    beginPanelResize(event: PointerEvent, handle: WorkspaceResizeHandle): void {
      if (state.isTabbedLayout) {
        return;
      }

      event.preventDefault();
      resizeState = {
        handle,
        startX: event.clientX,
        startLayout: panelLayout,
        visiblePanels: [...state.visibleWorkspacePanels]
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
        visiblePanels: resizeState.visiblePanels
      });

      workspacePanelLayout.set(
        resolveResizedPanelLayout({
          handle: resizeState.handle,
          startLayout: resizeState.startLayout,
          delta: event.clientX - resizeState.startX,
          contentWidth: wideContentWidth,
          visiblePanels: resizeState.visiblePanels
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
      unsubscribePanelState();
    }
  };
}
