<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { translate } from '$lib/i18n';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaybackResumeBanner from '$lib/components/PlaybackResumeBanner.svelte';
  import SharedBackdropArtwork from '$lib/components/SharedBackdropArtwork.svelte';
  import SharedBackdropVisualizer from '$lib/components/SharedBackdropVisualizer.svelte';
  import StatusToast from '$lib/components/StatusToast.svelte';
  import MultiplayerConnectionDialog from '$lib/components/multiplayer/MultiplayerConnectionDialog.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import AppWorkspace from '$lib/components/workspace/AppWorkspace.svelte';
  import MobileWorkspace from './mobile/MobileWorkspace.svelte';
  import { isMobileNavigator } from './mobile/mobile-device';
  import {
    resolveTrackLibraryNavigationTargets,
    type TrackLibraryNavigationTarget,
    type TrackLibraryNavigationTargets
  } from '$lib/services/library-navigation';
  import VideoTheater from '$lib/components/workspace/VideoTheater.svelte';
  import type {
    VideoSeekFeedback,
    WorkspacePanelHandlers
  } from '$lib/components/workspace/types';
  import {
    resolveAppBackdropPresentation,
    type AppBackdropPresentation
  } from '$lib/services/app-backdrops';
  import {
    createAppShortcuts,
    cycleWorkspaceTab as cycleWorkspaceTabs,
    closeActiveRightPanel as closeActiveRightPanelFor
  } from '$lib/services/app-shortcuts';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import {
    getTrackArtworkLoadKey,
    loadTrackArtwork,
    type LoadedStreamArtwork
  } from '$lib/services/stream-artwork';
  import { createImportController, FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import {
    createContextualTabPresentationController,
    resolvePatternTabAvailability,
    type ContextualTabAvailability
  } from '$lib/services/contextual-tab-presentation';
  import { filesystemFolders } from '$lib/services/filesystem-folders';
  import { startLibraryFolderCommandListener } from '$lib/services/library-folder-coordination';
  import { scanLaunchLibraryFolders } from '$lib/services/library-folder-scanner';
  import { appInstallService, type AppInstallState } from '$lib/services/app-install';
  import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
  import {
    createLyricsPresentationController,
    type LyricsPresentationState
  } from '$lib/services/lyrics-presentation';
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
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { windowDisplayState } from '$lib/services/window-display-state';
  import {
    NOW_PLAYING_MIN_VIEWPORT_HEIGHT,
    NOW_PLAYING_MIN_VIEWPORT_WIDTH
  } from '$lib/services/window-now-playing';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { favoritesStore, libraryStore, queueStore } from '$lib/stores/queue';
  import { libraryViewSettings } from '$lib/stores/library-view-settings';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
  import { trackSettings } from '$lib/stores/track-settings';
  import { videoSettings } from '$lib/stores/video-settings';
  import type {
    LyricsDisplayStyle,
    ModulePatternSnapshot,
    PlaybackSnapshot,
    TrackItem,
    RepeatMode,
    TrackSelection,
    VideoFitMode,
    WorkspaceCollection,
    WorkspaceTab
  } from '$lib/types';
  import type {
    UpNextPanelHandlers,
    UpNextPanelProps
  } from '$lib/components/workspace/types';
  import { upNext, type UpNextEntry } from '$lib/stores/up-next';
  import { type OptionsViewName } from './options/views';
  import { getFavoriteIdentity, getTrackDisplayTitle } from '$lib/utils/files';
  import {
    buildFreeplayLibraryContextActions,
    buildFreeplayQueueContextActions,
    favoritesHaveAllTracks
  } from '$lib/services/workspace-actions';
  import { experimentalSettings } from '$lib/stores/experimental-settings';
  import { multiplayerRecents } from '$lib/stores/multiplayer-recents';
  import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
  import { forgetMultiplayerPairing, multiplayerPairings } from '$lib/stores/multiplayer-pairings';
  import { createMultiplayerSession } from '$lib/services/multiplayer-session';
  import type {
    MultiplayerSessionController,
    MultiplayerSessionState
  } from '$lib/services/multiplayer-types';
  import { resolveMultiplayerPlayingTrackSelection } from '$lib/services/multiplayer-selection';
  import { getRemoteArtworkLoadKey, toLoadedMultiplayerArtwork } from '$lib/services/multiplayer-artwork';
  import { emptySelection } from '$lib/stores/queue-selection';
  import { createMultiplayerWindowController } from '$lib/services/multiplayer-window-controller';
  import { createFreeplayUiActions } from '$lib/services/freeplay-ui-actions';
  import {
    createWindowSelectionController,
    type RemoteSelectionSnapshot
  } from '$lib/services/main-window-selection';
  import { createVideoWindowActions } from '$lib/services/video-window-actions';
  import { createTroubadourMainWindowBridge } from '$lib/services/troubadour-main-window';
  import {
    createTransportActions,
    localizePlaybackError as localizePlaybackErrorMessage
  } from '$lib/services/transport-actions';
  import { createRenderBufferedPollController } from '$lib/services/multiplayer-render-buffered-poll';

  const {
    items: queueItemsStore,
    selectedIds: queueSelectedIdsStore,
    selectedTrack: queueSelectedTrackStore,
    shuffleEnabled: shuffleStore,
    repeatMode: repeatStore
  } = queueStore;
  const mobileMode = isMobileNavigator(typeof navigator === 'undefined' ? null : navigator);
  let mobileOptionsOpen = false;
  let mobileOptionsView: OptionsViewName | undefined = undefined;
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
  const modulePatternStore = playerController.modulePattern;
  const stopLibraryFolderCommands = startLibraryFolderCommandListener();
  const stopLoadoutRuntime = startLoadoutRuntime(playerController.currentTrack);
  setSleepTimerFiredHandler(pausePlayback);

  let localTrackItems: TrackItem[] = [];
  let localLibraryItems: TrackItem[] = [];
  let localFavoriteItems: TrackItem[] = [];
  let localUpNextEntries: UpNextEntry[] = [];
  let queueItems: TrackItem[] = [];
  let libraryItems: TrackItem[] = [];
  let favoriteItems: TrackItem[] = [];
  let localCollectionsReady = false;
  let collectionsReady = false;
  let localTrackSelectionIds: string[] = [];
  let localLibrarySelectionIds: string[] = [];
  let localLibrarySelectionAnchorId: string | null = null;
  let localFavoriteSelectionIds: string[] = [];
  let localFavoriteSelectionAnchorId: string | null = null;
  let queueSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let favoriteSelectionIds: string[] = [];
  let favoriteSelectionAnchorId: string | null = null;
  let remoteTrackSelection: TrackSelection = emptySelection;
  let remoteLibrarySelection: TrackSelection = emptySelection;
  let remoteFavoriteSelection: TrackSelection = emptySelection;
  let observedRemotePlayingTrackId: string | null = null;
  let localSelectedTrackItem: TrackItem | null = null;
  let localSelectedLibraryItem: TrackItem | null = null;
  let localSelectedFavoriteItem: TrackItem | null = null;
  let selectedTrackItem: TrackItem | null = null;
  let selectedLibraryItem: TrackItem | null = null;
  let selectedFavoriteItem: TrackItem | null = null;
  let selectedItem: TrackItem | null = null;
  let livePlayingTrack: TrackItem | null = null;
  let playerDisplayTrack: TrackItem | null = null;
  let favoriteTargetTrack: TrackItem | null = null;
  let lyricsTrack: TrackItem | null = null;
  let detailsLibraryTargets: TrackLibraryNavigationTargets = {};
  let localPlayingTrack: TrackItem | null = null;
  let playingTrack: TrackItem | null = null;
  let videoParkingHost: HTMLDivElement | null = null;
  let localShuffleEnabled = false;
  let localRepeatMode: RepeatMode = 'off';
  let shuffleEnabled = false;
  let repeatMode: RepeatMode = 'off';
  let localPlaybackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };
  let playbackStatus = localPlaybackStatus;
  let localPlaybackSnapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_PLAYER_VOLUME,
    muted: false,
    backend: null,
    error: undefined
  };
  let playbackSnapshot = localPlaybackSnapshot;
  const displayPlaybackSnapshotStore = writable<PlaybackSnapshot>(localPlaybackSnapshot);
  const mediaSessionArtworkOverrideStore = writable<LoadedStreamArtwork | null | undefined>(undefined);
  const multiplayerClientMediaSessionStore = writable(false);
  let multiplayerState: MultiplayerSessionState = {
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostVersion: null,
    freeplayPaired: false,
    freeplay: false,
    freeplayQueue: [],
    clients: [],
    remoteCatalog: {
      revision: 0,
      queue: [],
      library: [],
      favorites: [],
      shuffleEnabled: false,
      repeatMode: 'off'
    },
    remotePlayback: {
      generationId: 'idle',
      snapshot: localPlaybackSnapshot,
      track: null,
      sentAt: 0
    },
    remoteArtwork: null,
    remoteArtworkResolvedTrackKey: '',
    audioStatus: 'idle',
    remoteDelivery: {
      generationId: 'idle',
      trackId: null,
      mode: 'none',
      reason: 'host-disabled'
    },
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    receiveAudio: true,
    connectionStats: null,
    connectionDetail: null,
    message: null
  };
  let multiplayerToastMessage: string | null = null;
  let multiplayerConnectionDialogOpen = false;
  let multiplayerConnectionDialogError: string | null = null;
  let multiplayerConnectionOperation: 'hosting' | 'joining' = 'joining';
  let multiplayerConnectionTargetName: string | null = null;
  let isMultiplayerClient = false;
  let isFreeplayClient = false;
  let isSourceFileFreeplayClient = false;
  let multiplayerShutdownRequested = false;
  let modulePatternSnapshot: ModulePatternSnapshot = {
    trackId: null,
    song: null,
    order: 0,
    pattern: 0,
    row: 0
  };
  let patternAvailability: ContextualTabAvailability = 'unavailable';
  let playbackProgressState: PlaybackProgressState = { notice: null };
  let miniPlayerState: MiniPlayerState = {
    supported: false,
    active: false,
    opening: false
  };
  const miniPlayerTrack = writable<TrackItem | null>(null);
  const miniPlayerSelectedTrack = writable<TrackItem | null>(null);
  const miniPlayerArtworkUrl = writable<string | null>(null);

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  let innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  let previousPlaybackState: PlaybackSnapshot['state'] = playbackStatus.state;
  let nowPlayingViewActive = appearanceSettings.getSnapshot().nowPlayingViewActive;
  let isAutomaticNowPlayingEligible = false;
  let autoNowPlayingSuppressed = false;
  let isNowPlayingViewportEligible = false;
  let isNowPlayingLayoutActive = false;
  let isNowPlayingChromeHidden = false;
  let isFullscreenNowPlayingChromeHidden = false;
  let videoTrackActive = false;
  let videoTheaterActive = false;
  let videoTheaterControlsHidden = false;
  let isFullscreenVideoTheater = false;
  let videoFullscreenExitAction = false;
  let videoPictureInPictureSupported = false;
  let videoSeekFeedback: VideoSeekFeedback | null = null;
  let videoTheaterChromeInset = 0;
  let videoTheaterTopInset = 0;
  let topMenuBarHeight = 0;
  let documentTitle = 'izci';
  let effectiveLyricsDisplayStyle: LyricsDisplayStyle = 'timestamped';
  let lyricsAutoScroll = true;
  let lyricsFontSize = appearanceSettings.getSnapshot().lyrics.fontSizes.timestamped;
  let lyricsResumeAutoScrollToken = 0;
  let lyricsPresentationState: LyricsPresentationState = {
    availability: 'unknown',
    trackKey: '',
    resumeAutoScrollToken: 0
  };
  let renderBufferedRanges: Array<[number, number]> | null = null;
  let renderPipelineBuffering = false;

  const getRemoteSelections = (): RemoteSelectionSnapshot => ({
    track: remoteTrackSelection,
    library: remoteLibrarySelection,
    favorites: remoteFavoriteSelection
  });
  const setRemoteSelections = (selections: RemoteSelectionSnapshot): void => {
    remoteTrackSelection = selections.track;
    remoteLibrarySelection = selections.library;
    remoteFavoriteSelection = selections.favorites;
  };

  const windowSelection = createWindowSelectionController({
    getIsMultiplayerClient: () => isMultiplayerClient,
    getQueueItems: () => queueItems,
    getLibraryItems: () => libraryItems,
    getFavoriteItems: () => favoriteItems,
    getRemoteSelections,
    setRemoteSelections,
    getActiveView: () => $libraryViewSettings.activeView,
    focusCollection: (collection) => workspaceShell.focusCollection(collection),
    selectTrack: (collection, id, options) => workspaceShell.selectTrack(collection, id, options),
    setCollectionSelection: (collection, selection) =>
      workspaceShell.setCollectionSelection(collection, selection)
  });
  const workspaceShell = createWorkspaceShellController({
    getQueueContextActions: (ids) => isFreeplayClient
      ? buildFreeplayQueueContextActions(queueItems, libraryItems, ids)
      : workspaceCollections.getQueueContextActions(ids),
    getLibraryContextActions: (ids) => isFreeplayClient
      ? buildFreeplayLibraryContextActions(
          libraryViewSettings.getSnapshot().activeView === 'favorites' ? favoriteItems : libraryItems,
          libraryItems,
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
  let workspaceShellState = workspaceShell.getSnapshot();
  const workspaceCollections = createWorkspaceCollectionsController({
    getState: () => ({
      queueItems,
      libraryItems,
      favoriteItems,
      queueSelectionIds,
      librarySelectionIds,
      favoriteSelectionIds,
      playingTrack
    }),
    handlers: {
      focusCollection: (collection) => workspaceShell.focusCollection(collection),
      selectTrack: (collection, id) => workspaceShell.selectTrack(collection, id),
      showTrackDetails: () => workspaceShell.showTrackDetails(),
      showTrackLyrics: () => workspaceShell.showTrackLyrics(),
      showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
      playQueue: () => playPlayback()
    }
  });
  const lyricsPresentation = createLyricsPresentationController({
    getWorkspaceState: () => workspaceShellState,
    showTrackLyrics: () => workspaceShell.showTrackLyrics(),
    closeTrackLyrics: () => workspaceShell.closeTrackLyrics(),
    setActiveWorkspaceTab: (tab) => workspaceShell.setActiveWorkspaceTab(tab)
  });
  const patternTabPresentation = createContextualTabPresentationController({
    isVisible: () => workspaceShellState.isPatternsPanelVisible,
    show: () => workspaceShell.showWorkspaceTab('patterns'),
    close: () => workspaceShell.closeWorkspaceTab('patterns')
  });
  const playbackProgress = createPlaybackProgressController({
    track: playerController.currentTrack,
    snapshot: playerController.snapshot
  });
  const playbackCommands = createPlaybackCommandsController({
    getPlayingTrack: () => playingTrack,
    getSelectedQueueTrack: () => selectedTrackItem,
    getPlaybackState: () => playbackStatus.state,
    getPlaybackCurrentTime: () => playbackSnapshot.currentTime,
    getPlaybackDuration: () => playbackSnapshot.duration,
    shouldRestartCurrentTrackOnPrevious: () => $playbackSettings.restartCurrentTrackOnPrevious,
    getTransitionMode: () => $playbackSettings.transitionMode,
    getGaplessPlaybackEnabled: () => $playbackSettings.gaplessPlayback,
    getFadeDurationSeconds: () => $playbackSettings.fadeDurationSeconds,
    getManualTrackChangeFadePercent: () => $playbackSettings.manualTrackChangeFadePercent,
    getShuffleEnabled: () => shuffleEnabled,
    getRepeatMode: () => repeatMode,
    getTrackById: (collection, id) =>
      (collection === 'library' ? libraryItems : queueItems).find((item) => item.id === id) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems: workspaceCollections.cleanupRemovedItems,
    resolveResumePosition: (track) => playbackProgress.resolveResumePosition(track),
    notifyTrackResumed: (track, currentTime) =>
      playbackProgress.showResumeNotice(track, currentTime),
    getStopAfterCurrentTrack: () => $playbackSettings.stopAfterTrack,
    clearStopAfterCurrentTrack: () => playbackSettings.update({ stopAfterTrack: false }),
    getActiveLoopRange: () => resolveAbLoopRange(abLoop.getSnapshot())
  });
  let multiplayerSession: MultiplayerSessionController;
  const multiplayerController = createMultiplayerWindowController({
    getSession: () => multiplayerSession,
    getPlaybackCommands: () => playbackCommands,
    getPlayingTrack: () => playingTrack,
    getPlaybackSnapshot: () => playbackSnapshot,
    getQueueItems: () => queueItems,
    getLibraryItems: () => libraryItems,
    getFavoriteItems: () => favoriteItems,
    seek: seekPlayback,
    toggleQueueShuffle: () => queueStore.toggleShuffle(),
    cycleQueueRepeat: () => queueStore.cycleRepeatMode(),
    getExperimentalSettings: () => experimentalSettings.getSnapshot(),
    getLastSession: () => multiplayerLastSession.getSnapshot(),
    getPairings: () => multiplayerPairings.getSnapshot(),
    pausePlayer: () => playerController.pause(),
    setActiveWorkspaceTab: (tab) => workspaceShell.setActiveWorkspaceTab(tab),
    getRemoteSelections,
    setRemoteSelections,
    translate,
  });
  multiplayerSession = createMultiplayerSession({
    handleHostCommand: (command) => multiplayerController.handleHostCommand(command),
    pauseHostPlayback: () => playbackCommands.pause(),
    resumeHostPlayback: () => { void playbackCommands.play(); }
  });
  multiplayerController.prepareLaunchDialog();
  multiplayerState = multiplayerSession.getSnapshot();
  const unsubscribeMultiplayerUi = multiplayerController.subscribe((ui) => {
    multiplayerConnectionDialogOpen = ui.dialog.open;
    multiplayerConnectionDialogError = ui.dialog.error;
    multiplayerConnectionOperation = ui.dialog.operation;
    multiplayerConnectionTargetName = ui.dialog.targetName;
    multiplayerToastMessage = ui.toastMessage;
  });
  const unsubscribeMultiplayer = multiplayerSession.subscribe((value) => {
    multiplayerState = value;
    const update = multiplayerController.syncFromSession(value);
    if (update.enteredFreeplay) workspaceShell.setActiveWorkspaceTab('library');
    if (update.remoteSelections) {
      remoteTrackSelection = update.remoteSelections.track;
      remoteLibrarySelection = update.remoteSelections.library;
      remoteFavoriteSelection = update.remoteSelections.favorites;
    }
  });
  const freeplayActions = createFreeplayUiActions({
    getIsFreeplayClient: () => isFreeplayClient,
    getFreeplayQueue: () => multiplayerState.freeplayQueue,
    setFreeplayQueue: (ids) => multiplayerSession.setFreeplayQueue(ids),
    sendCommand: (command) => multiplayerSession.sendCommand(command),
    getShuffleEnabled: () => multiplayerState.remoteCatalog.shuffleEnabled,
    getQueueItems: () => queueItems,
    getLibraryItems: () => libraryItems,
    getFavoriteItems: () => favoriteItems,
    getActiveView: () => $libraryViewSettings.activeView,
    showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
    showTrackDetails: () => workspaceShell.showTrackDetails(),
    activateTrack: (collection, id) => multiplayerController.activateTrack(collection, id)
  });
  const videoActions = createVideoWindowActions({
    getVideoTrackActive: () => videoTrackActive,
    getTheaterActive: () => videoTheaterActive,
    setTheaterActive: (active) => (videoTheaterActive = active),
    setTheaterControlsHidden: (hidden) => (videoTheaterControlsHidden = hidden),
    getIsNowPlayingLayoutActive: () => isNowPlayingLayoutActive,
    getIsAutomaticNowPlayingEligible: () => isAutomaticNowPlayingEligible,
    getAutoNowPlayingSuppressed: () => autoNowPlayingSuppressed,
    setAutoNowPlayingSuppressed: (value) => (autoNowPlayingSuppressed = value),
    getWindowDisplayState: () => ({
      maximized: $windowDisplayState.maximized,
      fullscreen: $windowDisplayState.fullscreen
    }),
    mobileMode,
    showVideoTab: () => workspaceShell.showWorkspaceTab('video'),
    closeVideoTab: () => workspaceShell.closeWorkspaceTab('video')
  });
  const transport = createTransportActions({
    getPlaybackCommands: () => playbackCommands,
    getMultiplayerSession: () => multiplayerSession,
    getPlaybackSnapshot: () => playbackSnapshot,
    getPlayingTrack: () => playingTrack,
    getIsMultiplayerClient: () => isMultiplayerClient,
    getIsSourceFileFreeplayClient: () => isSourceFileFreeplayClient,
    getVideoTrackActive: () => videoTrackActive,
    setVideoSeekFeedback: (feedback) => (videoSeekFeedback = feedback),
    resumeLyricsAutoScroll: () => lyricsPresentation.resumeAutoScroll(),
    getPlaybackProgress: () => playbackProgress,
    getResumeNotice: () => playbackProgressState.notice
  });
  const troubadourBridge = createTroubadourMainWindowBridge({
    getPlayingTrack: () => playingTrack,
    getQueueItems: () => queueItems,
    getLibraryItems: () => libraryItems,
    getFavoriteItems: () => favoriteItems,
    getQueueSelectionIds: () => queueSelectionIds,
    getLibrarySelectionIds: () => librarySelectionIds,
    getFavoriteSelectionIds: () => favoriteSelectionIds,
    getPlaybackStatus: () => playbackStatus,
    getPlaybackSnapshot: () => playbackSnapshot,
    loadTrack: (track, options) => playerController.load(track, options),
    refreshCurrentTrack: (id, patch) => playerController.refreshCurrentTrack(id, patch),
    getTroubadourWindow: () => windowManager.getPopup('troubadour'),
    showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
    openOptions: (view) => windowManager.openOptions(view)
  });
  const renderBufferedPoll = createRenderBufferedPollController((ranges, buffering) => {
    renderBufferedRanges = ranges;
    renderPipelineBuffering = buffering;
  });
  const miniPlayer = createMiniPlayerController({
    snapshot: playerController.snapshot,
    track: miniPlayerTrack,
    selectedTrack: miniPlayerSelectedTrack,
    artworkUrl: miniPlayerArtworkUrl,
    handlers: {
      togglePlayback,
      previousTrack: () => stepTrack(-1),
      nextTrack: () => stepTrack(1),
      seek: seekPlayback,
      setVolume: setPlayerVolume,
      toggleMute: togglePlayerMute,
      enterNowPlaying: () => {
        if (!isNowPlayingLayoutActive) {
          toggleNowPlayingView();
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
    getQueueTrack: (id) => queueItems.find((item) => item.id === id) ?? null,
    ensureLoaded: (id) => queueStore.ensureLoaded(id),
    selectTrack: (id) => workspaceShell.selectTrack('queue', id),
    loadTrack: (track, options) => playerController.load(track, options)
  });
  let playbackCommandsState = playbackCommands.getSnapshot();
  const artworkPresentation = createArtworkPresentationController({
    resolveTrackSnapshot: (track) =>
      resolveTrackSnapshot(track, selectedItem, queueItems, libraryItems),
    isPlaybackDetailsPending: (trackId) =>
      playbackCommandsState.pendingPlaybackTrackId === trackId || playingTrack?.id === trackId,
    loadArtwork: (track) => multiplayerState.mode === 'client'
      ? Promise.resolve(toLoadedMultiplayerArtwork(track, multiplayerState.remoteArtwork))
      : loadTrackArtwork(track),
    getArtworkLoadKey: (track) => multiplayerState.mode === 'client'
      ? getRemoteArtworkLoadKey(
          track,
          multiplayerState.remoteArtwork,
          multiplayerState.remoteArtworkResolvedTrackKey
        )
      : getTrackArtworkLoadKey(track)
  });
  let artworkPresentationState = artworkPresentation.getSnapshot();
  let backdropPresentation: AppBackdropPresentation;
  let appInstallState: AppInstallState = { available: false, showHint: false };
  const unsubscribeTrackItems = queueItemsStore.subscribe((value) => (localTrackItems = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (localLibraryItems = value));
  const unsubscribeFavoriteItems = favoriteItemsStore.subscribe((value) => (localFavoriteItems = value));
  void Promise.all([queueStore.ready(), libraryStore.ready(), favoritesStore.ready()]).then(async () => {
    localCollectionsReady = true;
    void scanLaunchLibraryFolders();
    await playbackRestoration.restore();
    void multiplayerController.startLaunch();
  });
  const unsubscribeQueueSelectedIds = queueSelectedIdsStore.subscribe(
    (value) => (localTrackSelectionIds = value)
  );
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe(
    (value) => (localLibrarySelectionIds = value)
  );
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe(
    (value) => (localLibrarySelectionAnchorId = value.anchorId)
  );
  const unsubscribeFavoriteSelectedIds = favoriteSelectedIdsStore.subscribe(
    (value) => (localFavoriteSelectionIds = value)
  );
  const unsubscribeFavoriteSelection = favoriteSelectionStore.subscribe(
    (value) => (localFavoriteSelectionAnchorId = value.anchorId)
  );
  const unsubscribeQueueSelectedTrack = queueSelectedTrackStore.subscribe(
    (value) => (localSelectedTrackItem = value)
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => (localSelectedLibraryItem = value)
  );
  const unsubscribeFavoriteSelectedTrack = favoriteSelectedTrackStore.subscribe(
    (value) => (localSelectedFavoriteItem = value)
  );
  const unsubscribeShuffle = shuffleStore.subscribe((value) => (localShuffleEnabled = value));
  const unsubscribeRepeat = repeatStore.subscribe((value) => (localRepeatMode = value));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    localPlayingTrack = value;
    syncPlayingTrackMetadata(value, {
      isMultiplayerClient,
      libraryItems: localLibraryItems,
      favoriteItems: localFavoriteItems,
      notifyCurrentTrackChanged: (track) => playbackCommands.notifyCurrentTrackChanged(track)
    });
  });
  const unsubscribeUpNext = upNext.subscribe((value) => {
    localUpNextEntries = value;
  });
  const unsubscribePlaybackSnapshot = playerController.snapshot.subscribe((value) => {
    localPlaybackSnapshot = value;
    if (value.state === 'playing') appInstallService.markEngaged();
    if (multiplayerState.mode !== 'client') {
      void playbackCommands.handlePlaybackProgress();
    }
  });
  const unsubscribePlaybackStatus = playerController.status.subscribe((value) => (localPlaybackStatus = value));
  const unsubscribeWorkspaceShell = workspaceShell.subscribe((value) => (workspaceShellState = value));
  const unsubscribePlaybackCommands = playbackCommands.subscribe(
    (value) => (playbackCommandsState = value)
  );
  const unsubscribePlaybackProgress = playbackProgress.subscribe(
    (value) => (playbackProgressState = value)
  );
  const unsubscribeArtworkPresentation = artworkPresentation.subscribe(
    (value) => (artworkPresentationState = value)
  );
  const unsubscribeLyricsPresentation = lyricsPresentation.subscribe(
    (value) => (lyricsPresentationState = value)
  );
  const unsubscribeAppInstall = appInstallService.subscribe((value) => (appInstallState = value));
  const unsubscribeMiniPlayer = miniPlayer.subscribe((value) => (miniPlayerState = value));

  const importController = createImportController({
    addFiles: (files, target) => workspaceCollections.handleAddFiles(files, target),
    clickFileInput: () => fileInput?.click(),
    getOpenFilePickerDescription: () =>
      $t('main.import.supportedMediaFiles', { default: 'Supported media files' })
  });
  const appShortcuts = createAppShortcuts({
    getState: () => ({
      isNowPlayingLayoutActive,
      videoTrackActive,
      isRightPanelVisible: workspaceShellState.isRightPanelVisible,
      activeCollection: workspaceShellState.activeCollection,
      queueSelectionIds,
      librarySelectionIds: $libraryViewSettings.activeView === 'favorites' ? favoriteSelectionIds : librarySelectionIds,
      selectedTrackItem,
      selectedLibraryItem: $libraryViewSettings.activeView === 'favorites' ? selectedFavoriteItem : selectedLibraryItem,
      playingTrack,
      playbackSnapshot
    }),
    handlers: {
      toggleFullscreenPresentation,
      closeNowPlayingView,
      closeActiveRightPanel,
      removeTrackItems: (ids) => {
        if (isFreeplayClient) {
          removeFromFreeplayQueue(ids);
          return;
        }
        if (!isMultiplayerClient) workspaceCollections.removeTrackItems(ids);
      },
      removeLibraryItems: (ids) =>
        isMultiplayerClient
          ? undefined
          : $libraryViewSettings.activeView === 'favorites'
          ? workspaceCollections.handleFavoriteContextAction('remove-favorite', ids)
          : workspaceCollections.removeLibraryItems(ids),
      cycleWorkspaceTab,
      seek: seekPlayback,
      stepTrack,
      setVolume: setPlayerVolume,
      activateQueueTrack: (id) => {
        if (multiplayerController.activateTrack('queue', id)) return;
        return playbackCommands.activateQueueTrack(id);
      },
      activateLibraryTrack: (id) => activateLibraryPanelTrack(id),
      togglePlayback,
      toggleMute: togglePlayerMute,
      selectAllTracks: (collection) =>
        collection === 'library' && $libraryViewSettings.activeView === 'favorites'
          ? windowSelection.selectAllFavorites()
          : workspaceShell.selectAllTracks(collection),
      openFiles: () => { if (!isMultiplayerClient) void handleMenuOpenFiles(); },
      openOptions: () => handleOpenOptions(),
      toggleMiniPlayer: () => miniPlayer.toggle(),
      exit: () => windowManager.exit()
    }
  });
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) =>
    void playbackCommands.importLaunchedFiles(files, $trackSettings.associatedFileAction)
  );
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: displayPlaybackSnapshotStore,
    track: miniPlayerTrack,
    settings: playbackSettings,
    artworkOverride: mediaSessionArtworkOverrideStore,
    transportAnchorActive: multiplayerClientMediaSessionStore,
    handlers: {
      play: playPlayback,
      pause: pausePlayback,
      stop: stopPlayback,
      previousTrack: () => stepTrack(-1),
      nextTrack: () => stepTrack(1),
      seekTo: seekPlayback
    }
  });

  $: isMultiplayerClient = multiplayerState.mode === 'client';
  $: isFreeplayClient = isMultiplayerClient && multiplayerState.freeplay;
  $: isSourceFileFreeplayClient = isFreeplayClient
    && multiplayerState.remoteDelivery.mode === 'source-file';
  $: multiplayerConnectionFailed = multiplayerConnectionDialogError !== null
    || multiplayerState.connectionStatus === 'error'
    || multiplayerState.connectionStatus === 'disconnected';
  $: multiplayerConnectionResolvedTarget = multiplayerState.hostName
    ?? multiplayerConnectionTargetName;
  $: multiplayerConnectionNotice = multiplayerConnectionFailed
    ? $t('main.multiplayer.connectionNoticeFailed', { default: 'Connection failed' })
    : multiplayerConnectionOperation === 'hosting'
      ? $t('main.multiplayer.startingHost', { default: 'Starting multiplayer host' })
      : multiplayerConnectionResolvedTarget
        ? $t('main.multiplayer.connectingTo', {
            default: 'Connecting to {name}',
            values: { name: multiplayerConnectionResolvedTarget }
          })
        : $t('main.multiplayer.connectingToHost', { default: 'Connecting to host' });
  $: multiplayerConnectionStatusLine = multiplayerConnectionDialogError
    ?? multiplayerState.connectionDetail
    ?? multiplayerState.message
    ?? (multiplayerState.audioStatus === 'blocked'
      ? $t('main.multiplayer.audio.blocked', { default: 'Audio needs permission' })
      : null)
    ?? (multiplayerConnectionOperation === 'hosting'
      ? $t('main.multiplayer.preparingRoom', { default: 'Preparing the signaling room...' })
      : $t('main.multiplayer.preparingConnection', { default: 'Preparing the connection...' }));
  $: queueItems = isMultiplayerClient ? multiplayerState.remoteCatalog.queue : localTrackItems;
  $: libraryItems = isMultiplayerClient ? multiplayerState.remoteCatalog.library : localLibraryItems;
  $: favoriteItems = isMultiplayerClient ? multiplayerState.remoteCatalog.favorites : localFavoriteItems;
  $: collectionsReady = isMultiplayerClient
    ? multiplayerState.connectionStatus === 'connected' && multiplayerState.remoteCatalog.revision > 0
    : localCollectionsReady;
  $: queueSelectionIds = isMultiplayerClient
    ? remoteTrackSelection.ids
    : localTrackSelectionIds;
  $: librarySelectionIds = isMultiplayerClient
    ? remoteLibrarySelection.ids
    : localLibrarySelectionIds;
  $: librarySelectionAnchorId = isMultiplayerClient
    ? remoteLibrarySelection.anchorId
    : localLibrarySelectionAnchorId;
  $: favoriteSelectionIds = isMultiplayerClient
    ? remoteFavoriteSelection.ids
    : localFavoriteSelectionIds;
  $: favoriteSelectionAnchorId = isMultiplayerClient
    ? remoteFavoriteSelection.anchorId
    : localFavoriteSelectionAnchorId;
  $: selectedTrackItem = isMultiplayerClient
    ? queueItems.find((item) => item.id === (remoteTrackSelection.focusId ?? remoteTrackSelection.ids.at(-1))) ?? null
    : localSelectedTrackItem;
  $: selectedLibraryItem = isMultiplayerClient
    ? libraryItems.find((item) => item.id === (remoteLibrarySelection.focusId ?? remoteLibrarySelection.ids.at(-1))) ?? null
    : localSelectedLibraryItem;
  $: selectedFavoriteItem = isMultiplayerClient
    ? favoriteItems.find((item) => item.id === (remoteFavoriteSelection.focusId ?? remoteFavoriteSelection.ids.at(-1))) ?? null
    : localSelectedFavoriteItem;
  $: playingTrack = isMultiplayerClient ? multiplayerState.remotePlayback.track : localPlayingTrack;
  $: if (!isMultiplayerClient && queueItems.length > 0) {
    upNext.prune(queueItems.map((item) => item.id));
  }
  $: upNextDisplayItems = localUpNextEntries
    .flatMap((entry) => {
      const item = queueItems.find((candidate) => candidate.id === entry.id);
      return item ? [item] : [];
    });
  $: upNextPanelProps = {
    items: upNextDisplayItems,
    playingId: playingTrack?.id ?? null,
    getContextMenuActions: (ids: string[]) =>
      isFreeplayClient || isMultiplayerClient
        ? [{ id: 'remove-from-up-next', label: 'Remove from up next', icon: 'remove' }]
        : workspaceCollections.getUpNextContextActions(ids)
  } satisfies UpNextPanelProps;
  $: {
    const selectionSync = resolveMultiplayerPlayingTrackSelection(
      observedRemotePlayingTrackId,
      isMultiplayerClient ? playingTrack?.id ?? null : null,
      queueItems
    );
    observedRemotePlayingTrackId = selectionSync.observedTrackId;
    if (isMultiplayerClient && selectionSync.selection) {
      workspaceShell.setCollectionSelection('queue', selectionSync.selection);
    }
  }
  $: isRenderDeliveryClient = isMultiplayerClient
    && !isSourceFileFreeplayClient
    && multiplayerState.remoteDelivery.mode === 'render';
  $: if (isRenderDeliveryClient) {
    renderBufferedPoll.start();
  } else {
    renderBufferedPoll.stop();
  }
  $: playbackSnapshot = isMultiplayerClient && !isSourceFileFreeplayClient
    ? {
        ...multiplayerState.remotePlayback.snapshot,
        // The render pipeline's own loading (generation in flight: host
        // render + transfer, initial download, rebuffers) surfaces as the
        // loading state so the player bar shows the throbber; the host
        // snapshot alone reads 'idle'/'playing' through both phases. A
        // reported error wins over loading so failures are never masked.
        state: isRenderDeliveryClient && renderPipelineBuffering
          && multiplayerState.remotePlayback.snapshot.state !== 'error'
          ? 'loading'
          : multiplayerState.remotePlayback.snapshot.state,
        volume: localPlaybackSnapshot.volume,
        muted: localPlaybackSnapshot.muted,
        buffered: isRenderDeliveryClient ? renderBufferedRanges ?? undefined : undefined
      }
    : localPlaybackSnapshot;
  $: playbackStatus = isMultiplayerClient && !isSourceFileFreeplayClient
    ? {
        state: playbackSnapshot.state,
        volume: playbackSnapshot.volume,
        backend: playbackSnapshot.backend,
        error: playbackSnapshot.error
      }
    : localPlaybackStatus;
  $: shuffleEnabled = isMultiplayerClient
    ? multiplayerState.remoteCatalog.shuffleEnabled
    : localShuffleEnabled;
  $: repeatMode = isMultiplayerClient
    ? multiplayerState.remoteCatalog.repeatMode
    : localRepeatMode;
  $: displayPlaybackSnapshotStore.set(playbackSnapshot);
  $: multiplayerClientMediaSessionStore.set(isMultiplayerClient);

  $: selectedItem =
    workspaceShellState.activeCollection === 'library'
      ? $libraryViewSettings.activeView === 'favorites' ? selectedFavoriteItem : selectedLibraryItem
      : selectedTrackItem;
  $: livePlayingTrack = resolveTrackSnapshot(playingTrack, selectedItem, queueItems, libraryItems);
  $: playerDisplayTrack = livePlayingTrack;
  $: miniPlayerTrack.set(playerDisplayTrack);
  $: miniPlayerSelectedTrack.set(selectedTrackItem);
  $: miniPlayerArtworkUrl.set(artworkPresentationState.displayedArtwork?.url ?? null);
  $: mediaSessionArtworkOverrideStore.set(isMultiplayerClient
    ? toLoadedMultiplayerArtwork(playerDisplayTrack, multiplayerState.remoteArtwork)
    : undefined);
  $: videoTrackActive = !isMultiplayerClient && playerDisplayTrack?.kind === 'video';
  $: videoPictureInPictureSupported =
    videoTrackActive && playerController.videoPictureInPictureSupported;
  $: syncVideoWindowSize(videoTrackActive, $videoSettings.autoResizeWindow);
  $: syncVideoPresentation(isMultiplayerClient ? null : playerDisplayTrack, $videoSettings.autoEnterTheater);
  $: if (videoTrackActive && $windowDisplayState.fullscreen && !videoTheaterActive) {
    videoTheaterActive = true;
  }
  $: isFullscreenVideoTheater =
    videoTrackActive && videoTheaterActive && $windowDisplayState.fullscreen;
  $: videoFullscreenExitAction =
    isFullscreenVideoTheater &&
    typeof document !== 'undefined' &&
    Boolean(document.fullscreenElement);
  $: videoTheaterChromeInset = $windowControlsOverlayState.visible
    ? Math.max(
        0,
        $windowControlsOverlayState.titlebarAreaRect.y +
          $windowControlsOverlayState.titlebarAreaRect.height
      )
    : topMenuBarHeight;
  $: videoTheaterTopInset = isFullscreenVideoTheater ? 0 : videoTheaterChromeInset;
  $: favoriteTargetTrack = playerDisplayTrack?.kind === 'module' && playbackSnapshot.subsong !== undefined
    ? { ...playerDisplayTrack, subsong: playbackSnapshot.subsong }
    : playerDisplayTrack;
  $: lyricsTrack = livePlayingTrack;
  $: modulePatternSnapshot = $modulePatternStore;
  $: patternAvailability = resolvePatternTabAvailability(
    isMultiplayerClient ? null : playingTrack,
    modulePatternSnapshot,
    playbackStatus.state
  );
  $: nowPlayingViewActive = $appearanceSettings.nowPlayingViewActive;
  $: isAutomaticNowPlayingEligible =
    $appearanceSettings.autoNowPlayingOnMaximized && $windowDisplayState.prefersNowPlaying;
  $: if (!isAutomaticNowPlayingEligible) {
    autoNowPlayingSuppressed = false;
  }
  $: isNowPlayingViewportEligible =
    mobileMode || (
      innerWidth >= NOW_PLAYING_MIN_VIEWPORT_WIDTH &&
      innerHeight >= NOW_PLAYING_MIN_VIEWPORT_HEIGHT
    );
  $: isNowPlayingLayoutActive =
    (nowPlayingViewActive || (isAutomaticNowPlayingEligible && !autoNowPlayingSuppressed)) &&
    isNowPlayingViewportEligible &&
    playerDisplayTrack?.kind !== 'video';
  $: isFullscreenNowPlayingChromeHidden =
    isNowPlayingLayoutActive && $windowDisplayState.fullscreen && isNowPlayingChromeHidden;
  $: if (!isNowPlayingLayoutActive || !$windowDisplayState.fullscreen) {
    isNowPlayingChromeHidden = false;
  }
  $: effectiveLyricsDisplayStyle =
    isNowPlayingLayoutActive && $appearanceSettings.lyrics.autoTheaterInNowPlaying
      ? 'theater'
      : $appearanceSettings.lyrics.displayStyle;
  $: {
    lyricsPresentationState;
    workspaceShellState;
    lyricsPresentation.sync({
      track: lyricsTrack,
      isNowPlayingLayoutActive,
      autoFocusInNowPlaying: $appearanceSettings.lyrics.autoFocusInNowPlaying,
      displayStyle: effectiveLyricsDisplayStyle,
      automation: $appearanceSettings.contextualTabs.lyrics
    });
  }
  $: patternTabPresentation.sync({
    key: playingTrack?.id ?? '',
    availability: patternAvailability,
    automation: $appearanceSettings.contextualTabs.patterns
  });
  $: lyricsResumeAutoScrollToken = lyricsPresentationState.resumeAutoScrollToken;
  $: lyricsAutoScroll = effectiveLyricsDisplayStyle === 'theater' || $appearanceSettings.lyrics.autoScroll;
  $: lyricsFontSize = $appearanceSettings.lyrics.fontSizes[effectiveLyricsDisplayStyle];
  $: backdropPresentation = resolveAppBackdropPresentation({
    isNowPlayingLayoutActive,
    workspaceState: workspaceShellState,
    backdropZones: $appearanceSettings.backdropZones,
    backdropZoneArtwork: $appearanceSettings.backdropZoneArtwork,
    hasVisibleArtworkBackground: Boolean(artworkPresentationState.visibleArtworkBackground),
    artworkBackgroundAnalysis: artworkPresentationState.artworkBackgroundAnalysis,
    windowControlsOverlay: $windowControlsOverlayState,
    innerWidth,
    innerHeight
  });
  $: documentTitle =
    $appearanceSettings.showTrackTitleInWindowTitle && livePlayingTrack
      ? getTrackDisplayTitle(livePlayingTrack)
      : 'izci';
  $: playCountTracker.sync({
    track: isMultiplayerClient ? null : playingTrack,
    playbackState: isMultiplayerClient ? 'idle' : playbackStatus.state,
    libraryItems: isMultiplayerClient ? localLibraryItems : libraryItems,
    thresholdSeconds: $metadataSettings.playCountThresholdSeconds
  });
  $: workspaceShell.sync({
    innerWidth,
    queueItems,
    libraryItems,
    favoriteItems,
    queueSelectionIds,
    librarySelectionIds,
    librarySelectionAnchorId,
    favoriteSelectionIds,
    favoriteSelectionAnchorId,
    favoritePlayingId: favoriteTargetTrack
      ? favoriteItems.find((item) => getFavoriteIdentity(item) === getFavoriteIdentity(favoriteTargetTrack!))?.id ?? null
      : null,
    playingTrackId: playingTrack?.id ?? null,
    shuffleEnabled,
    repeatMode,
    keepEmptyWorkspacePanelsOpen: $appearanceSettings.keepEmptyWorkspacePanelsOpen,
    readOnly: isMultiplayerClient && !isFreeplayClient
  });
  $: multiplayerSession.updateHostState({
    queue: localTrackItems,
    library: localLibraryItems,
    favorites: localFavoriteItems,
    shuffleEnabled: localShuffleEnabled,
    repeatMode: localRepeatMode,
    playback: localPlaybackSnapshot,
    track: localPlayingTrack
  });
  $: if ($experimentalSettings.multiplayer || multiplayerState.mode === 'idle') {
    multiplayerShutdownRequested = false;
  } else if (!multiplayerShutdownRequested) {
    multiplayerShutdownRequested = true;
    void (multiplayerState.mode === 'hosting'
      ? multiplayerSession.stopHosting()
      : multiplayerSession.leave());
  }
  $: {
    artworkPresentation.syncSelection(
      selectedItem,
      queueSelectionIds.length > 0 || librarySelectionIds.length > 0 || favoriteSelectionIds.length > 0
    );
    void artworkPresentation.syncDetailsDisplay();
  }
  $: void artworkPresentation.syncDisplayedArtwork(playerDisplayTrack);
  $: detailsLibraryTargets = resolveTrackLibraryNavigationTargets(
    artworkPresentationState.detailsDisplayTrack,
    libraryItems
  );
  $: void artworkPresentation.syncArtworkBrightness(
    artworkPresentationState.visibleArtworkBackground,
    backdropPresentation.isArtworkBackdropRequested
  );
  $: artworkPresentation.syncArtworkMenuClasses(
    false,
    false
  );
  $: artworkPresentation.setWindowControlsOverlayVisible($windowControlsOverlayState.visible);

  const queuePanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => { if (!isMultiplayerClient) workspaceCollections.handleAddFiles(files, 'queue'); },
    addFolders: (handles) => { if (!isMultiplayerClient) void filesystemFolders.rememberMany(handles); },
    openFiles: () => { if (!isMultiplayerClient) void handleMenuOpenFiles('queue'); },
    select: (event) => handleSelect('queue', event),
    setSelection: (event) => handleSetSelection('queue', event),
    activate: (event) => {
      if (!multiplayerController.activateTrack('queue', event.detail)) {
        void playbackCommands.activateQueueTrack(event.detail);
      }
    },
    contextAction: (event) => {
      if (isFreeplayClient) {
        handleFreeplayQueueContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      if (!isMultiplayerClient) {
        workspaceCollections.handleQueueContextAction(event.detail.actionId, event.detail.ids);
      }
    },
    toggleShuffle: toggleQueueShuffle,
    cycleRepeat: cycleQueueRepeat
  };
  const libraryPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => { if (!isMultiplayerClient) workspaceCollections.handleAddFiles(files, 'library'); },
    addFolders: (handles) => { if (!isMultiplayerClient) void filesystemFolders.rememberMany(handles); },
    openFiles: () => { if (!isMultiplayerClient) void handleMenuOpenFiles('library'); },
    select: (event) => handleLibraryPanelSelect(event),
    setSelection: (event) => handleLibraryPanelSetSelection(event),
    activate: (event) => void activateLibraryPanelTrack(event.detail),
    libraryGroupRequestHandled: (event) => workspaceShell.clearLibraryGroupRequest(event.detail),
    contextAction: (event) => {
      if (isFreeplayClient) {
        handleFreeplayLibraryContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      if (isMultiplayerClient) return;
      $libraryViewSettings.activeView === 'favorites'
        ? workspaceCollections.handleFavoriteContextAction(event.detail.actionId, event.detail.ids)
        : workspaceCollections.handleLibraryContextAction(event.detail.actionId, event.detail.ids);
    }
  };
  const upNextPanelHandlers: UpNextPanelHandlers = {
    activate: (event) => {
      if (isFreeplayClient || isMultiplayerClient) return;
      upNext.remove([event.detail]);
      void playbackCommands.activateQueueTrack(event.detail);
    },
    contextAction: (event) => {
      if (isFreeplayClient || isMultiplayerClient) return;
      workspaceCollections.handleUpNextContextAction(event.detail.actionId, event.detail.ids);
    }
  };

  $: {
    if (
      playingTrack &&
      livePlayingTrack &&
      playingTrack.id === livePlayingTrack.id &&
      !hasSameTrackMetadata(playingTrack, livePlayingTrack)
    ) {
      if (!isMultiplayerClient) {
        playerController.refreshCurrentTrackMetadata(livePlayingTrack.id, livePlayingTrack.metadata);
      }
    }
  }

  function handleSelect(
    collection: WorkspaceCollection,
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ) {
    workspaceShell.selectTrack(collection, event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  function handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<TrackSelection>) {
    workspaceShell.setCollectionSelection(collection, event.detail);
  }

  function handleLibraryPanelSelect(
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ) {
    windowSelection.handleLibraryPanelSelect(event);
  }

  function handleLibraryPanelSetSelection(event: CustomEvent<TrackSelection>) {
    windowSelection.handleLibraryPanelSetSelection(event);
  }

  async function activateLibraryPanelTrack(id: string) {
    if (isFreeplayClient) {
      addToFreeplayQueue([id]);
      multiplayerController.activateTrack('queue', id);
      return;
    }
    if (multiplayerController.activateTrack(
      $libraryViewSettings.activeView === 'favorites' ? 'favorites' : 'library',
      id
    )) return;
    if ($libraryViewSettings.activeView !== 'favorites') {
      await playbackCommands.activateLibraryTrack(id);
      return;
    }

    const track = favoriteItems.find((item) => item.id === id);
    if (track) await playbackCommands.activateFavoriteTrack(track);
  }

  function handleShowQueueTrack(id: string) {
    workspaceShell.showQueueTrack(id);
  }

  function handleShowPlayerTrackDetails(id: string) {
    handleShowQueueTrack(id);
    workspaceShell.showTrackDetails();
  }

  function showQueue() {
    workspaceShell.showWorkspaceTab('queue');
  }

  function showLibrary() {
    workspaceShell.showWorkspaceTab('library');
  }

  function showTrackDetails() {
    workspaceShell.showTrackDetails();
  }

  function showTrackLyrics() {
    workspaceShell.showTrackLyrics();
  }

  function togglePatterns() {
    if (workspaceShellState.isPatternsPanelVisible) {
      workspaceShell.closeWorkspaceTab('patterns');
      return;
    }

    workspaceShell.showWorkspaceTab('patterns');
  }

  function togglePlayback(): void {
    transport.togglePlayback();
  }

  function playPlayback(): void {
    transport.play();
  }

  function pausePlayback(): void {
    transport.pause();
  }

  function stopPlayback(): void {
    transport.stop();
  }

  function stepTrack(direction: -1 | 1): void {
    transport.stepTrack(direction);
  }

  function seekPlayback(seconds: number): void {
    transport.seek(seconds);
  }

  function setPlayerVolume(volume: number): void {
    transport.setVolume(volume);
  }

  function togglePlayerMute(): void {
    transport.toggleMute();
  }

  function toggleQueueShuffle(): void {
    transport.toggleQueueShuffle();
  }

  function cycleQueueRepeat(): void {
    transport.cycleQueueRepeat();
  }

  function startCurrentTrackOver(): void {
    transport.startOver();
  }

  function localizePlaybackError(message: string): string {
    return localizePlaybackErrorMessage(message, translate);
  }

  async function handleMenuOpenFiles(target: WorkspaceCollection = workspaceShellState.activeCollection) {
    await importController.openFiles(target);
  }

  async function handleMenuOpenFolder(target: WorkspaceCollection = workspaceShellState.activeCollection) {
    await importController.openFolder(target);
  }

  function handleMenuInput(event: Event) {
    void importController.handleFileInputChange(event);
  }

  function syncVideoWindowSize(active: boolean, autoResizeWindow: boolean): void {
    videoActions.syncWindowSize(active, autoResizeWindow);
  }

  function syncVideoPresentation(track: TrackItem | null, autoEnterTheater: boolean): void {
    videoActions.syncPresentation(track, autoEnterTheater);
  }

  function toggleVideoTheater(): void {
    videoActions.toggleTheater();
  }

  function setVideoFit(fitMode: VideoFitMode): void {
    videoActions.setFit(fitMode);
  }

  async function toggleVideoPictureInPicture(): Promise<void> {
    await videoActions.togglePictureInPicture();
  }

  async function toggleVideoFullscreen(): Promise<void> {
    await videoActions.toggleFullscreen();
  }

  function toggleFullscreenPresentation(): void | Promise<void> {
    return videoActions.toggleFullscreenPresentation();
  }

  function toggleNowPlayingView(): void {
    videoActions.toggleNowPlayingView();
  }

  function closeNowPlayingView(): void {
    videoActions.closeNowPlayingView();
  }

  function handleAppKeydown(event: KeyboardEvent): void {
    if (videoTheaterActive && event.key === 'Escape') {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      videoTheaterActive = false;
      videoTheaterControlsHidden = false;
      return;
    }

    appShortcuts.handleKeydown(event);
  }

  function handleOpenOptions(view?: OptionsViewName) {
    if (mobileMode) {
      mobileOptionsView = view;
      mobileOptionsOpen = true;
      return;
    }
    windowManager.openOptions(view);
  }

  function handleOpenAbout() {
    handleOpenOptions('about');
  }

  function navigateTrackDetailsToLibrary(target: TrackLibraryNavigationTarget) {
    workspaceShell.showLibraryGroup(target);
  }

  function handlePopupWindowMessage(event: MessageEvent): void {
    troubadourBridge.handleMessage(event);
  }

  async function handleForceUpdate() {
    await forceServiceWorkerUpdateCheck();
  }

  async function handleMultiplayerHost(): Promise<void> {
    await multiplayerController.host();
  }

  async function startLaunchMultiplayer(): Promise<void> {
    await multiplayerController.startLaunch();
  }

  async function handleMultiplayerJoin(): Promise<void> {
    await multiplayerController.joinWithPrompt();
  }

  async function joinMultiplayer(inviteCode: string): Promise<void> {
    await multiplayerController.join(inviteCode);
  }

  async function joinPairedMultiplayer(hostId: string): Promise<void> {
    await multiplayerController.joinPaired(hostId);
  }

  async function copyMultiplayerInvite(): Promise<void> {
    await multiplayerController.copyInvite();
  }

  function dismissMultiplayerConnectionDialog(): void {
    multiplayerController.dismissConnectionDialog();
  }

  function dismissMultiplayerToast(): void {
    multiplayerController.dismissToast();
  }

  function addToFreeplayQueue(ids: string[]): void {
    freeplayActions.addToFreeplayQueue(ids);
  }

  function removeFromFreeplayQueue(ids: string[]): void {
    freeplayActions.removeFromFreeplayQueue(ids);
  }

  function handleFreeplayQueueContextAction(actionId: string, ids: string[]): void {
    freeplayActions.handleQueueContextAction(actionId, ids);
  }

  function handleFreeplayLibraryContextAction(actionId: string, ids: string[]): void {
    freeplayActions.handleLibraryContextAction(actionId, ids);
  }

  function handleNowPlayingTabChange(tab: WorkspaceTab) {
    workspaceShell.setActiveWorkspaceTab(tab);
  }

  function closeActiveRightPanel() {
    closeActiveRightPanelFor(workspaceShellState.workspacePanels, (tab) =>
      workspaceShell.closeWorkspaceTab(tab)
    );
  }

  function cycleWorkspaceTab(direction: -1 | 1): boolean {
    return cycleWorkspaceTabs(
      direction,
      workspaceShellState.workspaceTabs.map((tab) => tab.id),
      workspaceShellState.activeWorkspaceTab,
      (tab) => workspaceShell.setActiveWorkspaceTab(tab)
    );
  }

  $: if (playbackStatus.state !== previousPlaybackState) {
    if (!isMultiplayerClient && playbackStatus.state === 'ended') {
      void playbackCommands.handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  $: if (!isMultiplayerClient && $playbackSettings.gaplessPlayback && playingTrack) {
    void playbackCommands.prepareUpcomingTrack();
  }

  onDestroy(() => {
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
  });
</script>

<svelte:head>
  <title>{documentTitle}</title>
</svelte:head>

<svelte:window
  bind:innerWidth
  bind:innerHeight
  on:contextmenu={appShortcuts.handleContextMenu}
  on:keydown={handleAppKeydown}
  on:pointermove={(event) => workspaceShell.handlePanelResizeMove(event)}
  on:pointerup={() => workspaceShell.endPanelResize()}
  on:pointercancel={() => workspaceShell.endPanelResize()}
  on:message={handlePopupWindowMessage}
/>

<div
  class="app-shell"
  class:mobile-mode={mobileMode}
  class:compact-workspace={workspaceShellState.isCompactWorkspace}
  class:now-playing-mode={isNowPlayingLayoutActive}
  class:video-theater-mode={videoTheaterActive}
  class:video-fullscreen-mode={isFullscreenVideoTheater}
  class:video-theater-controls-hidden={videoTheaterActive && videoTheaterControlsHidden}
  class:now-playing-theater-chrome-hidden={isFullscreenNowPlayingChromeHidden}
  class:window-chrome-transition-bypass={artworkPresentationState.isWindowChromeTransitionBypassed}
  class:window-controls-overlay-active={$windowControlsOverlayState.visible}
>
  {#if backdropPresentation.isArtworkBackdropActive}
    <SharedBackdropArtwork
      artworkUrl={artworkPresentationState.visibleArtworkBackground?.url}
      geometryKey={backdropPresentation.geometryKey}
    />
  {/if}

  {#if backdropPresentation.isVisualizerBackdropRequested}
    <SharedBackdropVisualizer
      artworkUrl={artworkPresentationState.displayedArtwork?.url}
      geometryKey={backdropPresentation.geometryKey}
    />
  {/if}

  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    multiple
    accept={FILE_INPUT_ACCEPT}
    on:change={handleMenuInput}
  />
  <div bind:this={videoParkingHost} hidden aria-hidden="true"></div>

  {#if !mobileMode}
  <TopMenuBar
    bind:height={topMenuBarHeight}
    nowPlayingViewActive={isNowPlayingLayoutActive}
    miniPlayerSupported={miniPlayerState.supported}
    miniPlayerActive={miniPlayerState.active || miniPlayerState.opening}
    videoActive={videoTrackActive}
    videoFitMode={$videoSettings.fitMode}
    {videoPictureInPictureSupported}
    {videoTheaterActive}
    installAvailable={appInstallState.available}
    showInstallHint={appInstallState.showHint}
    playingTrack={playerDisplayTrack}
    playbackTime={playbackSnapshot.currentTime}
    multiplayerEnabled={$experimentalSettings.multiplayer}
    multiplayerMode={multiplayerState.mode}
    multiplayerConnectionStatus={multiplayerState.connectionStatus}
    multiplayerReconnecting={multiplayerState.reconnecting}
    multiplayerAudioStatus={multiplayerState.audioStatus}
    multiplayerConnectionRoute={multiplayerState.connectionRoute}
    multiplayerAudioBitrateKbps={multiplayerState.averageAudioBitrateKbps}
    multiplayerHostVersion={multiplayerState.hostVersion}
    multiplayerFreeplayEnabled={$experimentalSettings.multiplayerFreeplay}
    multiplayerFreeplayPaired={multiplayerState.freeplayPaired}
    multiplayerFreeplay={multiplayerState.freeplay}
    multiplayerReceiveAudio={multiplayerState.receiveAudio}
    multiplayerConnectionStats={multiplayerState.connectionStats}
    multiplayerInviteCode={multiplayerState.inviteCode}
    multiplayerHostName={multiplayerState.hostName}
    multiplayerClients={multiplayerState.clients}
    multiplayerRecents={$multiplayerRecents}
    multiplayerPairings={$multiplayerPairings}
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:installApp={() => void appInstallService.prompt()}
    on:acknowledgeInstallHint={() => appInstallService.acknowledgeHint()}
    on:openOptions={(event) => handleOpenOptions(event.detail?.view)}
    on:forceUpdate={() => void handleForceUpdate()}
    on:openAbout={handleOpenAbout}
    on:openAudioCompare={() => windowManager.openPopup('audioCompare')}
    on:openEditor={() => windowManager.openPopup('editor')}
    on:openConverter={() => windowManager.openPopup('converter')}
    on:openLogs={() => windowManager.openPopup('logs')}
    on:openTroubadour={() => windowManager.openPopup('troubadour')}
    on:showQueue={showQueue}
    on:showLibrary={showLibrary}
    on:showTrackDetails={showTrackDetails}
    on:showLyrics={showTrackLyrics}
    on:togglePatterns={togglePatterns}
    on:toggleMiniPlayer={() => miniPlayer.toggle()}
    on:toggleNowPlayingView={toggleNowPlayingView}
    on:multiplayerHost={() => void handleMultiplayerHost()}
    on:multiplayerHostWithCode={() => void handleMultiplayerHost()}
    on:multiplayerStopHosting={() => void multiplayerSession.stopHosting()}
    on:multiplayerJoin={() => void handleMultiplayerJoin()}
    on:multiplayerJoinRecent={(event) => void joinMultiplayer(event.detail)}
    on:multiplayerJoinPaired={(event) => void joinPairedMultiplayer(event.detail)}
    on:multiplayerForgetPairing={(event) => forgetMultiplayerPairing(event.detail)}
    on:multiplayerLeave={() => void multiplayerSession.leave()}
    on:multiplayerCopyInvite={() => void copyMultiplayerInvite()}
    on:multiplayerResumeAudio={() => void multiplayerSession.resumeAudio()}
    on:multiplayerToggleAudio={(event) => multiplayerSession.setReceiveAudio(event.detail)}
    on:multiplayerKick={(event) => void multiplayerSession.kick(event.detail)}
    on:multiplayerTogglePair={(event) => void multiplayerSession.togglePairing(event.detail)}
    on:setVideoFit={(event) => setVideoFit(event.detail)}
    on:toggleVideoPictureInPicture={() => void toggleVideoPictureInPicture()}
    on:toggleVideoTheater={toggleVideoTheater}
    on:seek={(event) => seekPlayback(event.detail)}
    on:exit={() => windowManager.exit()}
  />
  {/if}

  {#if mobileMode}
  <MobileWorkspace
    snapshotStore={displayPlaybackSnapshotStore}
    {playbackSnapshot}
    nowPlayingActive={isNowPlayingLayoutActive}
    videoElement={playerController.videoElement}
    {videoParkingHost}
    {videoTheaterActive}
    videoFitMode={$videoSettings.fitMode}
    {videoPictureInPictureSupported}
    {videoSeekFeedback}
    inactive={videoTheaterActive}
    workspaceState={workspaceShellState}
    {queuePanelHandlers}
    {libraryPanelHandlers}
    {upNextPanelProps}
    {upNextPanelHandlers}
    {selectedTrackItem}
    {playerDisplayTrack}
    {lyricsTrack}
    {modulePatternSnapshot}
    artworkState={artworkPresentationState}
    {detailsLibraryTargets}
    onNavigateTrackDetailsToLibrary={navigateTrackDetailsToLibrary}
    appearance={$appearanceSettings}
    zoneEffects={backdropPresentation.workspaceZoneEffects}
    zoneArtworkSettings={backdropPresentation.workspaceZoneArtworkSettings}
    zoneArtworkBright={backdropPresentation.workspaceZoneArtworkBright}
    nowPlayingArtworkBright={backdropPresentation.artworkBackgroundBrightByZone.nowPlaying}
    {effectiveLyricsDisplayStyle}
    {lyricsAutoScroll}
    {lyricsFontSize}
    {lyricsResumeAutoScrollToken}
    installAvailable={appInstallState.available}
    videoAvailable={videoTrackActive}
    multiplayerEnabled={$experimentalSettings.multiplayer}
    multiplayerMode={multiplayerState.mode}
    multiplayerConnectionStatus={multiplayerState.connectionStatus}
    multiplayerReconnecting={multiplayerState.reconnecting}
    multiplayerAudioStatus={multiplayerState.audioStatus}
    multiplayerConnectionRoute={multiplayerState.connectionRoute}
    multiplayerAudioBitrateKbps={multiplayerState.averageAudioBitrateKbps}
    multiplayerInviteCode={multiplayerState.inviteCode}
    multiplayerHostName={multiplayerState.hostName}
    multiplayerHostVersion={multiplayerState.hostVersion}
    multiplayerFreeplayPaired={multiplayerState.freeplayPaired}
    multiplayerFreeplay={multiplayerState.freeplay}
    multiplayerReceiveAudio={multiplayerState.receiveAudio}
    multiplayerConnectionStats={multiplayerState.connectionStats}
    multiplayerClients={multiplayerState.clients}
    multiplayerRecents={$multiplayerRecents}
    multiplayerPairings={$multiplayerPairings}
    on:tabChange={(event) => workspaceShell.showWorkspaceTab(event.detail)}
    on:toggleNowPlaying={toggleNowPlayingView}
    on:closeNowPlaying={closeNowPlayingView}
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:manageFolders={() => handleOpenOptions('folders')}
    on:openOptions={() => handleOpenOptions()}
    on:openAbout={handleOpenAbout}
    on:install={() => void appInstallService.prompt()}
    on:multiplayerHost={() => void handleMultiplayerHost()}
    on:multiplayerHostWithCode={() => void handleMultiplayerHost()}
    on:multiplayerStopHosting={() => void multiplayerSession.stopHosting()}
    on:multiplayerJoin={() => void handleMultiplayerJoin()}
    on:multiplayerJoinRecent={(event) => void joinMultiplayer(event.detail)}
    on:multiplayerJoinPaired={(event) => void joinPairedMultiplayer(event.detail)}
    on:multiplayerForgetPairing={(event) => forgetMultiplayerPairing(event.detail)}
    on:multiplayerLeave={() => void multiplayerSession.leave()}
    on:multiplayerCopyInvite={() => void copyMultiplayerInvite()}
    on:multiplayerResumeAudio={() => void multiplayerSession.resumeAudio()}
    on:multiplayerKick={(event) => void multiplayerSession.kick(event.detail)}
    on:multiplayerTogglePair={(event) => void multiplayerSession.togglePairing(event.detail)}
    on:togglePatterns={togglePatterns}
    on:toggle={togglePlayback}
    on:previous={() => stepTrack(-1)}
    on:next={() => stepTrack(1)}
    on:previousSubsong={() => playerController.stepSubsong(-1)}
    on:nextSubsong={() => playerController.stepSubsong(1)}
    on:seek={(event) => seekPlayback(event.detail)}
    on:volume={(event) => setPlayerVolume(event.detail)}
    on:mute={togglePlayerMute}
    on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
    on:toggleVideoTheater={toggleVideoTheater}
    on:togglePictureInPicture={() => void toggleVideoPictureInPicture()}
    on:setVideoFit={(event) => setVideoFit(event.detail)}
  />
  {:else}
  <AppWorkspace
    snapshotStore={displayPlaybackSnapshotStore}
    {playbackSnapshot}
    {isNowPlayingLayoutActive}
    videoElement={playerController.videoElement}
    {videoParkingHost}
    {videoTheaterActive}
    videoFitMode={$videoSettings.fitMode}
    {videoPictureInPictureSupported}
    {videoSeekFeedback}
    inactive={videoTheaterActive}
    workspaceState={workspaceShellState}
    {queuePanelHandlers}
    {libraryPanelHandlers}
    {upNextPanelProps}
    {upNextPanelHandlers}
    {selectedTrackItem}
    {playerDisplayTrack}
    {lyricsTrack}
    {modulePatternSnapshot}
    artworkState={artworkPresentationState}
    {detailsLibraryTargets}
    onNavigateTrackDetailsToLibrary={navigateTrackDetailsToLibrary}
    appearance={$appearanceSettings}
    artworkBackgroundBrightByZone={backdropPresentation.artworkBackgroundBrightByZone}
    workspaceZoneArtworkBright={backdropPresentation.workspaceZoneArtworkBright}
    workspaceZoneEffects={backdropPresentation.workspaceZoneEffects}
    workspaceZoneArtworkSettings={backdropPresentation.workspaceZoneArtworkSettings}
    {effectiveLyricsDisplayStyle}
    {lyricsAutoScroll}
    {lyricsFontSize}
    {lyricsResumeAutoScrollToken}
    onCloseNowPlaying={closeNowPlayingView}
    onChromeHiddenChange={(hidden) => (isNowPlayingChromeHidden = hidden)}
    onTabChange={handleNowPlayingTabChange}
    onTabClose={(tab) => workspaceShell.closeWorkspaceTab(tab)}
    onTabbedTabMove={(detail) => workspaceShell.moveTabbedWorkspaceTab(detail)}
    onWideTabMove={(detail) => workspaceShell.moveWorkspaceTab(detail)}
    onResizeStart={(detail) => workspaceShell.handleWideWorkspaceResizeStart(detail)}
    onTogglePlayback={togglePlayback}
    onPreviousTrack={() => stepTrack(-1)}
    onNextTrack={() => stepTrack(1)}
    onPreviousSubsong={() => playerController.stepSubsong(-1)}
    onNextSubsong={() => playerController.stepSubsong(1)}
    onSeek={seekPlayback}
    onVolume={setPlayerVolume}
    onMute={togglePlayerMute}
    onShowTrack={handleShowPlayerTrackDetails}
    onToggleVideoTheater={toggleVideoTheater}
    onToggleVideoPictureInPicture={() => void toggleVideoPictureInPicture()}
    onSetVideoFit={setVideoFit}
  />
  {/if}

  {#if videoTheaterActive}
    <VideoTheater
      element={playerController.videoElement}
      parkingHost={videoParkingHost}
      topInset={videoTheaterTopInset}
      chromeInset={isFullscreenVideoTheater ? videoTheaterChromeInset : 0}
      fitMode={$videoSettings.fitMode}
      snapshot={playbackSnapshot}
      pictureInPictureSupported={videoPictureInPictureSupported}
      seekFeedback={videoSeekFeedback}
      on:controlsHiddenChange={(event) => (videoTheaterControlsHidden = event.detail)}
      on:toggleVideoTheater={toggleVideoTheater}
      on:togglePictureInPicture={() => void toggleVideoPictureInPicture()}
      on:setVideoFit={(event) => setVideoFit(event.detail)}
      on:volumeStep={(event) => {
        if (!playbackSnapshot.muted) {
          playerController.setVolume(
            Math.min(Math.max(playbackSnapshot.volume + event.detail, 0), 1)
          );
        }
      }}
    />
  {/if}
  {#if playbackStatus.error}
    <aside class="error-banner">{localizePlaybackError(playbackStatus.error)}</aside>
  {/if}

  {#if multiplayerToastMessage}
    <StatusToast
      title={$t('main.multiplayer.connectionFailed', { default: 'Multiplayer connection failed' })}
      message={multiplayerToastMessage}
      dismissLabel={$t('main.common.close', { default: 'Close' })}
      on:dismiss={dismissMultiplayerToast}
    />
  {/if}

  {#if multiplayerConnectionDialogOpen}
    <MultiplayerConnectionDialog
      title={$t('main.multiplayer.label', { default: 'Multiplayer' })}
      notice={multiplayerConnectionNotice}
      statusLine={multiplayerConnectionStatusLine}
      failed={multiplayerConnectionFailed}
      closeLabel={$t('main.common.close', { default: 'Close' })}
      actionLabel={multiplayerState.audioStatus === 'blocked'
        ? $t('main.multiplayer.audio.start', { default: 'Start audio' })
        : null}
      markLabel={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })}
      on:dismiss={dismissMultiplayerConnectionDialog}
      on:action={() => void multiplayerSession.resumeAudio()}
    />
  {/if}

  {#if playbackProgressState.notice}
    <PlaybackResumeBanner
      currentTime={playbackProgressState.notice.currentTime}
      on:startOver={startCurrentTrackOver}
      on:dismiss={playbackProgress.dismissNotice}
    />
  {/if}

  {#if !isNowPlayingLayoutActive}
    <PlayerControls
      presentation={videoTheaterActive ? 'theater' : 'bar'}
      snapshotStore={displayPlaybackSnapshotStore}
      track={playerDisplayTrack}
      selectedTrack={selectedTrackItem}
      artwork={artworkPresentationState.displayedArtwork}
      backdropEffect={$appearanceSettings.backdropZones.player}
      backdropArtworkSettings={$appearanceSettings.backdropZoneArtwork.player}
      artworkBackgroundBright={backdropPresentation.artworkBackgroundBrightByZone.player}
      hasCollectionItems={queueItems.length > 0 || libraryItems.length > 0 || favoriteItems.length > 0}
      {collectionsReady}
      showFavoriteToggle={!isMultiplayerClient && $trackSettings.showFavoriteToggleInPlayerBar}
      favorite={favoriteTargetTrack ? favoritesHaveAllTracks(favoriteItems, [favoriteTargetTrack]) : false}
      ratingsEnabled={!isMultiplayerClient && $trackSettings.enableRatings}
      rating={favoriteTargetTrack?.rating ?? 0}
      showRafToggle={$playbackSettings.enableRaf && $playbackSettings.showRafToggleInPlayerBar}
      rafEnabled={$rafSettings.enabled}
      rafPresets={$rafPresets.presets}
      selectedRafPresetId={$rafPresets.selectedPresetId}
      rafPresetDirty={isRafPresetDirty($rafPresets, $rafSettings)}
      showVideoTheaterToggle={videoTrackActive}
      {videoTheaterActive}
      videoFullscreenActive={videoFullscreenExitAction}
      on:toggle={togglePlayback}
      on:previous={() => stepTrack(-1)}
      on:next={() => stepTrack(1)}
      on:previousSubsong={() => playerController.stepSubsong(-1)}
      on:nextSubsong={() => playerController.stepSubsong(1)}
      on:seek={(event) => seekPlayback(event.detail)}
      on:volume={(event) => setPlayerVolume(event.detail)}
      on:mute={togglePlayerMute}
      on:toggleFavorite={() => favoriteTargetTrack && workspaceCollections.toggleFavoriteTracks([favoriteTargetTrack])}
      on:rate={(event) => favoriteTargetTrack && workspaceCollections.rateTracks([favoriteTargetTrack], event.detail)}
      on:toggleRaf={() => rafSettings.setEnabled(!$rafSettings.enabled)}
      on:applyRafPreset={(event) => rafPresets.apply(event.detail)}
      on:openRafOptions={() => handleOpenOptions('raf')}
      on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
      on:enterNowPlaying={toggleNowPlayingView}
      on:toggleVideoTheater={toggleVideoTheater}
    />
  {/if}
</div>

{#if mobileMode && mobileOptionsOpen}
  <div class="mobile-options-overlay">
    {#await import('./options/OptionsApp.svelte') then optionsModule}
      <svelte:component
        this={optionsModule.default}
        embedded
        initialView={mobileOptionsView}
        on:close={() => (mobileOptionsOpen = false)}
      />
    {/await}
  </div>
{/if}
