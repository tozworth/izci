import { writable } from 'svelte/store';
import type {
  WorkspacePanelDefinition,
  WorkspacePanelProps,
  WorkspaceTabDefinition,
  WorkspaceTabMoveDetail
} from '$lib/components/workspace/types';
import {
  getWideContentWidth,
  resolveResponsiveWorkspacePanels,
  resolveResizedPanelLayout,
  resolveWidePanelWidths
} from '$lib/services/workspace-layout';
import { libraryStore, playlistStore } from '$lib/stores/playlist';
import { workspacePanelLayout } from '$lib/stores/workspace-panel-layout';
import { libraryViewSettings } from '$lib/stores/library-view-settings';
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
  WorkspaceLibraryGroupRequest,
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
import { moveDockTab } from '$lib/services/dock-layout';

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
  favoriteItems: PlaylistItem[];
  playlistSelectionIds: string[];
  librarySelectionIds: string[];
  librarySelectionAnchorId: string | null;
  favoriteSelectionIds: string[];
  favoriteSelectionAnchorId: string | null;
  favoritePlayingId: string | null;
  playingTrackId: string | null;
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  keepEmptyWorkspacePanelsOpen: boolean;
  readOnly?: boolean;
}

interface CreateWorkspaceShellControllerOptions {
  getPlaylistContextActions: (ids: string[]) => MenuActionItem[];
  getLibraryContextActions: (ids: string[]) => MenuActionItem[];
  collectionSelection?: {
    clear: (collection: WorkspaceCollection) => void;
    select: (
      collection: WorkspaceCollection,
      id: string,
      options?: { range?: boolean; toggle?: boolean }
    ) => void;
    set: (collection: WorkspaceCollection, selection: PlaylistSelection) => void;
    selectAll: (collection: WorkspaceCollection) => void;
  };
}

export interface WorkspaceShellState {
  activeCollection: WorkspaceCollection;
  activeWorkspaceTab: WorkspaceTab;
  isDetailsPanelVisible: boolean;
  isLyricsPanelVisible: boolean;
  isPatternsPanelVisible: boolean;
  isVideoPanelVisible: boolean;
  isRightPanelVisible: boolean;
  isCompactWorkspace: boolean;
  isResizing: boolean;
  collapsedWorkspacePanels: WorkspacePanelId[];
  widePanelWidths: Record<WorkspacePanelId, number>;
  visibleWorkspacePanels: WorkspacePanelId[];
  workspacePanels: WorkspacePanelDefinition[];
  workspaceTabs: WorkspaceTabDefinition[];
  playlistPanelProps: WorkspacePanelProps;
  libraryPanelProps: WorkspacePanelProps;
  playlistJumpRequest: WorkspaceJumpRequest | null;
  libraryGroupRequest: WorkspaceLibraryGroupRequest | null;
}

const allWorkspaceTabs: Record<WorkspaceTab, WorkspaceTabDefinition> = {
  playlist: { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
  library: { id: 'library', icon: 'library_music', label: 'Library' },
  details: { id: 'details', icon: 'info', label: 'Details' },
  lyrics: { id: 'lyrics', icon: 'lyrics', label: 'Lyrics' },
  patterns: { id: 'patterns', icon: 'view_timeline', label: 'Patterns' },
  video: { id: 'video', icon: 'movie', label: 'Video', closeable: false }
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
    lyrics: lastPanelByTab.lyrics,
    patterns: lastPanelByTab.patterns,
    video: lastPanelByTab.video
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
  logicalVisiblePanels: WorkspacePanelId[],
  visiblePanels: WorkspacePanelId[],
  collapsedPanels: WorkspacePanelId[]
): WorkspacePanelDefinition[] {
  const visiblePanelSet = new Set(visiblePanels);
  const logicalVisiblePanelSet = new Set(logicalVisiblePanels);
  const collapsedPanelSet = new Set(collapsedPanels);
  const mergeSourcePanelSet = new Set<WorkspacePanelId>(collapsedPanels);

  if (logicalVisiblePanelSet.has('center')) {
    mergeSourcePanelSet.add('center');
  }

  const mergedTabs = normalizeTabbedOrder(settings).filter((tab) =>
    mergeSourcePanelSet.has(getWorkspacePanelForTab(settings, tab))
  );
  const mergedActiveTab = mergedTabs.includes(settings.activeWorkspaceTab)
    ? settings.activeWorkspaceTab
    : settings.activeTabsByPanel.center && mergedTabs.includes(settings.activeTabsByPanel.center)
      ? settings.activeTabsByPanel.center
      : mergedTabs[0] ?? null;

  return WORKSPACE_PANEL_IDS.map((panelId) => {
    const isMergeHost = panelId === 'center' && collapsedPanels.length > 0;
    const tabs = isMergeHost ? mergedTabs : settings.panels[panelId];
    const activeTab = isMergeHost ? mergedActiveTab : settings.activeTabsByPanel[panelId];

    return {
      id: panelId,
      tabs: tabs.map((tab) => allWorkspaceTabs[tab]),
      activeTab,
      backdropPanelId: activeTab ? getWorkspacePanelForTab(settings, activeTab) : panelId,
      isOpen: visiblePanelSet.has(panelId),
      isResponsiveCollapsed: collapsedPanelSet.has(panelId)
    };
  });
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
  getLibraryContextActions: (ids: string[]) => MenuActionItem[]
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
  getLibraryContextActions: (ids: string[]) => MenuActionItem[]
): WorkspaceShellState {
  const savedPanelState = workspacePanelState.getSnapshot();
  const logicalVisiblePanels = getVisibleWorkspacePanels(savedPanelState, false);
  const responsivePanels = resolveResponsiveWorkspacePanels(0, logicalVisiblePanels);
  const visibleWorkspacePanels = responsivePanels.visiblePanels;

  return {
    activeCollection: savedPanelState.activeCollection,
    activeWorkspaceTab: savedPanelState.activeWorkspaceTab,
    isDetailsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'details'),
    isLyricsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'lyrics'),
    isPatternsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'patterns'),
    isVideoPanelVisible: isWorkspaceTabOpen(savedPanelState, 'video'),
    isRightPanelVisible: logicalVisiblePanels.includes('right'),
    isCompactWorkspace: responsivePanels.collapsedPanels.length > 0 && visibleWorkspacePanels.length === 1,
    isResizing: false,
    collapsedWorkspacePanels: responsivePanels.collapsedPanels,
    widePanelWidths: resolveWidePanelWidths(workspacePanelLayout.getSnapshot(), 0, {
      visiblePanels: visibleWorkspacePanels
    }),
    visibleWorkspacePanels,
    workspacePanels: buildWorkspacePanels(
      savedPanelState,
      logicalVisiblePanels,
      visibleWorkspacePanels,
      responsivePanels.collapsedPanels
    ),
    workspaceTabs: buildWorkspaceTabs(savedPanelState),
    playlistJumpRequest: null,
    libraryGroupRequest: null,
    playlistPanelProps: createPlaylistPanelProps(getPlaylistContextActions),
    libraryPanelProps: createLibraryPanelProps(getLibraryContextActions)
  };
}

export function createWorkspaceShellController({
  getPlaylistContextActions,
  getLibraryContextActions,
  collectionSelection
}: CreateWorkspaceShellControllerOptions) {
  let panelLayout = workspacePanelLayout.getSnapshot();
  let savedPanelState = workspacePanelState.getSnapshot();
  let resizeState: PanelResizeState | null = null;
  let lastInputs: WorkspaceShellInputs | null = null;
  let state = createInitialState(getPlaylistContextActions, getLibraryContextActions);
  let libraryGroupRequestToken = 0;
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

    if (collectionSelection) {
      collectionSelection.clear(collection);
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

    const viewportWidth =
      lastInputs.innerWidth > 0
        ? lastInputs.innerWidth
        : typeof window !== 'undefined'
          ? window.innerWidth
          : 0;
    const logicalVisiblePanels = getVisibleWorkspacePanels(
      savedPanelState,
      lastInputs.keepEmptyWorkspacePanelsOpen
    );
    const responsivePanels = resolveResponsiveWorkspacePanels(viewportWidth, logicalVisiblePanels);
    const visibleWorkspacePanels = responsivePanels.visiblePanels;

    if (
      resizeState &&
      (!visibleWorkspacePanels.includes(resizeState.handle.before) ||
        !visibleWorkspacePanels.includes(resizeState.handle.after))
    ) {
      resizeState = null;
    }

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
      isPatternsPanelVisible: isWorkspaceTabOpen(savedPanelState, 'patterns'),
      isVideoPanelVisible: isWorkspaceTabOpen(savedPanelState, 'video'),
      isRightPanelVisible: logicalVisiblePanels.includes('right'),
      isCompactWorkspace:
        responsivePanels.collapsedPanels.length > 0 && visibleWorkspacePanels.length === 1,
      isResizing: Boolean(resizeState),
      collapsedWorkspacePanels: responsivePanels.collapsedPanels,
      widePanelWidths,
      visibleWorkspacePanels,
      workspacePanels: buildWorkspacePanels(
        savedPanelState,
        logicalVisiblePanels,
        visibleWorkspacePanels,
        responsivePanels.collapsedPanels
      ),
      workspaceTabs: buildWorkspaceTabs(savedPanelState),
      playlistPanelProps: {
        items: lastInputs.playlistItems,
        selectedIds: lastInputs.playlistSelectionIds,
        keyboardActive: savedPanelState.activeCollection === 'playlist',
        playingId: lastInputs.playingTrackId,
        jumpToItemRequest: state.playlistJumpRequest,
        panelTitle: 'Playlist',
        regionLabel: 'Playlist',
        shuffleEnabled: lastInputs.shuffleEnabled,
        repeatMode: lastInputs.repeatMode,
        readOnly: lastInputs.readOnly,
        getContextMenuActions: getPlaylistContextActions
      },
      libraryPanelProps: {
        items: lastInputs.libraryItems,
        selectedIds: lastInputs.librarySelectionIds,
        keyboardActive: savedPanelState.activeCollection === 'library',
        selectionAnchorId: lastInputs.librarySelectionAnchorId,
        playingId: null,
        favoriteItems: lastInputs.favoriteItems,
        favoriteSelectedIds: lastInputs.favoriteSelectionIds,
        favoriteSelectionAnchorId: lastInputs.favoriteSelectionAnchorId,
        favoritePlayingId: lastInputs.favoritePlayingId,
        panelTitle: 'Library',
        regionLabel: 'Library',
        layout: 'columns',
        showShuffleControl: false,
        showRepeatControl: false,
        showSearchControl: true,
        libraryGroupRequest: state.libraryGroupRequest,
        readOnly: lastInputs.readOnly,
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
      if (collectionSelection) {
        collectionSelection.select(collection, id, options);
        return;
      }
      getCollectionStore(collection).select(id, options);
    },
    setCollectionSelection(collection: WorkspaceCollection, nextSelection: PlaylistSelection): void {
      clearOtherSelection(collection);
      updateActiveWorkspaceTab(collection);
      if (collectionSelection) {
        collectionSelection.set(collection, nextSelection);
        return;
      }
      getCollectionStore(collection).setSelection(nextSelection);
    },
    selectAllTracks(collection: WorkspaceCollection): void {
      clearOtherSelection(collection);
      updateActiveWorkspaceTab(collection);
      if (collectionSelection) {
        collectionSelection.selectAll(collection);
        return;
      }
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

      if (
        state.collapsedWorkspacePanels.length > 0 &&
        detail.sourcePanelId === 'center' &&
        detail.targetPanelId === 'center'
      ) {
        this.moveTabbedWorkspaceTab(detail);
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

      nextPanelState.panels = moveDockTab(nextPanelState.panels, WORKSPACE_PANEL_IDS, {
        tabId: detail.tabId,
        sourceZoneId: sourcePanelId,
        targetZoneId: targetPanelId,
        targetTabId: detail.targetTabId,
        position: detail.position
      });
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
    showLibraryGroup(target: Omit<WorkspaceLibraryGroupRequest, 'token'>): void {
      libraryGroupRequestToken += 1;
      state = {
        ...state,
        libraryGroupRequest: {
          ...target,
          token: libraryGroupRequestToken
        }
      };
      recomputeDerivedState();
      libraryViewSettings.setActiveView(target.view);
      this.showWorkspaceTab('library');
      recomputeDerivedState();
    },
    clearLibraryGroupRequest(token: number): void {
      if (state.libraryGroupRequest?.token !== token) return;
      state = { ...state, libraryGroupRequest: null };
      recomputeDerivedState();
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
      if (
        !state.visibleWorkspacePanels.includes(handle.before) ||
        !state.visibleWorkspacePanels.includes(handle.after)
      ) {
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
      if (!resizeState || !lastInputs) {
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
