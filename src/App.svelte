<script lang="ts">
  import { onDestroy } from 'svelte';
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
    type TrackLibraryNavigationTargets
  } from '$lib/services/library-navigation';
  import VideoTheater from '$lib/components/workspace/VideoTheater.svelte';
  import type {
    VideoSeekFeedback
  } from '$lib/components/workspace/types';
  import {
    resolveAppBackdropPresentation,
    type AppBackdropPresentation
  } from '$lib/services/app-backdrops';
  import {
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import { FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import {
    resolvePatternTabAvailability
  } from '$lib/services/contextual-tab-presentation';
  import { appInstallService } from '$lib/services/app-install';
  import { playerController } from '$lib/services/player-controller';
  import { windowManager } from '$lib/services/window-manager';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { windowDisplayState } from '$lib/services/window-display-state';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { libraryViewSettings } from '$lib/stores/library-view-settings';
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
    TrackSelection,
    WorkspaceTab
  } from '$lib/types';
  import type {
    UpNextPanelProps
  } from '$lib/components/workspace/types';
  import { upNext } from '$lib/stores/up-next';
  import { type OptionsViewName } from './options/views';
  import { getFavoriteIdentity } from '$lib/utils/files';
  import {
    favoritesHaveAllTracks
  } from '$lib/services/workspace-actions';
  import { experimentalSettings } from '$lib/stores/experimental-settings';
  import { multiplayerRecents } from '$lib/stores/multiplayer-recents';
  import { forgetMultiplayerPairing, multiplayerPairings } from '$lib/stores/multiplayer-pairings';
  import type {
    MultiplayerSessionState
  } from '$lib/services/multiplayer-types';
  import { resolveMultiplayerPlayingTrackSelection } from '$lib/services/multiplayer-selection';
  import { toLoadedMultiplayerArtwork } from '$lib/services/multiplayer-artwork';
  import { emptySelection } from '$lib/stores/queue-selection';
  import type { RemoteSelectionSnapshot } from '$lib/services/main-window-selection';
  import { createMainWindowRuntime } from '$lib/services/main-window-runtime';
  import {
    resolveClientCollections,
    resolveClientPlayback,
    resolveClientSelections,
    resolveClientSelectedItems,
    resolveLyricsPresentation,
    resolveMultiplayerDialogPresentation,
    resolveNowPlayingEligibility,
    resolveNowPlayingLayoutActive,
    resolveVideoTheaterPresentation,
    resolveWindowTitle
  } from '$lib/services/main-window-presentation';

  const mobileMode = isMobileNavigator(typeof navigator === 'undefined' ? null : navigator);
  let mobileOptionsOpen = false;
  let mobileOptionsView: OptionsViewName | undefined = undefined;

  let queueItems: TrackItem[] = [];
  let libraryItems: TrackItem[] = [];
  let favoriteItems: TrackItem[] = [];
  let collectionsReady = false;
  let queueSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let favoriteSelectionIds: string[] = [];
  let favoriteSelectionAnchorId: string | null = null;
  let remoteTrackSelection: TrackSelection = emptySelection;
  let remoteLibrarySelection: TrackSelection = emptySelection;
  let remoteFavoriteSelection: TrackSelection = emptySelection;
  let observedRemotePlayingTrackId: string | null = null;
  let selectedTrackItem: TrackItem | null = null;
  let selectedLibraryItem: TrackItem | null = null;
  let selectedFavoriteItem: TrackItem | null = null;
  let selectedItem: TrackItem | null = null;
  let livePlayingTrack: TrackItem | null = null;
  let playerDisplayTrack: TrackItem | null = null;
  let favoriteTargetTrack: TrackItem | null = null;
  let lyricsTrack: TrackItem | null = null;
  let detailsLibraryTargets: TrackLibraryNavigationTargets = {};
  let playingTrack: TrackItem | null = null;

  let localPlayingTrack: TrackItem | null = null;
  let localShuffleEnabled = false;
  let localRepeatMode: import('$lib/types').RepeatMode = 'off';
  let shuffleEnabled = false;
  let repeatMode: import('$lib/types').RepeatMode = 'off';
  let localPlaybackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: 1,
    backend: null,
    error: undefined
  };
  let playbackStatus = localPlaybackStatus;
  let localPlaybackSnapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 1,
    muted: false,
    backend: null,
    error: undefined
  };
  let playbackSnapshot = localPlaybackSnapshot;
  let multiplayerToastMessage: string | null = null;
  let multiplayerConnectionDialogOpen = false;
  let multiplayerConnectionDialogError: string | null = null;
  let multiplayerConnectionOperation: 'hosting' | 'joining' = 'joining';
  let multiplayerConnectionTargetName: string | null = null;
  let multiplayerConnectionFailed = false;
  let multiplayerConnectionNotice = '';
  let multiplayerConnectionStatusLine = '';
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
  let patternAvailability: import('$lib/services/contextual-tab-presentation').ContextualTabAvailability = 'unavailable';
  let playbackProgressState: import('$lib/services/playback-progress').PlaybackProgressState = { notice: null };
  let miniPlayerState: import('$lib/services/mini-player').MiniPlayerState = {
    supported: false,
    active: false,
    opening: false
  };

  let fileInput: HTMLInputElement | null = null;
  let videoParkingHost: HTMLDivElement | null = null;
  let innerWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  let innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const modulePatternStore = playerController.modulePattern;
  let previousPlaybackState: PlaybackSnapshot['state'] = 'idle';
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
  let lyricsPresentationState: import('$lib/services/lyrics-presentation').LyricsPresentationState = {
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

  const runtime = createMainWindowRuntime({
    mobileMode,
    getRemoteSelections,
    setRemoteSelections,
    setVideoSeekFeedback: (feedback) => (videoSeekFeedback = feedback),
    setTheaterActive: (active) => (videoTheaterActive = active),
    setTheaterControlsHidden: (hidden) => (videoTheaterControlsHidden = hidden),
    setAutoNowPlayingSuppressed: (value) => (autoNowPlayingSuppressed = value),
    getSelectedItem: () => selectedItem,
    openOptionsMobile: (view) => {
      mobileOptionsView = view;
      mobileOptionsOpen = true;
    },
    openOptionsWindow: (view) => windowManager.openOptions(view),
    handleMenuOpenFiles: (target) => runtime.handles.importController.openFiles(target ?? workspaceShellState.activeCollection),
    handleMenuOpenFolder: (target) => runtime.handles.importController.openFolder(target ?? workspaceShellState.activeCollection),
    handleMenuInput: (event) => void runtime.handles.importController.handleFileInputChange(event),
    activateLibraryPanelTrack: (id) => activateLibraryPanelTrack(id),
    handleFreeplayQueueContextAction: (actionId, ids) => freeplayActions.handleQueueContextAction(actionId, ids),
    handleFreeplayLibraryContextAction: (actionId, ids) => freeplayActions.handleLibraryContextAction(actionId, ids),
    handleSelect: (collection, event) => workspaceShell.selectTrack(collection, event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    }),
    handleSetSelection: (collection, event) => workspaceShell.setCollectionSelection(collection, event.detail)
  });

  const {
    handles: {
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
      panelHandlers: runtimePanelHandlers
    },
    stores: {
      displayPlaybackSnapshotStore,
      mediaSessionArtworkOverrideStore,
      multiplayerClientMediaSessionStore,
      miniPlayerTrack,
      miniPlayerSelectedTrack,
      miniPlayerArtworkUrl,
      view
    }
  } = runtime;

  const runtimeSnapshot = runtime.getSnapshot();
  let workspaceShellState: import('$lib/services/workspace-shell').WorkspaceShellState = runtimeSnapshot.workspaceShellState;
  let artworkPresentationState: import('$lib/services/artwork-presentation').ArtworkPresentationState = runtimeSnapshot.artworkPresentationState;
  let playbackCommandsState: { pendingPlaybackTrackId: string | null } = runtimeSnapshot.playbackCommandsState;
  let appInstallState: import('$lib/services/app-install').AppInstallState = runtimeSnapshot.appInstallState;
  let multiplayerState: MultiplayerSessionState = runtimeSnapshot.multiplayerState;

  $: workspacePanelPresentationProps = {
    snapshotStore: displayPlaybackSnapshotStore,
    playbackSnapshot,
    videoElement: playerController.videoElement,
    videoParkingHost,
    videoTheaterActive,
    videoFitMode: $videoSettings.fitMode,
    videoPictureInPictureSupported,
    videoSeekFeedback,
    inactive: videoTheaterActive,
    workspaceState: workspaceShellState,
    queuePanelHandlers: runtimePanelHandlers.queuePanelHandlers,
    libraryPanelHandlers: runtimePanelHandlers.libraryPanelHandlers,
    upNextPanelProps,
    upNextPanelHandlers: runtimePanelHandlers.upNextPanelHandlers,
    selectedTrackItem,
    playerDisplayTrack,
    lyricsTrack,
    modulePatternSnapshot,
    artworkState: artworkPresentationState,
    detailsLibraryTargets,
    onNavigateTrackDetailsToLibrary: actions.navigateTrackDetailsToLibrary,
    appearance: $appearanceSettings,
    effectiveLyricsDisplayStyle,
    lyricsAutoScroll,
    lyricsFontSize,
    lyricsResumeAutoScrollToken
  };

  $: multiplayerBarProps = {
    multiplayerEnabled: $experimentalSettings.multiplayer,
    multiplayerMode: multiplayerState.mode,
    multiplayerConnectionStatus: multiplayerState.connectionStatus,
    multiplayerReconnecting: multiplayerState.reconnecting,
    multiplayerAudioStatus: multiplayerState.audioStatus,
    multiplayerConnectionRoute: multiplayerState.connectionRoute,
    multiplayerAudioBitrateKbps: multiplayerState.averageAudioBitrateKbps,
    multiplayerInviteCode: multiplayerState.inviteCode,
    multiplayerHostName: multiplayerState.hostName,
    multiplayerHostVersion: multiplayerState.hostVersion,
    multiplayerFreeplayEnabled: $experimentalSettings.multiplayerFreeplay,
    multiplayerFreeplayPaired: multiplayerState.freeplayPaired,
    multiplayerFreeplay: multiplayerState.freeplay,
    multiplayerReceiveAudio: multiplayerState.receiveAudio,
    multiplayerConnectionStats: multiplayerState.connectionStats,
    multiplayerClients: multiplayerState.clients,
    multiplayerRecents: $multiplayerRecents,
    multiplayerPairings: $multiplayerPairings
  };
  $: multiplayerBarHandlers = {
    multiplayerHost: () => void actions.handleMultiplayerHost(),
    multiplayerHostWithCode: () => void actions.handleMultiplayerHost(),
    multiplayerStopHosting: () => void multiplayerSession.stopHosting(),
    multiplayerJoin: () => void actions.handleMultiplayerJoin(),
    multiplayerJoinRecent: (inviteCode: string) => void actions.joinMultiplayer(inviteCode),
    multiplayerJoinPaired: (hostId: string) => void actions.joinPairedMultiplayer(hostId),
    multiplayerForgetPairing: (hostId: string) => forgetMultiplayerPairing(hostId),
    multiplayerLeave: () => void multiplayerSession.leave(),
    multiplayerCopyInvite: () => void actions.copyMultiplayerInvite(),
    multiplayerResumeAudio: () => void multiplayerSession.resumeAudio(),
    multiplayerKick: (clientId: string) => void multiplayerSession.kick(clientId),
    multiplayerTogglePair: (hostId: string) => void multiplayerSession.togglePairing(hostId)
  };

  const unsubscribeRuntime = runtime.subscribe((updates) => {
    if ('localPlayingTrack' in updates) localPlayingTrack = updates.localPlayingTrack!;
    if ('localShuffleEnabled' in updates) localShuffleEnabled = updates.localShuffleEnabled!;
    if ('localRepeatMode' in updates) localRepeatMode = updates.localRepeatMode!;
    if ('localPlaybackSnapshot' in updates) localPlaybackSnapshot = updates.localPlaybackSnapshot!;
    if ('localPlaybackStatus' in updates) localPlaybackStatus = updates.localPlaybackStatus!;
    if ('playbackCommandsState' in updates) playbackCommandsState = updates.playbackCommandsState!;
    if ('multiplayerState' in updates) multiplayerState = updates.multiplayerState!;
    if ('multiplayerConnectionDialogOpen' in updates) multiplayerConnectionDialogOpen = updates.multiplayerConnectionDialogOpen!;
    if ('multiplayerConnectionDialogError' in updates) multiplayerConnectionDialogError = updates.multiplayerConnectionDialogError!;
    if ('multiplayerConnectionOperation' in updates) multiplayerConnectionOperation = updates.multiplayerConnectionOperation!;
    if ('multiplayerConnectionTargetName' in updates) multiplayerConnectionTargetName = updates.multiplayerConnectionTargetName!;
    if ('multiplayerToastMessage' in updates) multiplayerToastMessage = updates.multiplayerToastMessage!;
    if ('workspaceShellState' in updates) workspaceShellState = updates.workspaceShellState!;
    if ('playbackProgressState' in updates) playbackProgressState = updates.playbackProgressState!;
    if ('miniPlayerState' in updates) miniPlayerState = updates.miniPlayerState!;
    if ('appInstallState' in updates) appInstallState = updates.appInstallState!;
    if ('artworkPresentationState' in updates) artworkPresentationState = updates.artworkPresentationState!;
    if ('lyricsPresentationState' in updates) lyricsPresentationState = updates.lyricsPresentationState!;
    if ('modulePatternSnapshot' in updates) modulePatternSnapshot = updates.modulePatternSnapshot!;
    if ('renderBufferedRanges' in updates) renderBufferedRanges = updates.renderBufferedRanges!;
    if ('renderPipelineBuffering' in updates) renderPipelineBuffering = updates.renderPipelineBuffering!;
  });

  $: isMultiplayerClient = multiplayerState.mode === 'client';
  $: isFreeplayClient = isMultiplayerClient && multiplayerState.freeplay;
  $: isSourceFileFreeplayClient = isFreeplayClient
    && multiplayerState.remoteDelivery.mode === 'source-file';
  $: ({
    failed: multiplayerConnectionFailed,
    notice: multiplayerConnectionNotice,
    statusLine: multiplayerConnectionStatusLine
  } = resolveMultiplayerDialogPresentation(
    multiplayerState,
    { error: multiplayerConnectionDialogError },
    multiplayerConnectionOperation,
    multiplayerConnectionTargetName,
    translate
  ));
  $: ({
    queueItems,
    libraryItems,
    favoriteItems,
    collectionsReady
  } = resolveClientCollections(
    {
      trackItems: $view.trackItems,
      libraryItems: $view.libraryItems,
      favoriteItems: $view.favoriteItems,
      collectionsReady: $view.collectionsReady
    },
    {
      queue: multiplayerState.remoteCatalog.queue,
      library: multiplayerState.remoteCatalog.library,
      favorites: multiplayerState.remoteCatalog.favorites,
      revision: multiplayerState.remoteCatalog.revision,
      connectionStatus: multiplayerState.connectionStatus
    },
    isMultiplayerClient
  ));
  $: ({
    queueIds: queueSelectionIds,
    libraryIds: librarySelectionIds,
    libraryAnchorId: librarySelectionAnchorId,
    favoriteIds: favoriteSelectionIds,
    favoriteAnchorId: favoriteSelectionAnchorId
  } = resolveClientSelections(
    {
      queueIds: $view.trackSelectionIds,
      libraryIds: $view.librarySelectionIds,
      libraryAnchorId: $view.librarySelectionAnchorId,
      favoriteIds: $view.favoriteSelectionIds,
      favoriteAnchorId: $view.favoriteSelectionAnchorId
    },
    {
      track: remoteTrackSelection,
      library: remoteLibrarySelection,
      favorites: remoteFavoriteSelection
    },
    isMultiplayerClient
  ));
  $: selectedTrackItem = isMultiplayerClient
    ? resolveClientSelectedItems(queueItems, remoteTrackSelection)
    : $view.selectedTrackItem;
  $: selectedLibraryItem = isMultiplayerClient
    ? resolveClientSelectedItems(libraryItems, remoteLibrarySelection)
    : $view.selectedLibraryItem;
  $: selectedFavoriteItem = isMultiplayerClient
    ? resolveClientSelectedItems(favoriteItems, remoteFavoriteSelection)
    : $view.selectedFavoriteItem;
  $: playingTrack = isMultiplayerClient ? multiplayerState.remotePlayback.track : localPlayingTrack;
  $: if (!isMultiplayerClient && queueItems.length > 0) {
    upNext.prune(queueItems.map((item) => item.id));
  }
  $: upNextDisplayItems = $view.upNextEntries
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
  $: ({
    playbackSnapshot,
    playbackStatus,
    shuffleEnabled,
    repeatMode
  } = resolveClientPlayback(
    {
      snapshot: multiplayerState.remotePlayback.snapshot,
      shuffleEnabled: multiplayerState.remoteCatalog.shuffleEnabled,
      repeatMode: multiplayerState.remoteCatalog.repeatMode
    },
    {
      snapshot: localPlaybackSnapshot,
      status: localPlaybackStatus,
      shuffleEnabled: localShuffleEnabled,
      repeatMode: localRepeatMode
    },
    isMultiplayerClient,
    isSourceFileFreeplayClient,
    isRenderDeliveryClient,
    renderPipelineBuffering,
    renderBufferedRanges
  ));
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
  $: actions.syncVideoWindowSize(videoTrackActive, $videoSettings.autoResizeWindow);
  $: actions.syncVideoPresentation(isMultiplayerClient ? null : playerDisplayTrack, $videoSettings.autoEnterTheater);
  $: if (videoTrackActive && $windowDisplayState.fullscreen && !videoTheaterActive) {
    videoTheaterActive = true;
  }
  $: ({
    isFullscreenVideoTheater,
    fullscreenExitAction: videoFullscreenExitAction,
    chromeInset: videoTheaterChromeInset,
    topInset: videoTheaterTopInset
  } = resolveVideoTheaterPresentation(
    videoTrackActive,
    videoTheaterActive,
    $windowDisplayState.fullscreen,
    $windowControlsOverlayState,
    topMenuBarHeight,
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  ));
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
  $: ({
    nowPlayingViewActive,
    isAutomaticNowPlayingEligible,
    isNowPlayingViewportEligible
  } = resolveNowPlayingEligibility(
    $appearanceSettings,
    $windowDisplayState,
    { width: innerWidth, height: innerHeight },
    mobileMode,
    playerDisplayTrack?.kind
  ));
  $: if (!isAutomaticNowPlayingEligible) {
    autoNowPlayingSuppressed = false;
  }
  $: isNowPlayingLayoutActive = resolveNowPlayingLayoutActive(
    nowPlayingViewActive,
    isAutomaticNowPlayingEligible,
    autoNowPlayingSuppressed,
    isNowPlayingViewportEligible,
    playerDisplayTrack?.kind
  );
  $: isFullscreenNowPlayingChromeHidden =
    isNowPlayingLayoutActive && $windowDisplayState.fullscreen && isNowPlayingChromeHidden;
  $: if (!isNowPlayingLayoutActive || !$windowDisplayState.fullscreen) {
    isNowPlayingChromeHidden = false;
  }
  $: ({
    effectiveLyricsDisplayStyle,
    lyricsAutoScroll,
    lyricsFontSize
  } = resolveLyricsPresentation($appearanceSettings, isNowPlayingLayoutActive));
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
  $: documentTitle = resolveWindowTitle(
    $appearanceSettings.showTrackTitleInWindowTitle,
    livePlayingTrack
  );
  $: playCountTracker.sync({
    track: isMultiplayerClient ? null : playingTrack,
    playbackState: isMultiplayerClient ? 'idle' : playbackStatus.state,
    libraryItems: isMultiplayerClient ? $view.libraryItems : libraryItems,
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
    queue: $view.trackItems,
    library: $view.libraryItems,
    favorites: $view.favoriteItems,
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

  function addToFreeplayQueue(ids: string[]): void {
    freeplayActions.addToFreeplayQueue(ids);
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
    unsubscribeRuntime();
    runtime.dispose();
  });

  $: runtime.handles.bindFileInput(fileInput);
  $: runtime.handles.bindVideoParkingHost(videoParkingHost);
  $: runtime.handles.bindTopMenuBarHeight(topMenuBarHeight);
  $: runtime.handles.bindInnerWidth(innerWidth);
  $: runtime.handles.bindInnerHeight(innerHeight);
</script>

<svelte:head>
  <title>{documentTitle}</title>
</svelte:head>

<svelte:window
  bind:innerWidth
  bind:innerHeight
  on:contextmenu={appShortcuts.handleContextMenu}
  on:keydown={actions.handleAppKeydown}
  on:pointermove={(event) => workspaceShell.handlePanelResizeMove(event)}
  on:pointerup={() => workspaceShell.endPanelResize()}
  on:pointercancel={() => workspaceShell.endPanelResize()}
  on:message={actions.handlePopupWindowMessage}
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
    on:change={actions.handleMenuInput}
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
    {...multiplayerBarProps}
    on:openFiles={() => void actions.handleMenuOpenFiles()}
    on:openFolder={() => void actions.handleMenuOpenFolder()}
    on:installApp={() => void appInstallService.prompt()}
    on:acknowledgeInstallHint={() => appInstallService.acknowledgeHint()}
    on:openOptions={(event) => actions.handleOpenOptions(event.detail?.view)}
    on:forceUpdate={() => void actions.handleForceUpdate()}
    on:openAbout={actions.handleOpenAbout}
    on:openAudioCompare={() => windowManager.openPopup('audioCompare')}
    on:openEditor={() => windowManager.openPopup('editor')}
    on:openConverter={() => windowManager.openPopup('converter')}
    on:openLogs={() => windowManager.openPopup('logs')}
    on:openTroubadour={() => windowManager.openPopup('troubadour')}
    on:showQueue={actions.showQueue}
    on:showLibrary={actions.showLibrary}
    on:showTrackDetails={actions.showTrackDetails}
    on:showLyrics={actions.showTrackLyrics}
    on:togglePatterns={actions.togglePatterns}
    on:toggleMiniPlayer={() => miniPlayer.toggle()}
    on:toggleNowPlayingView={actions.toggleNowPlayingView}
    {...multiplayerBarHandlers}
    on:setVideoFit={(event) => actions.setVideoFit(event.detail)}
    on:toggleVideoPictureInPicture={() => void actions.toggleVideoPictureInPicture()}
    on:toggleVideoTheater={actions.toggleVideoTheater}
    on:seek={(event) => actions.seek(event.detail)}
    on:exit={() => windowManager.exit()}
  />
  {/if}

  {#if mobileMode}
  <MobileWorkspace
    {...workspacePanelPresentationProps}
    nowPlayingActive={isNowPlayingLayoutActive}
    zoneEffects={backdropPresentation.workspaceZoneEffects}
    zoneArtworkSettings={backdropPresentation.workspaceZoneArtworkSettings}
    zoneArtworkBright={backdropPresentation.workspaceZoneArtworkBright}
    nowPlayingArtworkBright={backdropPresentation.artworkBackgroundBrightByZone.nowPlaying}
    installAvailable={appInstallState.available}
    videoAvailable={videoTrackActive}
    {...multiplayerBarProps}
    on:tabChange={(event) => workspaceShell.showWorkspaceTab(event.detail)}
    on:toggleNowPlaying={actions.toggleNowPlayingView}
    on:closeNowPlaying={actions.closeNowPlayingView}
    on:openFiles={() => void actions.handleMenuOpenFiles()}
    on:openFolder={() => void actions.handleMenuOpenFolder()}
    on:manageFolders={() => actions.handleOpenOptions('folders')}
    on:openOptions={() => actions.handleOpenOptions()}
    on:openAbout={actions.handleOpenAbout}
    on:install={() => void appInstallService.prompt()}
    {...multiplayerBarHandlers}
    on:togglePatterns={actions.togglePatterns}
    on:toggle={actions.togglePlayback}
    on:previous={() => actions.stepTrack(-1)}
    on:next={() => actions.stepTrack(1)}
    on:previousSubsong={() => playerController.stepSubsong(-1)}
    on:nextSubsong={() => playerController.stepSubsong(1)}
    on:seek={(event) => actions.seek(event.detail)}
    on:volume={(event) => actions.setVolume(event.detail)}
    on:mute={actions.toggleMute}
    on:showTrack={(event) => actions.handleShowPlayerTrackDetails(event.detail)}
    on:toggleVideoTheater={actions.toggleVideoTheater}
    on:togglePictureInPicture={() => void actions.toggleVideoPictureInPicture()}
    on:setVideoFit={(event) => actions.setVideoFit(event.detail)}
  />
  {:else}
  <AppWorkspace
    {...workspacePanelPresentationProps}
    {isNowPlayingLayoutActive}
    artworkBackgroundBrightByZone={backdropPresentation.artworkBackgroundBrightByZone}
    workspaceZoneArtworkBright={backdropPresentation.workspaceZoneArtworkBright}
    workspaceZoneEffects={backdropPresentation.workspaceZoneEffects}
    workspaceZoneArtworkSettings={backdropPresentation.workspaceZoneArtworkSettings}
    onCloseNowPlaying={actions.closeNowPlayingView}
    onChromeHiddenChange={(hidden) => (isNowPlayingChromeHidden = hidden)}
    onTabChange={actions.handleNowPlayingTabChange}
    onTabClose={(tab) => workspaceShell.closeWorkspaceTab(tab)}
    onTabbedTabMove={(detail) => workspaceShell.moveTabbedWorkspaceTab(detail)}
    onWideTabMove={(detail) => workspaceShell.moveWorkspaceTab(detail)}
    onResizeStart={(detail) => workspaceShell.handleWideWorkspaceResizeStart(detail)}
    onTogglePlayback={actions.togglePlayback}
    onPreviousTrack={() => actions.stepTrack(-1)}
    onNextTrack={() => actions.stepTrack(1)}
    onPreviousSubsong={() => playerController.stepSubsong(-1)}
    onNextSubsong={() => playerController.stepSubsong(1)}
    onSeek={actions.seek}
    onVolume={actions.setVolume}
    onMute={actions.toggleMute}
    onShowTrack={actions.handleShowPlayerTrackDetails}
    onToggleVideoTheater={actions.toggleVideoTheater}
    onToggleVideoPictureInPicture={() => void actions.toggleVideoPictureInPicture()}
    onSetVideoFit={actions.setVideoFit}
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
      on:toggleVideoTheater={actions.toggleVideoTheater}
      on:togglePictureInPicture={() => void actions.toggleVideoPictureInPicture()}
      on:setVideoFit={(event) => actions.setVideoFit(event.detail)}
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
    <aside class="error-banner">{actions.localizePlaybackError(playbackStatus.error)}</aside>
  {/if}

  {#if multiplayerToastMessage}
    <StatusToast
      title={$t('main.multiplayer.connectionFailed', { default: 'Multiplayer connection failed' })}
      message={multiplayerToastMessage}
      dismissLabel={$t('main.common.close', { default: 'Close' })}
      on:dismiss={actions.dismissMultiplayerToast}
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
      on:dismiss={actions.dismissMultiplayerConnectionDialog}
      on:action={() => void multiplayerSession.resumeAudio()}
    />
  {/if}

  {#if playbackProgressState.notice}
    <PlaybackResumeBanner
      currentTime={playbackProgressState.notice.currentTime}
      on:startOver={actions.startOver}
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
      on:toggle={actions.togglePlayback}
      on:previous={() => actions.stepTrack(-1)}
      on:next={() => actions.stepTrack(1)}
      on:previousSubsong={() => playerController.stepSubsong(-1)}
      on:nextSubsong={() => playerController.stepSubsong(1)}
      on:seek={(event) => actions.seek(event.detail)}
      on:volume={(event) => actions.setVolume(event.detail)}
      on:mute={actions.toggleMute}
      on:toggleFavorite={() => favoriteTargetTrack && workspaceCollections.toggleFavoriteTracks([favoriteTargetTrack])}
      on:rate={(event) => favoriteTargetTrack && workspaceCollections.rateTracks([favoriteTargetTrack], event.detail)}
      on:toggleRaf={() => rafSettings.setEnabled(!$rafSettings.enabled)}
      on:applyRafPreset={(event) => rafPresets.apply(event.detail)}
      on:openRafOptions={() => actions.handleOpenOptions('raf')}
      on:showTrack={(event) => actions.handleShowPlayerTrackDetails(event.detail)}
      on:enterNowPlaying={actions.toggleNowPlayingView}
      on:toggleVideoTheater={actions.toggleVideoTheater}
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
