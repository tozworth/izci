/**
 * Main-window runtime factory for the composition root.
 *
 * Owns the controller fabrication wave, the store/subscription wiring, and the
 * forwarded action bundle that `App.svelte` used to spell out inline. Pure
 * move from `App.svelte` — no behavior changes. The component passes the
 * component-owned reactive lets and local-state callbacks it needs, and
 * receives back every controller handle, a `subscribe` callback surface
 * mirroring pushed controller/ui state into its reactive lets, and `dispose()`
 * that tears down everything.
 *
 * The state shape + publish/subscribe bookkeeping live in
 * `main-window-runtime-state.ts`; the multiplayer/freeplay, video/theater, and
 * transport controller clusters live in `main-window-runtime-*.ts` bundle
 * factories. This module remains the composition root that wires them in
 * dependency order and collects the teardowns.
 */

import { writable, get } from 'svelte/store';
import { t } from 'svelte-i18n';
import { translate } from '$lib/i18n';
import {
  createAppShortcuts,
  cycleWorkspaceTab as cycleWorkspaceTabs,
  closeActiveRightPanel as closeActiveRightPanelFor
} from '$lib/services/app-shortcuts';
import { createArtworkPresentationController } from '$lib/services/artwork-presentation';
import {
  getTrackArtworkLoadKey,
  loadTrackArtwork,
  type LoadedStreamArtwork
} from '$lib/services/stream-artwork';
import { createImportController } from '$lib/services/import-controller';
import { createContextualTabPresentationController } from '$lib/services/contextual-tab-presentation';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import { startLibraryFolderCommandListener } from '$lib/services/library-folder-coordination';
import { scanLaunchLibraryFolders } from '$lib/services/library-folder-scanner';
import { appInstallService, type AppInstallState } from '$lib/services/app-install';
import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
import { createLyricsPresentationController } from '$lib/services/lyrics-presentation';
import { startLoadoutRuntime } from '$lib/services/loadouts';
import { createPlaybackCommandsController } from '$lib/services/playback-commands';
import { createMiniPlayerController, type MiniPlayerState } from '$lib/services/mini-player';
import {
  createPlaybackProgressController,
  type PlaybackProgressState
} from '$lib/services/playback-progress';
import { createPlaybackRestorationController } from '$lib/services/playback-restoration';
import { setSleepTimerFiredHandler } from '$lib/services/sleep-timer';
import { abLoop, resolveAbLoopRange } from '$lib/services/ab-loop';
import { forceServiceWorkerUpdateCheck } from '$lib/services/pwa-updates';
import { createWorkspaceShellController } from '$lib/services/workspace-shell';
import { mediaSessionService } from '$lib/services/media-session';
import { createPlayCountTracker } from '$lib/services/play-count';
import { playerController } from '$lib/services/player-controller';
import {
  createWorkspaceCollectionsController,
  syncPlayingTrackMetadata
} from '$lib/services/workspace-collections';
import { windowManager } from '$lib/services/window-manager';
import { favoritesStore, libraryStore, queueStore } from '$lib/stores/queue';
import { libraryViewSettings } from '$lib/stores/library-view-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { trackSettings } from '$lib/stores/track-settings';
import type {
  PlaybackSnapshot,
  TrackItem,
  TrackSelection,
  VideoFitMode,
  WorkspaceCollection,
  WorkspaceTab
} from '$lib/types';
import type {
  VideoSeekFeedback
} from '$lib/components/workspace/types';
import { upNext } from '$lib/stores/up-next';
import { type OptionsViewName } from '../../options/views';
import {
  buildFreeplayLibraryContextActions,
  buildFreeplayQueueContextActions
} from '$lib/services/workspace-actions';
import { createMultiplayerSession } from '$lib/services/multiplayer-session';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';
import {
  getRemoteArtworkLoadKey,
  toLoadedMultiplayerArtwork
} from '$lib/services/multiplayer-artwork';
import { createMultiplayerWindowController } from '$lib/services/multiplayer-window-controller';
import { createFreeplayUiActions } from '$lib/services/freeplay-ui-actions';
import {
  createWindowSelectionController,
  type RemoteSelectionSnapshot
} from '$lib/services/main-window-selection';
import { createMainWindowPanelHandlers } from '$lib/services/main-window-handlers';
import { createVideoWindowActions } from '$lib/services/video-window-actions';
import { createTroubadourMainWindowBridge } from '$lib/services/troubadour-main-window';
import {
  createTransportActions,
  localizePlaybackError as localizePlaybackErrorMessage
} from '$lib/services/transport-actions';
import { createRenderBufferedPollController } from '$lib/services/multiplayer-render-buffered-poll';
import { createMainWindowView } from '$lib/services/main-window-view';
import { resolveTrackSnapshot } from '$lib/services/artwork-presentation';
import {
  createMainWindowRuntimeState,
  type MainWindowRuntimeState,
  type MainWindowRuntimeStores,
  type MainWindowRuntimeSubscription
} from '$lib/services/main-window-runtime-state';
import {
  createMainWindowRuntimeMultiplayerBundle,
  type MainWindowRuntimeMultiplayerBundle,
  type MainWindowRuntimeMultiplayerDeps
} from '$lib/services/main-window-runtime-multiplayer';
import {
  createMainWindowRuntimeVideoBundle,
  type MainWindowRuntimeVideoBundle,
  type MainWindowRuntimeVideoDeps
} from '$lib/services/main-window-runtime-video';
import {
  createMainWindowRuntimeTransportBundle,
  type MainWindowRuntimeTransportBundle,
  type MainWindowRuntimeTransportDeps
} from '$lib/services/main-window-runtime-transport';

export type {
  MainWindowRuntimeState,
  MainWindowRuntimeStores,
  MainWindowRuntimeSubscription
} from '$lib/services/main-window-runtime-state';
export type {
  MainWindowRuntimeMultiplayerBundle,
  MainWindowRuntimeMultiplayerDeps
} from '$lib/services/main-window-runtime-multiplayer';
export type {
  MainWindowRuntimeVideoBundle,
  MainWindowRuntimeVideoDeps
} from '$lib/services/main-window-runtime-video';
export type {
  MainWindowRuntimeTransportBundle,
  MainWindowRuntimeTransportDeps
} from '$lib/services/main-window-runtime-transport';

/** Handles owned by the composition root and surfaced to the component. */
export interface MainWindowRuntimeHandles {
  fileInput(): HTMLInputElement | null;
  videoParkingHost(): HTMLDivElement | null;
  topMenuBarHeight(): number;
  innerWidth(): number;
  innerHeight(): number;
  bindFileInput(element: HTMLInputElement | null): void;
  bindVideoParkingHost(element: HTMLDivElement | null): void;
  bindTopMenuBarHeight(height: number): void;
  bindInnerWidth(width: number): void;
  bindInnerHeight(height: number): void;
  actions: MainWindowRuntimeActions;
  appShortcuts: {
    handleContextMenu(event: MouseEvent): void;
    handleKeydown(event: KeyboardEvent): void;
  };
  workspaceShell: ReturnType<typeof createWorkspaceShellController>;
  workspaceCollections: ReturnType<typeof createWorkspaceCollectionsController>;
  windowSelection: ReturnType<typeof createWindowSelectionController>;
  multiplayerController: ReturnType<typeof createMultiplayerWindowController>;
  multiplayerSession: MultiplayerSessionController;
  freeplayActions: ReturnType<typeof createFreeplayUiActions>;
  transport: ReturnType<typeof createTransportActions>;
  miniPlayer: ReturnType<typeof createMiniPlayerController>;
  playbackProgress: ReturnType<typeof createPlaybackProgressController>;
  playbackCommands: ReturnType<typeof createPlaybackCommandsController>;
  playbackRestoration: ReturnType<typeof createPlaybackRestorationController>;
  artworkPresentation: ReturnType<typeof createArtworkPresentationController>;
  lyricsPresentation: ReturnType<typeof createLyricsPresentationController>;
  patternTabPresentation: ReturnType<typeof createContextualTabPresentationController>;
  videoActions: ReturnType<typeof createVideoWindowActions>;
  importController: ReturnType<typeof createImportController>;
  troubadourBridge: ReturnType<typeof createTroubadourMainWindowBridge>;
  playCountTracker: ReturnType<typeof createPlayCountTracker>;
  renderBufferedPoll: ReturnType<typeof createRenderBufferedPollController>;
  appInstallService: typeof appInstallService;
  windowManager: typeof windowManager;
  panelHandlers: ReturnType<typeof createMainWindowPanelHandlers>;
}

export interface MainWindowRuntime {
  handles: MainWindowRuntimeHandles;
  stores: MainWindowRuntimeStores;
  subscribe(listener: (updates: Partial<MainWindowRuntimeState>) => void): () => void;
  getSnapshot(): MainWindowRuntimeState;
  dispose(): void;
}

/** Forwarded action bundle shared by markup, controllers, and shortcuts. */
export interface MainWindowRuntimeActions {
  togglePlayback(): void;
  play(): void;
  pause(): void;
  stop(): void;
  stepTrack(direction: -1 | 1): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  toggleQueueShuffle(): void;
  cycleQueueRepeat(): void;
  startOver(): void;
  localizePlaybackError(message: string): string;
  handleMenuOpenFiles(target?: WorkspaceCollection): Promise<void>;
  handleMenuOpenFolder(target?: WorkspaceCollection): Promise<void>;
  handleMenuInput(event: Event): void;
  syncVideoWindowSize(active: boolean, autoResizeWindow: boolean): void;
  syncVideoPresentation(track: TrackItem | null, autoEnterTheater: boolean): void;
  toggleVideoTheater(): void;
  setVideoFit(fitMode: VideoFitMode): void;
  toggleVideoPictureInPicture(): Promise<void>;
  toggleVideoFullscreen(): Promise<void>;
  toggleFullscreenPresentation(): void | Promise<void>;
  toggleNowPlayingView(): void;
  closeNowPlayingView(): void;
  handleAppKeydown(event: KeyboardEvent): void;
  handleOpenOptions(view?: OptionsViewName): void;
  handleOpenAbout(): void;
  handleOpenOptionsMobile(view?: OptionsViewName): void;
  navigateTrackDetailsToLibrary(
    target: import('$lib/services/library-navigation').TrackLibraryNavigationTarget
  ): void;
  handlePopupWindowMessage(event: MessageEvent): void;
  handleForceUpdate(): Promise<void>;
  handleMultiplayerHost(): Promise<void>;
  startLaunchMultiplayer(): Promise<void>;
  handleMultiplayerJoin(): Promise<void>;
  joinMultiplayer(inviteCode: string): Promise<void>;
  joinPairedMultiplayer(hostId: string): Promise<void>;
  copyMultiplayerInvite(): Promise<void>;
  dismissMultiplayerConnectionDialog(): void;
  dismissMultiplayerToast(): void;
  addToFreeplayQueue(ids: string[]): void;
  removeFromFreeplayQueue(ids: string[]): void;
  handleFreeplayQueueContextAction(actionId: string, ids: string[]): void;
  handleFreeplayLibraryContextAction(actionId: string, ids: string[]): void;
  handleNowPlayingTabChange(tab: WorkspaceTab): void;
  closeActiveRightPanel(): void;
  cycleWorkspaceTab(direction: -1 | 1): boolean;
  showQueue(): void;
  showLibrary(): void;
  showTrackDetails(): void;
  showTrackLyrics(): void;
  togglePatterns(): void;
  handleShowQueueTrack(id: string): void;
  handleShowPlayerTrackDetails(id: string): void;
}

export interface MainWindowRuntimeDeps {
  mobileMode: boolean;
  getRemoteSelections(): RemoteSelectionSnapshot;
  setRemoteSelections(selections: RemoteSelectionSnapshot): void;
  setVideoSeekFeedback(feedback: VideoSeekFeedback | null): void;
  setTheaterActive(active: boolean): void;
  setTheaterControlsHidden(hidden: boolean): void;
  setAutoNowPlayingSuppressed(value: boolean): void;
  getSelectedItem(): TrackItem | null;
  openOptionsMobile(view?: OptionsViewName): void;
  openOptionsWindow(view?: OptionsViewName): void;
  handleMenuOpenFiles(target?: WorkspaceCollection): Promise<void>;
  handleMenuOpenFolder(target?: WorkspaceCollection): Promise<void>;
  handleMenuInput(event: Event): void;
  activateLibraryPanelTrack(id: string): Promise<void>;
  handleFreeplayQueueContextAction(actionId: string, ids: string[]): void;
  handleFreeplayLibraryContextAction(actionId: string, ids: string[]): void;
  handleSelect(
    collection: WorkspaceCollection,
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ): void;
  handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<TrackSelection>): void;
}

export function createMainWindowRuntime(deps: MainWindowRuntimeDeps): MainWindowRuntime {
  const {
    items: queueItemsStore,
    selectedIds: queueSelectedIdsStore,
    selectedTrack: queueSelectedTrackStore,
    shuffleEnabled: shuffleStore,
    repeatMode: repeatStore
  } = queueStore;
  const {
    items: libraryItemsStore,
    selection: librarySelectionStore,
    selectedIds: librarySelectedIdsStore,
    selectedTrack: librarySelectedTrackStore
  } = libraryStore;
  const {
    items: favoriteItemsStore,
    selection: favoriteSelectionStore,
    selectedIds: favoriteSelectedIdsStore,
    selectedTrack: favoriteSelectedTrackStore
  } = favoritesStore;
  const stopLibraryFolderCommands = startLibraryFolderCommandListener();
  const stopLoadoutRuntime = startLoadoutRuntime(playerController.currentTrack);

  const actions: MainWindowRuntimeActions = {} as MainWindowRuntimeActions;
  setSleepTimerFiredHandler(() => actions.pause());

  const { state, publish, subscription } = createMainWindowRuntimeState();
  const { subscribe, getSnapshot } = subscription;

  const view = createMainWindowView();
  const viewSet = view.set;

  // ── Controller fabrication (dependency order) ──────────────────────────

  const windowSelection = createWindowSelectionController({
    getIsMultiplayerClient: () => state.isMultiplayerClient,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    getRemoteSelections: deps.getRemoteSelections,
    setRemoteSelections: deps.setRemoteSelections,
    getActiveView: () => libraryViewSettings.getSnapshot().activeView,
    focusCollection: (collection) => workspaceShell.focusCollection(collection),
    selectTrack: (collection, id, options) => workspaceShell.selectTrack(collection, id, options),
    setCollectionSelection: (collection, selection) =>
      workspaceShell.setCollectionSelection(collection, selection)
  });
  const workspaceShell = createWorkspaceShellController({
    getQueueContextActions: (ids) => state.isFreeplayClient
      ? buildFreeplayQueueContextActions(state.queueItems, state.libraryItems, ids)
      : workspaceCollections.getQueueContextActions(ids),
    getLibraryContextActions: (ids) => state.isFreeplayClient
      ? buildFreeplayLibraryContextActions(
          libraryViewSettings.getSnapshot().activeView === 'favorites'
            ? state.favoriteItems
            : state.libraryItems,
          state.libraryItems,
          ids
        )
      : libraryViewSettings.getSnapshot().activeView === 'favorites'
        ? workspaceCollections.getFavoriteContextActions(ids)
        : workspaceCollections.getLibraryContextActions(ids),
    collectionSelection: {
      clear: (collection) => windowSelection.clear(collection),
      select: (collection, id, options) => windowSelection.select(collection, id, options),
      set: (collection, selection) => windowSelection.set(collection, selection),
      selectAll: (collection) => windowSelection.selectAll(collection)
    }
  });
  publish({ workspaceShellState: workspaceShell.getSnapshot() });
  const workspaceCollections = createWorkspaceCollectionsController({
    getState: () => ({
      queueItems: state.queueItems,
      libraryItems: state.libraryItems,
      favoriteItems: state.favoriteItems,
      queueSelectionIds: state.queueSelectionIds,
      librarySelectionIds: state.librarySelectionIds,
      favoriteSelectionIds: state.favoriteSelectionIds,
      playingTrack: state.playingTrack
    }),
    handlers: {
      focusCollection: (collection) => workspaceShell.focusCollection(collection),
      selectTrack: (collection, id) => workspaceShell.selectTrack(collection, id),
      showTrackDetails: () => workspaceShell.showTrackDetails(),
      showTrackLyrics: () => workspaceShell.showTrackLyrics(),
      showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
      playQueue: () => actions.togglePlayback()
    }
  });
  const lyricsPresentation = createLyricsPresentationController({
    getWorkspaceState: () => state.workspaceShellState,
    showTrackLyrics: () => workspaceShell.showTrackLyrics(),
    closeTrackLyrics: () => workspaceShell.closeTrackLyrics(),
    setActiveWorkspaceTab: (tab) => workspaceShell.setActiveWorkspaceTab(tab)
  });
  const patternTabPresentation = createContextualTabPresentationController({
    isVisible: () => state.workspaceShellState.isPatternsPanelVisible,
    show: () => workspaceShell.showWorkspaceTab('patterns'),
    close: () => workspaceShell.closeWorkspaceTab('patterns')
  });
  const playbackProgress = createPlaybackProgressController({
    track: playerController.currentTrack,
    snapshot: playerController.snapshot
  });
  const playbackCommands = createPlaybackCommandsController({
    getPlayingTrack: () => state.playingTrack,
    getSelectedQueueTrack: () => state.selectedTrackItem,
    getPlaybackState: () => state.playbackStatus.state,
    getPlaybackCurrentTime: () => state.playbackSnapshot.currentTime,
    getPlaybackDuration: () => state.playbackSnapshot.duration,
    shouldRestartCurrentTrackOnPrevious: () => playbackSettings.getSnapshot().restartCurrentTrackOnPrevious,
    getTransitionMode: () => playbackSettings.getSnapshot().transitionMode,
    getGaplessPlaybackEnabled: () => playbackSettings.getSnapshot().gaplessPlayback,
    getFadeDurationSeconds: () => playbackSettings.getSnapshot().fadeDurationSeconds,
    getManualTrackChangeFadePercent: () => playbackSettings.getSnapshot().manualTrackChangeFadePercent,
    getShuffleEnabled: () => state.shuffleEnabled,
    getRepeatMode: () => state.repeatMode,
    getTrackById: (collection, id) =>
      (collection === 'library' ? state.libraryItems : state.queueItems).find(
        (item) => item.id === id
      ) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems: workspaceCollections.cleanupRemovedItems,
    resolveResumePosition: (track) => playbackProgress.resolveResumePosition(track),
    notifyTrackResumed: (track, currentTime) =>
      playbackProgress.showResumeNotice(track, currentTime),
    getStopAfterCurrentTrack: () => playbackSettings.getSnapshot().stopAfterTrack,
    clearStopAfterCurrentTrack: () => playbackSettings.update({ stopAfterTrack: false }),
    getActiveLoopRange: () => resolveAbLoopRange(abLoop.getSnapshot())
  });

  const multiplayerBundle: MainWindowRuntimeMultiplayerBundle =
    createMainWindowRuntimeMultiplayerBundle({
      getState: () => state,
      publish,
      getPlaybackCommands: () => playbackCommands,
      getSeek: () => (seconds) => actions.seek(seconds),
      getToggleQueueShuffle: () => () => actions.toggleQueueShuffle(),
      getCycleQueueRepeat: () => () => actions.cycleQueueRepeat(),
      getSetActiveWorkspaceTab: () => (tab) => workspaceShell.setActiveWorkspaceTab(tab),
      getSetFreeplayQueue: (ids) => multiplayerSession.setFreeplayQueue(ids),
      getSendCommand: (command) => multiplayerSession.sendCommand(command),
      getActivateTrack: () => (collection, id) =>
        multiplayerController.activateTrack(collection, id),
      getRemoteSelections: deps.getRemoteSelections,
      setRemoteSelections: deps.setRemoteSelections,
      getShowLibraryGroup: () => (target) => workspaceShell.showLibraryGroup(target),
      getShowTrackDetails: () => () => workspaceShell.showTrackDetails(),
      getActiveView: () => libraryViewSettings.getSnapshot().activeView
    });
  const { multiplayerController, multiplayerSession, freeplayActions } = multiplayerBundle;

  const videoBundle: MainWindowRuntimeVideoBundle = createMainWindowRuntimeVideoBundle({
    getState: () => state,
    publish,
    mobileMode: deps.mobileMode,
    showVideoTab: () => workspaceShell.showWorkspaceTab('video'),
    closeVideoTab: () => workspaceShell.closeWorkspaceTab('video')
  });
  const { videoActions } = videoBundle;

  const transportBundle: MainWindowRuntimeTransportBundle =
    createMainWindowRuntimeTransportBundle({
      getState: () => state,
      getPlaybackCommands: () => playbackCommands,
      getMultiplayerSession: () => multiplayerSession,
      setVideoSeekFeedback: deps.setVideoSeekFeedback,
      resumeLyricsAutoScroll: () => lyricsPresentation.resumeAutoScroll(),
      getPlaybackProgress: () => playbackProgress,
      getResumeNotice: () => state.playbackProgressState.notice
    });
  const { transport } = transportBundle;

  const troubadourBridge = createTroubadourMainWindowBridge({
    getPlayingTrack: () => state.playingTrack,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    getQueueSelectionIds: () => state.queueSelectionIds,
    getLibrarySelectionIds: () => state.librarySelectionIds,
    getFavoriteSelectionIds: () => state.favoriteSelectionIds,
    getPlaybackStatus: () => state.playbackStatus,
    getPlaybackSnapshot: () => state.playbackSnapshot,
    loadTrack: (track, options) => playerController.load(track, options),
    refreshCurrentTrack: (id, patch) => playerController.refreshCurrentTrack(id, patch),
    getTroubadourWindow: () => windowManager.getPopup('troubadour'),
    showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
    openOptions: (view) => deps.openOptionsWindow(view)
  });
  const renderBufferedPoll = createRenderBufferedPollController((ranges, buffering) => {
    publish({ renderBufferedRanges: ranges, renderPipelineBuffering: buffering });
  });
  const miniPlayerTrack = writable<TrackItem | null>(null);
  const miniPlayerSelectedTrack = writable<TrackItem | null>(null);
  const miniPlayerArtworkUrl = writable<string | null>(null);
  const miniPlayer = createMiniPlayerController({
    snapshot: playerController.snapshot,
    track: miniPlayerTrack,
    selectedTrack: miniPlayerSelectedTrack,
    artworkUrl: miniPlayerArtworkUrl,
    handlers: {
      togglePlayback: () => actions.togglePlayback(),
      previousTrack: () => actions.stepTrack(-1),
      nextTrack: () => actions.stepTrack(1),
      seek: (seconds) => actions.seek(seconds),
      setVolume: (volume) => actions.setVolume(volume),
      toggleMute: () => actions.toggleMute(),
      enterNowPlaying: () => {
        if (!state.isNowPlayingLayoutActive) {
          actions.toggleNowPlayingView();
        }
        window.focus();
      }
    }
  });
  const playCountTracker = createPlayCountTracker({
    incrementLibraryPlayCount: workspaceCollections.incrementLibraryPlayCount,
    recordLibraryLastPlayed: workspaceCollections.recordLibraryLastPlayed
  });
  const playbackRestoration = createPlaybackRestorationController({
    track: playerController.currentTrack,
    snapshot: playerController.snapshot,
    getQueueTrack: (id) => state.queueItems.find((item) => item.id === id) ?? null,
    ensureLoaded: (id) => queueStore.ensureLoaded(id),
    selectTrack: (id) => workspaceShell.selectTrack('queue', id),
    loadTrack: (track, options) => playerController.load(track, options)
  });
  const artworkPresentation = createArtworkPresentationController({
    resolveTrackSnapshot: (track) =>
      resolveTrackSnapshot(track, deps.getSelectedItem(), state.queueItems, state.libraryItems),
    isPlaybackDetailsPending: (trackId) =>
      state.playbackCommandsState?.pendingPlaybackTrackId === trackId
      || state.playingTrack?.id === trackId,
    loadArtwork: (track) => state.multiplayerState.mode === 'client'
      ? Promise.resolve(toLoadedMultiplayerArtwork(track, state.multiplayerState.remoteArtwork))
      : loadTrackArtwork(track),
    getArtworkLoadKey: (track) => state.multiplayerState.mode === 'client'
      ? getRemoteArtworkLoadKey(
          track,
          state.multiplayerState.remoteArtwork,
          state.multiplayerState.remoteArtworkResolvedTrackKey
        )
      : getTrackArtworkLoadKey(track)
  });
  const appShortcuts = createAppShortcuts({
    getState: () => ({
      isNowPlayingLayoutActive: state.isNowPlayingLayoutActive,
      videoTrackActive: state.videoTrackActive,
      isRightPanelVisible: state.workspaceShellState.isRightPanelVisible,
      activeCollection: state.workspaceShellState.activeCollection,
      queueSelectionIds: state.queueSelectionIds,
      librarySelectionIds:
        libraryViewSettings.getSnapshot().activeView === 'favorites'
          ? state.favoriteSelectionIds
          : state.librarySelectionIds,
      selectedTrackItem: state.selectedTrackItem,
      selectedLibraryItem:
        libraryViewSettings.getSnapshot().activeView === 'favorites'
          ? state.selectedFavoriteItem
          : state.selectedLibraryItem,
      playingTrack: state.playingTrack,
      playbackSnapshot: state.playbackSnapshot
    }),
    handlers: {
      toggleFullscreenPresentation: () => actions.toggleFullscreenPresentation(),
      closeNowPlayingView: () => actions.closeNowPlayingView(),
      closeActiveRightPanel: () =>
        closeActiveRightPanelFor(state.workspaceShellState.workspacePanels, (tab) =>
          workspaceShell.closeWorkspaceTab(tab)
        ),
      removeTrackItems: (ids) => {
        if (state.isFreeplayClient) {
          actions.removeFromFreeplayQueue(ids);
          return;
        }
        if (!state.isMultiplayerClient) workspaceCollections.removeTrackItems(ids);
      },
      removeLibraryItems: (ids) =>
        state.isMultiplayerClient
          ? undefined
          : libraryViewSettings.getSnapshot().activeView === 'favorites'
          ? workspaceCollections.handleFavoriteContextAction('remove-favorite', ids)
          : workspaceCollections.removeLibraryItems(ids),
      cycleWorkspaceTab: (direction) =>
        cycleWorkspaceTabs(
          direction,
          state.workspaceShellState.workspaceTabs.map((tab) => tab.id),
          state.workspaceShellState.activeWorkspaceTab,
          (tab) => workspaceShell.setActiveWorkspaceTab(tab)
        ),
      seek: (seconds) => actions.seek(seconds),
      stepTrack: (direction) => actions.stepTrack(direction),
      setVolume: (volume) => actions.setVolume(volume),
      activateQueueTrack: (id) => {
        if (multiplayerController.activateTrack('queue', id)) return;
        return playbackCommands.activateQueueTrack(id);
      },
      activateLibraryTrack: (id) => deps.activateLibraryPanelTrack(id),
      togglePlayback: () => actions.togglePlayback(),
      toggleMute: () => actions.toggleMute(),
      selectAllTracks: (collection) =>
        collection === 'library' && libraryViewSettings.getSnapshot().activeView === 'favorites'
          ? windowSelection.selectAllFavorites()
          : workspaceShell.selectAllTracks(collection),
      openFiles: () => { if (!state.isMultiplayerClient) void deps.handleMenuOpenFiles(); },
      openOptions: () => deps.openOptionsWindow(),
      toggleMiniPlayer: () => miniPlayer.toggle(),
      exit: () => windowManager.exit()
    }
  });
  const importController = createImportController({
    addFiles: (files, target) => workspaceCollections.handleAddFiles(files, target),
    clickFileInput: () => fileInputRef.current?.click(),
    getOpenFilePickerDescription: () =>
      get(t)('main.import.supportedMediaFiles', { default: 'Supported media files' })
  });

  // ── Subscription wiring ────────────────────────────────────────────────

  const unsubscribeTrackItems = queueItemsStore.subscribe((value) => viewSet({ trackItems: value }));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => viewSet({ libraryItems: value }));
  const unsubscribeFavoriteItems = favoriteItemsStore.subscribe((value) => viewSet({ favoriteItems: value }));
  void Promise.all([queueStore.ready(), libraryStore.ready(), favoritesStore.ready()]).then(async () => {
    viewSet({ collectionsReady: true });
    void scanLaunchLibraryFolders();
    await playbackRestoration.restore();
    void multiplayerController.startLaunch();
  });
  const unsubscribeQueueSelectedIds = queueSelectedIdsStore.subscribe(
    (value) => viewSet({ trackSelectionIds: value })
  );
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe(
    (value) => viewSet({ librarySelectionIds: value })
  );
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe(
    (value) => viewSet({ librarySelectionAnchorId: value.anchorId })
  );
  const unsubscribeFavoriteSelectedIds = favoriteSelectedIdsStore.subscribe(
    (value) => viewSet({ favoriteSelectionIds: value })
  );
  const unsubscribeFavoriteSelection = favoriteSelectionStore.subscribe(
    (value) => viewSet({ favoriteSelectionAnchorId: value.anchorId })
  );
  const unsubscribeQueueSelectedTrack = queueSelectedTrackStore.subscribe(
    (value) => viewSet({ selectedTrackItem: value })
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => viewSet({ selectedLibraryItem: value })
  );
  const unsubscribeFavoriteSelectedTrack = favoriteSelectedTrackStore.subscribe(
    (value) => viewSet({ selectedFavoriteItem: value })
  );
  const unsubscribeShuffle = shuffleStore.subscribe((value) => publish({ localShuffleEnabled: value }));
  const unsubscribeRepeat = repeatStore.subscribe((value) => publish({ localRepeatMode: value }));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    publish({ localPlayingTrack: value });
    syncPlayingTrackMetadata(value, {
      isMultiplayerClient: state.isMultiplayerClient,
      libraryItems: view.getSnapshot().libraryItems,
      favoriteItems: view.getSnapshot().favoriteItems,
      notifyCurrentTrackChanged: (track) => playbackCommands.notifyCurrentTrackChanged(track)
    });
  });
  const unsubscribeUpNext = upNext.subscribe((value) => {
    viewSet({ upNextEntries: value });
  });
  const unsubscribePlaybackSnapshot = playerController.snapshot.subscribe((value) => {
    publish({ localPlaybackSnapshot: value });
    if (value.state === 'playing') appInstallService.markEngaged();
    if (state.multiplayerState.mode !== 'client') {
      void playbackCommands.handlePlaybackProgress();
    }
  });
  const unsubscribePlaybackStatus = playerController.status.subscribe(
    (value) => publish({ localPlaybackStatus: value })
  );
  const unsubscribeWorkspaceShell = workspaceShell.subscribe((value) => publish({ workspaceShellState: value }));
  const unsubscribePlaybackCommands = playbackCommands.subscribe(
    (value) => publish({ playbackCommandsState: value })
  );
  const unsubscribePlaybackProgress = playbackProgress.subscribe(
    (value) => publish({ playbackProgressState: value })
  );
  const unsubscribeArtworkPresentation = artworkPresentation.subscribe(
    (value) => publish({ artworkPresentationState: value })
  );
  const unsubscribeLyricsPresentation = lyricsPresentation.subscribe(
    (value) => publish({ lyricsPresentationState: value })
  );
  const unsubscribeAppInstall = appInstallService.subscribe((value) => publish({ appInstallState: value }));
  const unsubscribeMiniPlayer = miniPlayer.subscribe((value) => publish({ miniPlayerState: value }));
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) =>
    void playbackCommands.importLaunchedFiles(files, trackSettings.getSnapshot().associatedFileAction)
  );
  const displayPlaybackSnapshotStore = writable<PlaybackSnapshot>(state.playbackSnapshot);
  const mediaSessionArtworkOverrideStore = writable<LoadedStreamArtwork | null | undefined>(undefined);
  const multiplayerClientMediaSessionStore = writable(false);
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: displayPlaybackSnapshotStore,
    track: miniPlayerTrack,
    settings: playbackSettings,
    artworkOverride: mediaSessionArtworkOverrideStore,
    transportAnchorActive: multiplayerClientMediaSessionStore,
    handlers: {
      play: () => actions.play(),
      pause: () => actions.pause(),
      stop: () => actions.stop(),
      previousTrack: () => actions.stepTrack(-1),
      nextTrack: () => actions.stepTrack(1),
      seekTo: (seconds) => actions.seek(seconds)
    }
  });

  // ── Action bundle (forwarded handlers) ─────────────────────────────────

  Object.assign(actions, {
    togglePlayback: () => transport.togglePlayback(),
    play: () => transport.play(),
    pause: () => transport.pause(),
    stop: () => transport.stop(),
    stepTrack: (direction: -1 | 1) => transport.stepTrack(direction),
    seek: (seconds: number) => transport.seek(seconds),
    setVolume: (volume: number) => transport.setVolume(volume),
    toggleMute: () => transport.toggleMute(),
    toggleQueueShuffle: () => transport.toggleQueueShuffle(),
    cycleQueueRepeat: () => transport.cycleQueueRepeat(),
    startOver: () => transport.startOver(),
    localizePlaybackError: (message: string) => localizePlaybackErrorMessage(message, translate),
    handleMenuOpenFiles: (target?: WorkspaceCollection) => deps.handleMenuOpenFiles(target),
    handleMenuOpenFolder: (target?: WorkspaceCollection) => deps.handleMenuOpenFolder(target),
    handleMenuInput: (event: Event) => deps.handleMenuInput(event),
    syncVideoWindowSize: (active: boolean, autoResizeWindow: boolean) =>
      videoActions.syncWindowSize(active, autoResizeWindow),
    syncVideoPresentation: (track: TrackItem | null, autoEnterTheater: boolean) =>
      videoActions.syncPresentation(track, autoEnterTheater),
    toggleVideoTheater: () => videoActions.toggleTheater(),
    setVideoFit: (fitMode: VideoFitMode) => videoActions.setFit(fitMode),
    toggleVideoPictureInPicture: () => videoActions.togglePictureInPicture(),
    toggleVideoFullscreen: () => videoActions.toggleFullscreen(),
    toggleFullscreenPresentation: () => videoActions.toggleFullscreenPresentation(),
    toggleNowPlayingView: () => videoActions.toggleNowPlayingView(),
    closeNowPlayingView: () => videoActions.closeNowPlayingView(),
    handleAppKeydown: (event: KeyboardEvent) => {
      if (state.videoTheaterActive && event.key === 'Escape') {
        if (typeof document !== 'undefined' && document.fullscreenElement) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        publish({ videoTheaterActive: false, videoTheaterControlsHidden: false });
        return;
      }
      appShortcuts.handleKeydown(event);
    },
    handleOpenOptions: (view?: OptionsViewName) => deps.openOptionsWindow(view),
    handleOpenAbout: () => deps.openOptionsWindow('about'),
    handleOpenOptionsMobile: (view?: OptionsViewName) => deps.openOptionsMobile(view),
    navigateTrackDetailsToLibrary: (target: import('$lib/services/library-navigation').TrackLibraryNavigationTarget) =>
      workspaceShell.showLibraryGroup(target),
    handlePopupWindowMessage: (event: MessageEvent) => troubadourBridge.handleMessage(event),
    handleForceUpdate: () => forceServiceWorkerUpdateCheck(),
    handleMultiplayerHost: () => multiplayerController.host(),
    startLaunchMultiplayer: () => multiplayerController.startLaunch(),
    handleMultiplayerJoin: () => multiplayerController.joinWithPrompt(),
    joinMultiplayer: (inviteCode: string) => multiplayerController.join(inviteCode),
    joinPairedMultiplayer: (hostId: string) => multiplayerController.joinPaired(hostId),
    copyMultiplayerInvite: () => multiplayerController.copyInvite(),
    dismissMultiplayerConnectionDialog: () => multiplayerController.dismissConnectionDialog(),
    dismissMultiplayerToast: () => multiplayerController.dismissToast(),
    addToFreeplayQueue: (ids: string[]) => freeplayActions.addToFreeplayQueue(ids),
    removeFromFreeplayQueue: (ids: string[]) => freeplayActions.removeFromFreeplayQueue(ids),
    handleFreeplayQueueContextAction: (actionId: string, ids: string[]) =>
      freeplayActions.handleQueueContextAction(actionId, ids),
    handleFreeplayLibraryContextAction: (actionId: string, ids: string[]) =>
      freeplayActions.handleLibraryContextAction(actionId, ids),
    handleNowPlayingTabChange: (tab: WorkspaceTab) => workspaceShell.setActiveWorkspaceTab(tab),
    closeActiveRightPanel: () =>
      closeActiveRightPanelFor(state.workspaceShellState.workspacePanels, (tab) =>
        workspaceShell.closeWorkspaceTab(tab)
      ),
    cycleWorkspaceTab: (direction: -1 | 1) =>
      cycleWorkspaceTabs(
        direction,
        state.workspaceShellState.workspaceTabs.map((tab) => tab.id),
        state.workspaceShellState.activeWorkspaceTab,
        (tab) => workspaceShell.setActiveWorkspaceTab(tab)
      ),
    showQueue: () => workspaceShell.showWorkspaceTab('queue'),
    showLibrary: () => workspaceShell.showWorkspaceTab('library'),
    showTrackDetails: () => workspaceShell.showTrackDetails(),
    showTrackLyrics: () => workspaceShell.showTrackLyrics(),
    togglePatterns: () => {
      if (state.workspaceShellState.isPatternsPanelVisible) {
        workspaceShell.closeWorkspaceTab('patterns');
        return;
      }
      workspaceShell.showWorkspaceTab('patterns');
    },
    handleShowQueueTrack: (id: string) => workspaceShell.showQueueTrack(id),
    handleShowPlayerTrackDetails: (id: string) => {
      workspaceShell.showQueueTrack(id);
      workspaceShell.showTrackDetails();
    }
  });

  const panelHandlers = createMainWindowPanelHandlers({
    getIsMultiplayerClient: () => state.isMultiplayerClient,
    getIsFreeplayClient: () => state.isFreeplayClient,
    workspaceCollections,
    workspaceShell,
    filesystemFolders,
    importController,
    windowSelection,
    getActiveView: () => libraryViewSettings.getSnapshot().activeView,
    multiplayerController,
    freeplayActions,
    upNext,
    playbackCommands,
    handleMenuOpenFiles: (target) => deps.handleMenuOpenFiles(target),
    handleFreeplayQueueContextAction: (actionId, ids) =>
      actions.handleFreeplayQueueContextAction(actionId, ids),
    handleFreeplayLibraryContextAction: (actionId, ids) =>
      actions.handleFreeplayLibraryContextAction(actionId, ids),
    activateLibraryPanelTrack: (id) => deps.activateLibraryPanelTrack(id),
    handleSelect: (collection, event) => deps.handleSelect(collection, event),
    handleSetSelection: (collection, event) => deps.handleSetSelection(collection, event),
    transport
  });

  const fileInputRef: { current: HTMLInputElement | null } = { current: null };
  const videoParkingHostRef: { current: HTMLDivElement | null } = { current: null };
  const topMenuBarHeightRef: { current: number } = { current: 0 };
  const innerWidthRef: { current: number } = {
    current: typeof window !== 'undefined' ? window.innerWidth : 0
  };
  const innerHeightRef: { current: number } = {
    current: typeof window !== 'undefined' ? window.innerHeight : 0
  };

  function dispose(): void {
    multiplayerController.dismissToast();
    renderBufferedPoll.stop();
    playbackRestoration.destroy();
    playbackProgress.destroy();
    artworkPresentation.destroy();
    lyricsPresentation.destroy();
    playCountTracker.destroy();
    workspaceShell.destroy();
    unsubscribeTrackItems();
    unsubscribeLibraryItems();
    unsubscribeFavoriteItems();
    unsubscribeUpNext();
    unsubscribeQueueSelectedIds();
    unsubscribeLibrarySelectedIds();
    unsubscribeLibrarySelection();
    unsubscribeFavoriteSelectedIds();
    unsubscribeFavoriteSelection();
    unsubscribeQueueSelectedTrack();
    unsubscribeLibrarySelectedTrack();
    unsubscribeFavoriteSelectedTrack();
    unsubscribeShuffle();
    unsubscribeRepeat();
    unsubscribeTrack();
    unsubscribePlaybackSnapshot();
    unsubscribePlaybackStatus();
    unsubscribeWorkspaceShell();
    unsubscribePlaybackCommands();
    unsubscribePlaybackProgress();
    unsubscribeArtworkPresentation();
    unsubscribeLyricsPresentation();
    unsubscribeAppInstall();
    unsubscribeMiniPlayer();
    multiplayerBundle.unsubscribe();
    multiplayerSession.destroy();
    multiplayerController.destroy();
    miniPlayer.destroy();
    appInstallService.destroy();
    unsubscribeLaunchedFiles();
    stopLibraryFolderCommands();
    stopLoadoutRuntime();
    disconnectMediaSession();
    playerController.destroy();
  }

  return {
    handles: {
      fileInput: () => fileInputRef.current,
      videoParkingHost: () => videoParkingHostRef.current,
      topMenuBarHeight: () => topMenuBarHeightRef.current,
      innerWidth: () => innerWidthRef.current,
      innerHeight: () => innerHeightRef.current,
      actions,
      appShortcuts,
      workspaceShell,
      workspaceCollections,
      windowSelection,
      multiplayerController,
      multiplayerSession,
      freeplayActions,
      transport,
      miniPlayer,
      playbackProgress,
      playbackCommands,
      playbackRestoration,
      artworkPresentation,
      lyricsPresentation,
      patternTabPresentation,
      videoActions,
      importController,
      troubadourBridge,
      playCountTracker,
      renderBufferedPoll,
      appInstallService,
      windowManager,
      panelHandlers,
      bindFileInput: (element: HTMLInputElement | null) => (fileInputRef.current = element),
      bindVideoParkingHost: (element: HTMLDivElement | null) => (videoParkingHostRef.current = element),
      bindTopMenuBarHeight: (height: number) => (topMenuBarHeightRef.current = height),
      bindInnerWidth: (width: number) => (innerWidthRef.current = width),
      bindInnerHeight: (height: number) => (innerHeightRef.current = height)
    },
    stores: {
      displayPlaybackSnapshotStore,
      mediaSessionArtworkOverrideStore,
      multiplayerClientMediaSessionStore,
      miniPlayerTrack,
      miniPlayerSelectedTrack,
      miniPlayerArtworkUrl,
      view
    },
    subscribe,
    getSnapshot,
    dispose
  };
}
