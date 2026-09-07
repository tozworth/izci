/**
 * Main-window runtime factory for the composition root.
 *
 * Owns controller fabrication, store/subscription wiring, and teardown. The
 * component receives controller handles plus the few composite handlers that
 * genuinely cross owners. Runtime state bookkeeping stays in
 * `main-window-runtime-state.ts`.
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
import { appInstallService } from '$lib/services/app-install';
import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
import { createLyricsPresentationController } from '$lib/services/lyrics-presentation';
import { startLoadoutRuntime } from '$lib/services/loadouts';
import { createPlaybackCommandsController } from '$lib/services/playback-commands';
import { createMiniPlayerController } from '$lib/services/mini-player';
import { createPlaybackProgressController } from '$lib/services/playback-progress';
import { createPlaybackRestorationController } from '$lib/services/playback-restoration';
import { setSleepTimerFiredHandler } from '$lib/services/sleep-timer';
import { abLoop, resolveAbLoopRange } from '$lib/services/ab-loop';
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
  TrackItem
} from '$lib/types';
import type {
  VideoSeekFeedback
} from '$lib/components/workspace/types';
import { upNext } from '$lib/stores/up-next';
import { type OptionsViewName } from '../../options/views';
import {
  buildCoopLibraryContextActions,
  buildCoopQueueContextActions,
  buildFreeplayLibraryContextActions,
  buildFreeplayQueueContextActions
} from '$lib/services/workspace-actions';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';
import type { MultiplayerCollection } from '$lib/services/multiplayer-protocol';
import {
  getRemoteArtworkLoadKey,
  toLoadedMultiplayerArtwork
} from '$lib/services/multiplayer-artwork';
import { createMultiplayerWindowController } from '$lib/services/multiplayer-window-controller';
import { createFreeplayUiActions } from '$lib/services/freeplay-ui-actions';
import { createMultiplayerSession } from '$lib/services/multiplayer-session';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { multiplayerPairings } from '$lib/stores/multiplayer-pairings';
import {
  createWindowSelectionController,
  type RemoteSelectionSnapshot
} from '$lib/services/main-window-selection';
import { createMainWindowPanelHandlers } from '$lib/services/main-window-handlers';
import { createVideoWindowActions } from '$lib/services/video-window-actions';
import { createTroubadourMainWindowBridge } from '$lib/services/troubadour-main-window';
import { createTransportActions } from '$lib/services/transport-actions';
import { createRenderBufferedPollController } from '$lib/services/multiplayer-render-buffered-poll';
import { createMainWindowView } from '$lib/services/main-window-view';
import { windowDisplayState } from '$lib/services/window-display-state';
import { resolveTrackSnapshot } from '$lib/services/artwork-presentation';
import { getTrackDisplayTitle } from '$lib/utils/files';
import {
  createMainWindowRuntimeState,
  type MainWindowRuntimeState,
  type MainWindowRuntimeStores
} from '$lib/services/main-window-runtime-state';

/** Handles owned by the composition root and surfaced to the component. */
interface MainWindowRuntimeHandles {
  bindFileInput(element: HTMLInputElement | null): void;
  handleAppKeydown(event: KeyboardEvent): void;
  handlePopupWindowMessage(event: MessageEvent): void;
  togglePatterns(): void;
  showPlayerTrackDetails(id: string): void;
  appShortcuts: {
    handleContextMenu(event: MouseEvent): void;
    handleKeydown(event: KeyboardEvent): void;
  };
  workspaceShell: ReturnType<typeof createWorkspaceShellController>;
  workspaceCollections: ReturnType<typeof createWorkspaceCollectionsController>;
  multiplayerController: ReturnType<typeof createMultiplayerWindowController>;
  multiplayerSession: MultiplayerSessionController;
  freeplayActions: ReturnType<typeof createFreeplayUiActions>;
  transport: ReturnType<typeof createTransportActions>;
  miniPlayer: ReturnType<typeof createMiniPlayerController>;
  playbackProgress: ReturnType<typeof createPlaybackProgressController>;
  playbackCommands: ReturnType<typeof createPlaybackCommandsController>;
  artworkPresentation: ReturnType<typeof createArtworkPresentationController>;
  lyricsPresentation: ReturnType<typeof createLyricsPresentationController>;
  patternTabPresentation: ReturnType<typeof createContextualTabPresentationController>;
  videoActions: ReturnType<typeof createVideoWindowActions>;
  importController: ReturnType<typeof createImportController>;
  playCountTracker: ReturnType<typeof createPlayCountTracker>;
  renderBufferedPoll: ReturnType<typeof createRenderBufferedPollController>;
  panelHandlers: ReturnType<typeof createMainWindowPanelHandlers>;
}

interface MainWindowRuntime {
  handles: MainWindowRuntimeHandles;
  stores: MainWindowRuntimeStores;
  subscribe(listener: (updates: Partial<MainWindowRuntimeState>) => void): () => void;
  getSnapshot(): MainWindowRuntimeState;
  publish(updates: Partial<MainWindowRuntimeState>): void;
  dispose(): void;
}

interface MainWindowRuntimeDeps {
  mobileMode: boolean;
  getRemoteSelections(): RemoteSelectionSnapshot;
  setRemoteSelections(selections: RemoteSelectionSnapshot): void;
  setVideoSeekFeedback(feedback: VideoSeekFeedback | null): void;
  getSelectedItem(): TrackItem | null;
  openOptions(view?: OptionsViewName): void;
  activateLibraryPanelTrack(id: string): Promise<void>;
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

  setSleepTimerFiredHandler(() => transport.pause());

  const { state, publish, subscription } = createMainWindowRuntimeState();
  const { subscribe, getSnapshot } = subscription;

  function canSendTrackToChat(): boolean {
    return state.multiplayerState.mode !== 'idle'
      && state.multiplayerState.connectionStatus === 'connected'
      && state.workspaceShellState.workspaceTabs.some((tab) => tab.id === 'chat');
  }

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
      ? buildFreeplayQueueContextActions(state.queueItems, state.libraryItems, ids, canSendTrackToChat())
      : state.isMultiplayerClient
        ? buildCoopQueueContextActions(state.queueItems, state.libraryItems, ids, canSendTrackToChat())
      : workspaceCollections.getQueueContextActions(ids, canSendTrackToChat()),
    getLibraryContextActions: (ids) => state.isFreeplayClient
      ? buildFreeplayLibraryContextActions(
          libraryViewSettings.getSnapshot().activeView === 'favorites'
            ? state.favoriteItems
            : state.libraryItems,
          state.libraryItems,
          ids,
          canSendTrackToChat()
        )
        : state.isMultiplayerClient
        ? buildCoopLibraryContextActions(
            libraryViewSettings.getSnapshot().activeView === 'favorites'
              ? state.favoriteItems
              : state.libraryItems,
            state.libraryItems,
            ids,
            canSendTrackToChat()
          )
        : libraryViewSettings.getSnapshot().activeView === 'favorites'
        ? workspaceCollections.getFavoriteContextActions(ids, canSendTrackToChat())
        : workspaceCollections.getLibraryContextActions(ids, canSendTrackToChat()),
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
      playQueue: () => transport.togglePlayback()
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

  let multiplayerSession: MultiplayerSessionController;
  const multiplayerController = createMultiplayerWindowController({
    getSession: () => multiplayerSession,
    getPlaybackCommands: () => playbackCommands,
    getPlayingTrack: () => state.playingTrack,
    getPlaybackSnapshot: () => state.playbackSnapshot,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    seek: (seconds) => transport.seek(seconds),
    toggleQueueShuffle: () => transport.toggleQueueShuffle(),
    cycleQueueRepeat: () => transport.cycleQueueRepeat(),
    playQueueItemsNext: (ids) => {
      const selected = state.queueItems.filter((item) => ids.includes(item.id));
      upNext.add(selected, 'front');
    },
    getMultiplayerSettings: () => multiplayerSettings.getSnapshot(),
    getLastSession: () => multiplayerLastSession.getSnapshot(),
    getPairings: () => multiplayerPairings.getSnapshot(),
    pausePlayer: () => playerController.pause(),
    setActiveWorkspaceTab: (tab) => workspaceShell.setActiveWorkspaceTab(tab),
    getRemoteSelections: deps.getRemoteSelections,
    setRemoteSelections: deps.setRemoteSelections,
    translate
  });
  multiplayerSession = createMultiplayerSession({
    handleHostCommand: (command) => multiplayerController.handleHostCommand(command),
    pauseHostPlayback: () => playbackCommands.pause(),
    resumeHostPlayback: () => { void playbackCommands.play(); }
  });
  multiplayerController.prepareLaunchDialog();
  publish({ multiplayerState: multiplayerSession.getSnapshot() });
  const unsubscribeMultiplayerUi = multiplayerController.subscribe((ui) => {
    publish({
      multiplayerConnectionDialogOpen: ui.dialog.open,
      multiplayerConnectionDialogError: ui.dialog.error,
      multiplayerConnectionOperation: ui.dialog.operation,
      multiplayerConnectionTargetName: ui.dialog.targetName,
      multiplayerToastMessage: ui.toastMessage
    });
  });
  const unsubscribeMultiplayer = multiplayerSession.subscribe((value) => {
    const isClient = value.mode === 'client';
    publish({
      multiplayerState: value,
      isMultiplayerClient: isClient,
      isFreeplayClient: isClient && value.freeplay,
      isSourceFileFreeplayClient: isClient && value.freeplay && value.remoteDelivery.mode === 'source-file',
      videoTrackActive: !isClient && state.playingTrack?.kind === 'video'
    });
    const update = multiplayerController.syncFromSession(value);
    if (update.enteredFreeplay) workspaceShell.setActiveWorkspaceTab('library');
    if (update.remoteSelections) deps.setRemoteSelections(update.remoteSelections);
  });
  const freeplayActions = createFreeplayUiActions({
    getIsFreeplayClient: () => state.isFreeplayClient,
    getFreeplayQueue: () => state.multiplayerState.freeplayQueue,
    setFreeplayQueue: (ids) => multiplayerSession.setFreeplayQueue(ids),
    sendCommand: (command) => multiplayerSession.sendCommand(command),
    getShuffleEnabled: () => state.multiplayerState.remoteCatalog.shuffleEnabled,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    getActiveView: () => libraryViewSettings.getSnapshot().activeView,
    copyTrackFilenames: (tracks) => workspaceCollections.copyTrackFilenames(tracks),
    showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
    showTrackDetails: () => workspaceShell.showTrackDetails(),
    activateTrack: (collection, id) => multiplayerController.activateTrack(collection, id)
  });

  const videoActions = createVideoWindowActions({
    getVideoTrackActive: () => state.videoTrackActive,
    getTheaterActive: () => state.videoTheaterActive,
    setTheaterActive: (active) => publish({ videoTheaterActive: active }),
    setTheaterControlsHidden: (hidden) => publish({ videoTheaterControlsHidden: hidden }),
    getIsNowPlayingLayoutActive: () => state.isNowPlayingLayoutActive,
    getIsAutomaticNowPlayingEligible: () => state.isAutomaticNowPlayingEligible,
    setAutoNowPlayingSuppressed: (value) => publish({ autoNowPlayingSuppressed: value }),
    getWindowDisplayState: () => {
      const display = get(windowDisplayState);
      return { maximized: display.maximized, fullscreen: display.fullscreen };
    },
    mobileMode: deps.mobileMode,
    showVideoTab: () => workspaceShell.showWorkspaceTab('video'),
    closeVideoTab: () => workspaceShell.closeWorkspaceTab('video')
  });

  const transport = createTransportActions({
    getPlaybackCommands: () => playbackCommands,
    getMultiplayerSession: () => multiplayerSession,
    getPlaybackSnapshot: () => state.playbackSnapshot,
    getPlayingTrack: () => state.playingTrack,
    getIsMultiplayerClient: () => state.isMultiplayerClient,
    getIsSourceFileFreeplayClient: () => state.isSourceFileFreeplayClient,
    getVideoTrackActive: () => state.videoTrackActive,
    setVideoSeekFeedback: deps.setVideoSeekFeedback,
    resumeLyricsAutoScroll: () => lyricsPresentation.resumeAutoScroll(),
    getPlaybackProgress: () => playbackProgress,
    getResumeNotice: () => state.playbackProgressState.notice
  });

  const troubadourBridge = createTroubadourMainWindowBridge({
    getPlayingTrack: () => state.playingTrack,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    getQueueSelectionIds: () => state.queueSelectionIds,
    getLibrarySelectionIds: () => state.librarySelectionIds,
    getFavoriteSelectionIds: () => state.favoriteSelectionIds,
    getPlaybackSnapshot: () => state.playbackSnapshot,
    loadTrack: (track, options) => playerController.load(track, options),
    refreshCurrentTrack: (id, patch) => playerController.refreshCurrentTrack(id, patch),
    getTroubadourWindow: () => windowManager.getPopup('troubadour'),
    openOptions: (view) => deps.openOptions(view)
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
      togglePlayback: () => transport.togglePlayback(),
      previousTrack: () => transport.stepTrack(-1),
      nextTrack: () => transport.stepTrack(1),
      seek: (seconds) => transport.seek(seconds),
      setVolume: (volume) => transport.setVolume(volume),
      toggleMute: () => transport.toggleMute(),
      enterNowPlaying
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
      toggleFullscreenPresentation: () => videoActions.toggleFullscreenPresentation(),
      closeNowPlayingView: () => videoActions.closeNowPlayingView(),
      closeActiveRightPanel: () =>
        closeActiveRightPanelFor(state.workspaceShellState.workspacePanels, (tab) =>
          workspaceShell.closeWorkspaceTab(tab)
        ),
      removeTrackItems: (ids) => {
        if (state.isFreeplayClient) {
          freeplayActions.removeFromFreeplayQueue(ids);
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
      seek: (seconds) => transport.seek(seconds),
      stepTrack: (direction) => transport.stepTrack(direction),
      setVolume: (volume) => transport.setVolume(volume),
      activateQueueTrack: (id) => {
        if (multiplayerController.activateTrack('queue', id)) return;
        return playbackCommands.activateQueueTrack(id);
      },
      activateLibraryTrack: (id) => deps.activateLibraryPanelTrack(id),
      togglePlayback: () => transport.togglePlayback(),
      toggleMute: () => transport.toggleMute(),
      selectAllTracks: (collection) =>
        collection === 'library' && libraryViewSettings.getSnapshot().activeView === 'favorites'
          ? windowSelection.selectAllFavorites()
          : workspaceShell.selectAllTracks(collection),
      openFiles: () => {
        if (!state.isMultiplayerClient) void importController.openFiles(state.workspaceShellState.activeCollection);
      },
      openOptions: () => deps.openOptions(),
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

  const unsubscribeTrackItems = queueItemsStore.subscribe((value) => {
    viewSet({ trackItems: value });
    publish({ queueItems: value });
  });
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => {
    viewSet({ libraryItems: value });
    publish({ libraryItems: value });
  });
  const unsubscribeFavoriteItems = favoriteItemsStore.subscribe((value) => {
    viewSet({ favoriteItems: value });
    publish({ favoriteItems: value });
  });
  void Promise.all([queueStore.ready(), libraryStore.ready(), favoritesStore.ready()]).then(async () => {
    viewSet({ collectionsReady: true });
    void scanLaunchLibraryFolders();
    await playbackRestoration.restore();
    void multiplayerController.startLaunch();
  });
  const unsubscribeQueueSelectedIds = queueSelectedIdsStore.subscribe(
    (value) => {
      viewSet({ trackSelectionIds: value });
      publish({ queueSelectionIds: value });
    }
  );
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe(
    (value) => {
      viewSet({ librarySelectionIds: value });
      publish({ librarySelectionIds: value });
    }
  );
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe(
    (value) => {
      viewSet({ librarySelectionAnchorId: value.anchorId });
      publish({ librarySelectionAnchorId: value.anchorId });
    }
  );
  const unsubscribeFavoriteSelectedIds = favoriteSelectedIdsStore.subscribe(
    (value) => {
      viewSet({ favoriteSelectionIds: value });
      publish({ favoriteSelectionIds: value });
    }
  );
  const unsubscribeFavoriteSelection = favoriteSelectionStore.subscribe(
    (value) => {
      viewSet({ favoriteSelectionAnchorId: value.anchorId });
      publish({ favoriteSelectionAnchorId: value.anchorId });
    }
  );
  const unsubscribeQueueSelectedTrack = queueSelectedTrackStore.subscribe(
    (value) => {
      viewSet({ selectedTrackItem: value });
      publish({ selectedTrackItem: value });
    }
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => {
      viewSet({ selectedLibraryItem: value });
      publish({ selectedLibraryItem: value });
    }
  );
  const unsubscribeFavoriteSelectedTrack = favoriteSelectedTrackStore.subscribe(
    (value) => {
      viewSet({ selectedFavoriteItem: value });
      publish({ selectedFavoriteItem: value });
    }
  );
  const unsubscribeShuffle = shuffleStore.subscribe((value) =>
    publish({ localShuffleEnabled: value, shuffleEnabled: value })
  );
  const unsubscribeRepeat = repeatStore.subscribe((value) =>
    publish({ localRepeatMode: value, repeatMode: value })
  );
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    publish({
      localPlayingTrack: value,
      playingTrack: value,
      videoTrackActive: !state.isMultiplayerClient && value?.kind === 'video'
    });
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
    publish({ localPlaybackSnapshot: value, playbackSnapshot: value });
    if (value.state === 'playing') appInstallService.markEngaged();
    if (state.multiplayerState.mode !== 'client') {
      void playbackCommands.handlePlaybackProgress();
    }
  });
  const unsubscribePlaybackStatus = playerController.status.subscribe(
    (value) => publish({ localPlaybackStatus: value, playbackStatus: value })
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
      play: () => transport.play(),
      pause: () => transport.pause(),
      stop: () => transport.stop(),
      previousTrack: () => transport.stepTrack(-1),
      nextTrack: () => transport.stepTrack(1),
      seekTo: (seconds) => transport.seek(seconds)
    }
  });

  function enterNowPlaying(): void {
    if (!state.isNowPlayingLayoutActive) videoActions.toggleNowPlayingView();
    window.focus();
  }

  function handleAppKeydown(event: KeyboardEvent): void {
    if (state.videoTheaterActive && event.key === 'Escape') {
      if (typeof document !== 'undefined' && document.fullscreenElement) return;
      event.preventDefault();
      event.stopPropagation();
      publish({ videoTheaterActive: false, videoTheaterControlsHidden: false });
      return;
    }
    appShortcuts.handleKeydown(event);
  }

  function togglePatterns(): void {
    if (state.workspaceShellState.isPatternsPanelVisible) {
      workspaceShell.closeWorkspaceTab('patterns');
      return;
    }
    workspaceShell.showWorkspaceTab('patterns');
  }

  function showPlayerTrackDetails(id: string): void {
    workspaceShell.showQueueTrack(id);
    workspaceShell.showTrackDetails();
  }

  function sendTrackToChat(collection: MultiplayerCollection, id: string): void {
    if (!id || !canSendTrackToChat()) return;
    const items = collection === 'queue'
      ? state.queueItems
      : collection === 'favorites'
        ? state.favoriteItems
        : state.libraryItems;
    const track = items.find((item) => item.id === id);
    if (!track) return;
    multiplayerSession.sendChatTrack({
      collection,
      itemId: track.id,
      title: getTrackDisplayTitle(track) || track.name
    });
  }

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
    sendTrackToChat,
    upNext,
    playbackCommands,
    activateLibraryPanelTrack: (id) => deps.activateLibraryPanelTrack(id),
    transport
  });

  const fileInputRef: { current: HTMLInputElement | null } = { current: null };

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
    unsubscribeMultiplayerUi();
    unsubscribeMultiplayer();
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
      handleAppKeydown,
      handlePopupWindowMessage: (event) => troubadourBridge.handleMessage(event),
      togglePatterns,
      showPlayerTrackDetails,
      appShortcuts,
      workspaceShell,
      workspaceCollections,
      multiplayerController,
      multiplayerSession,
      freeplayActions,
      transport,
      miniPlayer,
      playbackProgress,
      playbackCommands,
      artworkPresentation,
      lyricsPresentation,
      patternTabPresentation,
      videoActions,
      importController,
      playCountTracker,
      renderBufferedPoll,
      panelHandlers,
      bindFileInput: (element: HTMLInputElement | null) => (fileInputRef.current = element)
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
    publish,
    dispose
  };
}
