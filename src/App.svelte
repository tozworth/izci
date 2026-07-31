<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaybackResumeBanner from '$lib/components/PlaybackResumeBanner.svelte';
  import SharedBackdropArtwork from '$lib/components/SharedBackdropArtwork.svelte';
  import SharedBackdropVisualizer from '$lib/components/SharedBackdropVisualizer.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import AppWorkspace from '$lib/components/workspace/AppWorkspace.svelte';
  import VideoTheater from '$lib/components/workspace/VideoTheater.svelte';
  import type {
    VideoSeekFeedback,
    WorkspacePanelHandlers
  } from '$lib/components/workspace/types';
  import {
    resolveAppBackdropPresentation,
    type AppBackdropPresentation
  } from '$lib/services/app-backdrops';
  import { createAppShortcuts } from '$lib/services/app-shortcuts';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import { invalidateCachedArtwork } from '$lib/services/artwork-cache';
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
  import { forceServiceWorkerUpdateCheck } from '$lib/services/pwa-updates';
  import { createWorkspaceShellController } from '$lib/services/workspace-shell';
  import { mediaSessionService } from '$lib/services/media-session';
  import { createPlayCountTracker } from '$lib/services/play-count';
  import { playerController } from '$lib/services/player-controller';
  import { createWorkspaceCollectionsController } from '$lib/services/workspace-collections';
  import { windowManager } from '$lib/services/window-manager';
  import {
    ensureComfortableNowPlayingWindowSize,
    NOW_PLAYING_MIN_VIEWPORT_HEIGHT,
    NOW_PLAYING_MIN_VIEWPORT_WIDTH,
    restoreNowPlayingWindowSize
  } from '$lib/services/window-now-playing';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { windowDisplayState } from '$lib/services/window-display-state';
  import { windowFullscreen } from '$lib/services/window-fullscreen';
  import {
    ensureComfortableVideoWindowSize,
    restoreVideoWindowSize
  } from '$lib/services/window-video';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { favoritesStore, libraryStore, playlistStore } from '$lib/stores/playlist';
  import { libraryViewSettings } from '$lib/stores/library-view-settings';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { isRafPresetDirty, rafPresets } from '$lib/stores/raf-presets';
  import { trackSettings } from '$lib/stores/track-settings';
  import { videoSettings } from '$lib/stores/video-settings';
  import { respondToToolTrackRequest } from '$lib/services/tool-track-context';
  import {
    buildTroubadourBatchContext,
    readTroubadourBatchResult,
    REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE,
    respondToTroubadourBatchContextRequest,
    type TroubadourBatchContext,
    type TroubadourBatchItemResult,
    type TroubadourTrackReference
  } from '$lib/services/troubadour-sync';
  import type {
    LyricsDisplayStyle,
    ModulePatternSnapshot,
    PlaybackSnapshot,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection,
    VideoFitMode,
    WorkspaceCollection,
    WorkspaceTab
  } from '$lib/types';
  import { isOptionsViewName, type OptionsViewName } from './options/views';
  import { getFavoriteIdentity, getTrackDisplayTitle, getTrackIdentity } from '$lib/utils/files';
  import { favoritesHaveAllTracks } from '$lib/services/workspace-actions';

  const {
    items: playlistItemsStore,
    selectedIds: playlistSelectedIdsStore,
    selectedTrack: playlistSelectedTrackStore,
    shuffleEnabled: shuffleStore,
    repeatMode: repeatStore
  } = playlistStore;
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

  let playlistItems: PlaylistItem[] = [];
  let libraryItems: PlaylistItem[] = [];
  let favoriteItems: PlaylistItem[] = [];
  let collectionsReady = false;
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let favoriteSelectionIds: string[] = [];
  let favoriteSelectionAnchorId: string | null = null;
  let lastTroubadourContext: TroubadourBatchContext | null = null;
  let selectedPlaylistItem: PlaylistItem | null = null;
  let selectedLibraryItem: PlaylistItem | null = null;
  let selectedFavoriteItem: PlaylistItem | null = null;
  let selectedItem: PlaylistItem | null = null;
  let livePlayingTrack: PlaylistItem | null = null;
  let playerDisplayTrack: PlaylistItem | null = null;
  let favoriteTargetTrack: PlaylistItem | null = null;
  let lyricsTrack: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
  let videoParkingHost: HTMLDivElement | null = null;
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playbackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };
  let playbackSnapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_PLAYER_VOLUME,
    muted: false,
    backend: null,
    error: undefined
  };
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
  const miniPlayerTrack = writable<PlaylistItem | null>(null);
  const miniPlayerSelectedTrack = writable<PlaylistItem | null>(null);
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
  let videoSeekFeedbackId = 0;
  let videoPresentationSignature = '';
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
  const workspaceShell = createWorkspaceShellController({
    getPlaylistContextActions: (ids) => workspaceCollections.getPlaylistContextActions(ids),
    getLibraryContextActions: (ids) =>
      libraryViewSettings.getSnapshot().activeView === 'favorites'
        ? workspaceCollections.getFavoriteContextActions()
        : workspaceCollections.getLibraryContextActions(ids)
  });
  let workspaceShellState = workspaceShell.getSnapshot();
  const workspaceCollections = createWorkspaceCollectionsController({
    getState: () => ({
      playlistItems,
      libraryItems,
      favoriteItems,
      playlistSelectionIds,
      librarySelectionIds,
      favoriteSelectionIds,
      playingTrack
    }),
    handlers: {
      focusCollection: (collection) => workspaceShell.focusCollection(collection),
      selectTrack: (collection, id) => workspaceShell.selectTrack(collection, id),
      showTrackDetails: () => workspaceShell.showTrackDetails(),
      showTrackLyrics: () => workspaceShell.showTrackLyrics()
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
    getSelectedPlaylistTrack: () => selectedPlaylistItem,
    getPlaybackState: () => playbackStatus.state,
    getPlaybackCurrentTime: () => playbackSnapshot.currentTime,
    shouldRestartCurrentTrackOnPrevious: () => $playbackSettings.restartCurrentTrackOnPrevious,
    getShuffleEnabled: () => shuffleEnabled,
    getRepeatMode: () => repeatMode,
    getTrackById: (collection, id) =>
      (collection === 'library' ? libraryItems : playlistItems).find((item) => item.id === id) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems: workspaceCollections.cleanupRemovedItems,
    resolveResumePosition: (track) => playbackProgress.resolveResumePosition(track),
    notifyTrackResumed: (track, currentTime) =>
      playbackProgress.showResumeNotice(track, currentTime)
  });
  const miniPlayer = createMiniPlayerController({
    snapshot: playerController.snapshot,
    track: miniPlayerTrack,
    selectedTrack: miniPlayerSelectedTrack,
    artworkUrl: miniPlayerArtworkUrl,
    handlers: {
      togglePlayback: () => void playbackCommands.togglePlayback(),
      previousTrack: () => void playbackCommands.stepTrack(-1),
      nextTrack: () => void playbackCommands.stepTrack(1),
      seek: seekPlayback,
      setVolume: (volume) => playerController.setVolume(volume),
      toggleMute: () => playerController.toggleMute()
    }
  });
  const playCountTracker = createPlayCountTracker({
    incrementLibraryPlayCount: workspaceCollections.incrementLibraryPlayCount
  });
  const playbackRestoration = createPlaybackRestorationController({
    track: playerController.currentTrack,
    snapshot: playerController.snapshot,
    getPlaylistTrack: (id) => playlistItems.find((item) => item.id === id) ?? null,
    ensureLoaded: (id) => playlistStore.ensureLoaded(id),
    selectTrack: (id) => workspaceShell.selectTrack('playlist', id),
    loadTrack: (track, options) => playerController.load(track, options)
  });
  let playbackCommandsState = playbackCommands.getSnapshot();
  const artworkPresentation = createArtworkPresentationController({
    resolveTrackSnapshot: (track) =>
      resolveTrackSnapshot(track, selectedItem, playlistItems, libraryItems),
    isPlaybackDetailsPending: (trackId) =>
      playbackCommandsState.pendingPlaybackTrackId === trackId || playingTrack?.id === trackId
  });
  let artworkPresentationState = artworkPresentation.getSnapshot();
  let backdropPresentation: AppBackdropPresentation;
  let appInstallState: AppInstallState = { available: false, showHint: false };
  const unsubscribePlaylistItems = playlistItemsStore.subscribe((value) => (playlistItems = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (libraryItems = value));
  const unsubscribeFavoriteItems = favoriteItemsStore.subscribe((value) => (favoriteItems = value));
  void Promise.all([playlistStore.ready(), libraryStore.ready(), favoritesStore.ready()]).then(async () => {
    collectionsReady = true;
    void scanLaunchLibraryFolders();
    await playbackRestoration.restore();
  });
  const unsubscribePlaylistSelectedIds = playlistSelectedIdsStore.subscribe(
    (value) => (playlistSelectionIds = value)
  );
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe(
    (value) => (librarySelectionIds = value)
  );
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe(
    (value) => (librarySelectionAnchorId = value.anchorId)
  );
  const unsubscribeFavoriteSelectedIds = favoriteSelectedIdsStore.subscribe(
    (value) => (favoriteSelectionIds = value)
  );
  const unsubscribeFavoriteSelection = favoriteSelectionStore.subscribe(
    (value) => (favoriteSelectionAnchorId = value.anchorId)
  );
  const unsubscribePlaylistSelectedTrack = playlistSelectedTrackStore.subscribe(
    (value) => (selectedPlaylistItem = value)
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => (selectedLibraryItem = value)
  );
  const unsubscribeFavoriteSelectedTrack = favoriteSelectedTrackStore.subscribe(
    (value) => (selectedFavoriteItem = value)
  );
  const unsubscribeShuffle = shuffleStore.subscribe((value) => (shuffleEnabled = value));
  const unsubscribeRepeat = repeatStore.subscribe((value) => (repeatMode = value));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    playingTrack = value;
    playbackCommands.notifyCurrentTrackChanged(value);

    if (!value?.metadata) {
      return;
    }

    playlistStore.updateMetadata(value.id, value.metadata);

    const playingIdentity = getTrackIdentity(value);

    for (const item of libraryItems) {
      if (getTrackIdentity(item) === playingIdentity) {
        libraryStore.updateMetadata(item.id, value.metadata);
      }
    }

    for (const item of favoriteItems) {
      if (getTrackIdentity(item) === playingIdentity) {
        favoritesStore.updateMetadata(item.id, value.metadata);
      }
    }
  });
  const unsubscribePlaybackSnapshot = playerController.snapshot.subscribe((value) => {
    playbackSnapshot = value;
    if (value.state === 'playing') appInstallService.markEngaged();
  });
  const unsubscribePlaybackStatus = playerController.status.subscribe((value) => (playbackStatus = value));
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

  function localizePlaybackError(message: string): string {
    if (message === 'Could not access this file. Re-add it or grant file access.') {
      return $t('main.playbackErrors.fileAccess', {
        default: 'Could not access this file. Re-add it or grant file access.'
      });
    }
    if (message === 'libopenmpt failed to decode this module.') {
      return $t('main.playbackErrors.moduleDecode', {
        default: 'libopenmpt failed to decode this module.'
      });
    }
    if (message === 'Module playback failed.') {
      return $t('main.playbackErrors.modulePlayback', { default: 'Module playback failed.' });
    }
    if (message === 'Chromium could not decode this video.') {
      return $t('main.playbackErrors.videoDecode', { default: 'Chromium could not decode this video.' });
    }
    return $t('main.playbackErrors.generic', { default: 'Playback failed.' });
  }

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
      playlistSelectionIds,
      librarySelectionIds: $libraryViewSettings.activeView === 'favorites' ? favoriteSelectionIds : librarySelectionIds,
      selectedPlaylistItem,
      selectedLibraryItem: $libraryViewSettings.activeView === 'favorites' ? selectedFavoriteItem : selectedLibraryItem,
      playingTrack,
      playbackSnapshot
    }),
    handlers: {
      toggleFullscreenPresentation,
      closeNowPlayingView,
      closeActiveRightPanel,
      removePlaylistItems: workspaceCollections.removePlaylistItems,
      removeLibraryItems: (ids) =>
        $libraryViewSettings.activeView === 'favorites'
          ? workspaceCollections.handleFavoriteContextAction('remove-favorite', ids)
          : workspaceCollections.removeLibraryItems(ids),
      cycleWorkspaceTab,
      seek: seekPlayback,
      stepTrack: (direction) => playbackCommands.stepTrack(direction),
      setVolume: (volume) => playerController.setVolume(volume),
      activatePlaylistTrack: (id) => playbackCommands.activatePlaylistTrack(id),
      activateLibraryTrack: (id) => activateLibraryPanelTrack(id),
      togglePlayback: () => playbackCommands.togglePlayback(),
      toggleMute: () => playerController.toggleMute(),
      selectAllTracks: (collection) =>
        collection === 'library' && $libraryViewSettings.activeView === 'favorites'
          ? favoritesStore.selectAll()
          : workspaceShell.selectAllTracks(collection),
      openFiles: () => handleMenuOpenFiles(),
      openOptions: () => handleOpenOptions(),
      toggleMiniPlayer: () => miniPlayer.toggle(),
      exit: () => windowManager.exit()
    }
  });
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) =>
    void playbackCommands.importLaunchedFiles(files, $trackSettings.associatedFileAction)
  );
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: playerController.snapshot,
    track: playerController.currentTrack,
    settings: playbackSettings,
    handlers: {
      play: () => void playbackCommands.play(),
      pause: () => playbackCommands.pause(),
      stop: () => playbackCommands.stop(),
      previousTrack: () => void playbackCommands.stepTrack(-1),
      nextTrack: () => void playbackCommands.stepTrack(1),
      seekTo: seekPlayback
    }
  });

  $: selectedItem =
    workspaceShellState.activeCollection === 'library'
      ? $libraryViewSettings.activeView === 'favorites' ? selectedFavoriteItem : selectedLibraryItem
      : selectedPlaylistItem;
  $: livePlayingTrack = resolveTrackSnapshot(playingTrack, selectedItem, playlistItems, libraryItems);
  $: playerDisplayTrack = livePlayingTrack;
  $: miniPlayerTrack.set(playerDisplayTrack);
  $: miniPlayerSelectedTrack.set(selectedPlaylistItem);
  $: miniPlayerArtworkUrl.set(artworkPresentationState.displayedArtwork?.url ?? null);
  $: videoTrackActive = playerDisplayTrack?.kind === 'video';
  $: videoPictureInPictureSupported =
    videoTrackActive && playerController.videoPictureInPictureSupported;
  $: syncVideoWindowSize(videoTrackActive, $videoSettings.autoResizeWindow);
  $: syncVideoPresentation(playerDisplayTrack, $videoSettings.autoEnterTheater);
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
    playingTrack,
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
    innerWidth >= NOW_PLAYING_MIN_VIEWPORT_WIDTH &&
    innerHeight >= NOW_PLAYING_MIN_VIEWPORT_HEIGHT;
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
    track: playingTrack,
    playbackState: playbackStatus.state,
    libraryItems,
    thresholdSeconds: $metadataSettings.playCountThresholdSeconds
  });
  $: workspaceShell.sync({
    innerWidth,
    playlistItems,
    libraryItems,
    favoriteItems,
    playlistSelectionIds,
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
    keepEmptyWorkspacePanelsOpen: $appearanceSettings.keepEmptyWorkspacePanelsOpen
  });
  $: {
    artworkPresentation.syncSelection(
      selectedItem,
      playlistSelectionIds.length > 0 || librarySelectionIds.length > 0 || favoriteSelectionIds.length > 0
    );
    void artworkPresentation.syncDetailsDisplay();
  }
  $: void artworkPresentation.syncDisplayedArtwork(playerDisplayTrack);
  $: void artworkPresentation.syncArtworkBrightness(
    artworkPresentationState.visibleArtworkBackground,
    backdropPresentation.isArtworkBackdropRequested
  );
  $: artworkPresentation.syncArtworkMenuClasses(
    false,
    false
  );
  $: artworkPresentation.setWindowControlsOverlayVisible($windowControlsOverlayState.visible);

  const playlistPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => workspaceCollections.handleAddFiles(files, 'playlist'),
    addFolders: (handles) => void filesystemFolders.rememberMany(handles),
    openFiles: () => void handleMenuOpenFiles('playlist'),
    select: (event) => handleSelect('playlist', event),
    activate: (event) => void playbackCommands.activatePlaylistTrack(event.detail),
    contextAction: (event) =>
      workspaceCollections.handlePlaylistContextAction(event.detail.actionId, event.detail.ids),
    toggleShuffle: () => playlistStore.toggleShuffle(),
    cycleRepeat: () => playlistStore.cycleRepeatMode()
  };
  const libraryPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => workspaceCollections.handleAddFiles(files, 'library'),
    addFolders: (handles) => void filesystemFolders.rememberMany(handles),
    openFiles: () => void handleMenuOpenFiles('library'),
    select: (event) => handleLibraryPanelSelect(event),
    setSelection: (event) => handleLibraryPanelSetSelection(event),
    activate: (event) => void activateLibraryPanelTrack(event.detail),
    contextAction: (event) =>
      $libraryViewSettings.activeView === 'favorites'
        ? workspaceCollections.handleFavoriteContextAction(event.detail.actionId, event.detail.ids)
        : workspaceCollections.handleLibraryContextAction(event.detail.actionId, event.detail.ids)
  };

  $: {
    if (
      playingTrack &&
      livePlayingTrack &&
      playingTrack.id === livePlayingTrack.id &&
      !hasSameTrackMetadata(playingTrack, livePlayingTrack)
    ) {
      playerController.refreshCurrentTrackMetadata(livePlayingTrack.id, livePlayingTrack.metadata);
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

  function handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<PlaylistSelection>) {
    workspaceShell.setCollectionSelection(collection, event.detail);
  }

  function handleLibraryPanelSelect(
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ) {
    if ($libraryViewSettings.activeView !== 'favorites') {
      handleSelect('library', event);
      return;
    }

    workspaceShell.focusCollection('library');
    favoritesStore.select(event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  function handleLibraryPanelSetSelection(event: CustomEvent<PlaylistSelection>) {
    if ($libraryViewSettings.activeView === 'favorites') {
      workspaceShell.focusCollection('library');
      favoritesStore.setSelection(event.detail);
      return;
    }

    handleSetSelection('library', event);
  }

  async function activateLibraryPanelTrack(id: string) {
    if ($libraryViewSettings.activeView !== 'favorites') {
      await playbackCommands.activateLibraryTrack(id);
      return;
    }

    const track = favoriteItems.find((item) => item.id === id);
    if (track) await playbackCommands.activateFavoriteTrack(track);
  }

  function handleShowPlaylistTrack(id: string) {
    workspaceShell.showPlaylistTrack(id);
  }

  function handleShowPlayerTrackDetails(id: string) {
    handleShowPlaylistTrack(id);
    workspaceShell.showTrackDetails();
  }

  function showPlaylist() {
    workspaceShell.showWorkspaceTab('playlist');
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

  function seekPlayback(seconds: number): void {
    const seekDelta = seconds - playbackSnapshot.currentTime;
    if (videoTrackActive && Math.abs(seekDelta) >= 0.5) {
      videoSeekFeedback = {
        id: ++videoSeekFeedbackId,
        deltaSeconds: seekDelta
      };
    }
    lyricsPresentation.resumeAutoScroll();
    playbackCommands.seek(seconds);
  }

  function startCurrentTrackOver(): void {
    const notice = playbackProgressState.notice;
    if (!playingTrack || !notice || playingTrack.id !== notice.trackId) return;

    void playbackProgress.clearProgress(playingTrack);
    seekPlayback(0);
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
    if (active && autoResizeWindow) {
      ensureComfortableVideoWindowSize();
      return;
    }

    restoreVideoWindowSize();
  }

  function syncVideoPresentation(track: PlaylistItem | null, autoEnterTheater: boolean): void {
    const videoActive = track?.kind === 'video';
    const signature = videoActive
      ? `${track.id}:${autoEnterTheater ? 'auto' : 'manual'}`
      : 'inactive';

    if (signature === videoPresentationSignature) {
      return;
    }

    videoPresentationSignature = signature;

    if (videoActive) {
      workspaceShell.showWorkspaceTab('video');
      if (autoEnterTheater) {
        videoTheaterActive = true;
      }
      return;
    }

    videoTheaterActive = false;
    videoTheaterControlsHidden = false;
    if (windowFullscreen.isControllerFullscreenActive()) {
      void windowFullscreen.exit();
    }
    workspaceShell.closeWorkspaceTab('video');
  }

  function toggleVideoTheater(): void {
    if (!videoTrackActive) {
      return;
    }

    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void windowFullscreen.exit();
      return;
    }

    videoTheaterActive = !videoTheaterActive;
    if (!videoTheaterActive) {
      videoTheaterControlsHidden = false;
    }
  }

  function setVideoFit(fitMode: VideoFitMode): void {
    videoSettings.update({ fitMode });
  }

  async function toggleVideoPictureInPicture(): Promise<void> {
    await playerController.toggleVideoPictureInPicture();
  }

  async function toggleVideoFullscreen(): Promise<void> {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      await windowFullscreen.exit();
      return;
    }

    videoTheaterActive = true;
    videoTheaterControlsHidden = false;
    await windowFullscreen.enter();
  }

  function toggleFullscreenPresentation(): void | Promise<void> {
    return videoTrackActive ? toggleVideoFullscreen() : toggleFullscreenNowPlaying();
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
    windowManager.openOptions(view);
  }

  function handleOpenAbout() {
    handleOpenOptions('about');
  }

  function createTroubadourContext(): TroubadourBatchContext {
    const playlistIdSet = new Set(playlistSelectionIds);
    const libraryIdSet = new Set(librarySelectionIds);
    const favoriteIdSet = new Set(favoriteSelectionIds);

    return buildTroubadourBatchContext(
      [
        { collection: 'current', items: playingTrack ? [playingTrack] : [] },
        { collection: 'playlist', items: playlistItems.filter((item) => playlistIdSet.has(item.id)) },
        { collection: 'library', items: libraryItems.filter((item) => libraryIdSet.has(item.id)) },
        { collection: 'favorites', items: favoriteItems.filter((item) => favoriteIdSet.has(item.id)) }
      ],
      filesystemFolders.getSnapshot()
    );
  }

  function getTroubadourResultReferences(result: TroubadourBatchItemResult): TroubadourTrackReference[] {
    const contextReferences = result.contextId
      ? lastTroubadourContext?.tracks.find((track) => track.contextId === result.contextId)?.references ?? []
      : [];
    const unique = new Map<string, TroubadourTrackReference>();

    for (const reference of [...(result.references ?? []), ...contextReferences]) {
      unique.set(`${reference.collection}:${reference.id}`, reference);
    }

    return [...unique.values()];
  }

  function getTroubadourContextTrack(result: TroubadourBatchItemResult) {
    if (result.contextId) {
      const direct = lastTroubadourContext?.tracks.find((track) => track.contextId === result.contextId);
      if (direct) return direct;
    }

    const references = getTroubadourResultReferences(result);
    return lastTroubadourContext?.tracks.find((track) => track.references.some((candidate) =>
      references.some((reference) => (
        reference.collection === candidate.collection && reference.id === candidate.id
      ))
    ));
  }

  async function isTroubadourResultMatch(
    item: PlaylistItem,
    collection: TroubadourTrackReference['collection'],
    result: TroubadourBatchItemResult
  ): Promise<boolean> {
    const references = getTroubadourResultReferences(result);

    if (references.some((reference) => reference.collection === collection && reference.id === item.id)) {
      return true;
    }

    const contextTrack = getTroubadourContextTrack(result);
    const originalPath = result.originalPath ?? contextTrack?.path;
    let pathMismatch = false;

    if (originalPath && item.path) {
      const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
      if (normalize(originalPath) === normalize(item.path)) return true;
      pathMismatch = true;
    }

    const originalHandle = result.originalFileHandle ?? contextTrack?.fileHandle;

    if (originalHandle && item.fileHandle) {
      if (originalHandle === item.fileHandle) return true;

      try {
        if (typeof originalHandle.isSameEntry === 'function' && await originalHandle.isSameEntry(item.fileHandle)) {
          return true;
        }
      } catch {
        // Stale handles can still be matched by the immutable source fingerprint below.
      }
    }

    if (pathMismatch) return false;

    const originalName = result.originalName ?? contextTrack?.name;
    const originalSize = result.originalSize ?? contextTrack?.size;
    const originalLastModified = result.originalLastModified ?? contextTrack?.lastModified;
    return Boolean(
      originalName
      && originalSize !== undefined
      && originalLastModified !== undefined
      && item.name.toLowerCase() === originalName.toLowerCase()
      && item.size === originalSize
      && item.lastModified === originalLastModified
    );
  }

  function getTroubadourExternalPatch(result: TroubadourBatchItemResult) {
    return {
      ...(result.file ? { file: result.file } : {}),
      ...(result.fileHandle ? { fileHandle: result.fileHandle } : {}),
      ...(result.path !== undefined ? { path: result.path } : {}),
      ...(result.sourceFolderId !== undefined ? { sourceFolderId: result.sourceFolderId } : {}),
      ...(result.name !== undefined ? { name: result.name } : {}),
      ...(result.extension !== undefined ? { extension: result.extension } : {}),
      ...(result.kind !== undefined ? { kind: result.kind } : {}),
      ...(result.size !== undefined ? { size: result.size } : {}),
      ...(result.lastModified !== undefined ? { lastModified: result.lastModified } : {}),
      ...(result.metadata !== undefined ? { metadata: result.metadata } : {})
    };
  }

  async function applyTroubadourResult(results: TroubadourBatchItemResult[]): Promise<void> {
    const successfulResults = results.filter((result) => result.success);
    const invalidatedTrackIds = new Set<string>();

    for (const result of successfulResults) {
      const patch = getTroubadourExternalPatch(result);
      const collections = [
        { name: 'playlist' as const, items: playlistItems, store: playlistStore },
        { name: 'library' as const, items: libraryItems, store: libraryStore },
        { name: 'favorites' as const, items: favoriteItems, store: favoritesStore }
      ];

      for (const collection of collections) {
        for (const item of collection.items) {
          if (await isTroubadourResultMatch(item, collection.name, result)) {
            collection.store.applyExternalUpdate(item.id, patch);
            invalidatedTrackIds.add(item.id);
          }
        }
      }

      if (playingTrack && await isTroubadourResultMatch(playingTrack, 'current', result)) {
        playerController.refreshCurrentTrack(playingTrack.id, patch);
        invalidatedTrackIds.add(playingTrack.id);
      }
    }

    await invalidateCachedArtwork(invalidatedTrackIds);
  }

  function handlePopupWindowMessage(event: MessageEvent): void {
    if (respondToToolTrackRequest(event, playingTrack)) {
      return;
    }

    const troubadourWindow = windowManager.getPopup('troubadour');

    if (event.data?.type === REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE) {
      const context = createTroubadourContext();

      if (respondToTroubadourBatchContextRequest(event, troubadourWindow, context)) {
        lastTroubadourContext = context;
        return;
      }
    }

    const troubadourResult = readTroubadourBatchResult(event, troubadourWindow);

    if (troubadourResult) {
      void applyTroubadourResult(troubadourResult.results);
      return;
    }

    if (event.origin !== window.location.origin || event.data?.type !== 'izci:open-options') {
      return;
    }

    const view = isOptionsViewName(event.data.view) ? event.data.view : undefined;
    windowManager.openOptions(view);
  }

  async function handleForceUpdate() {
    await forceServiceWorkerUpdateCheck();
  }

  function toggleNowPlayingView() {
    if (isNowPlayingLayoutActive) {
      closeNowPlayingView();
      return;
    }

    ensureComfortableNowPlayingWindowSize();

    autoNowPlayingSuppressed = false;
    appearanceSettings.update({
      nowPlayingViewActive: true
    });
  }

  function closeNowPlayingView() {
    if (isAutomaticNowPlayingEligible) {
      autoNowPlayingSuppressed = true;
    }

    restoreNowPlayingWindowSize();
    appearanceSettings.update({
      nowPlayingViewActive: false
    });
  }

  function enableNowPlayingView() {
    autoNowPlayingSuppressed = false;
    appearanceSettings.update({
      nowPlayingViewActive: true
    });
  }

  function handleNowPlayingTabChange(tab: WorkspaceTab) {
    workspaceShell.setActiveWorkspaceTab(tab);
  }

  function closeActiveRightPanel() {
    const rightPanel = workspaceShellState.workspacePanels.find((panel) => panel.id === 'right');
    const tabToClose =
      rightPanel?.activeTab ?? rightPanel?.tabs[0]?.id ?? null;

    if (!tabToClose) {
      return;
    }

    workspaceShell.closeWorkspaceTab(tabToClose);
  }

  function getCyclableWorkspaceTabs(): WorkspaceTab[] {
    return workspaceShellState.workspaceTabs.map((tab) => tab.id);
  }

  function cycleWorkspaceTab(direction: -1 | 1): boolean {
    const tabs = getCyclableWorkspaceTabs();

    if (tabs.length < 2) {
      return false;
    }

    const currentIndex = Math.max(tabs.indexOf(workspaceShellState.activeWorkspaceTab), 0);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];

    workspaceShell.setActiveWorkspaceTab(nextTab);
    return true;
  }

  async function toggleFullscreenNowPlaying(): Promise<void> {
    if (windowFullscreen.isControllerFullscreenActive()) {
      closeNowPlayingView();
      await windowFullscreen.exit();
      return;
    }

    if ($windowDisplayState.maximized || $windowDisplayState.fullscreen) {
      toggleNowPlayingView();
      return;
    }

    enableNowPlayingView();
    await windowFullscreen.enter();
  }

  $: if (playbackStatus.state !== previousPlaybackState) {
    if (playbackStatus.state === 'ended') {
      void playbackCommands.handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  onDestroy(() => {
    playbackRestoration.destroy();
    playbackProgress.destroy();
    artworkPresentation.destroy();
    lyricsPresentation.destroy();
    playCountTracker.destroy();
    workspaceShell.destroy();
    unsubscribePlaylistItems();
    unsubscribeLibraryItems();
    unsubscribeFavoriteItems();
    unsubscribePlaylistSelectedIds();
    unsubscribeLibrarySelectedIds();
    unsubscribeLibrarySelection();
    unsubscribeFavoriteSelectedIds();
    unsubscribeFavoriteSelection();
    unsubscribePlaylistSelectedTrack();
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

  <TopMenuBar
    bind:height={topMenuBarHeight}
    nowPlayingViewActive={isNowPlayingLayoutActive}
    miniPlayerSupported={miniPlayerState.supported}
    miniPlayerActive={miniPlayerState.active || miniPlayerState.opening}
    patternsVisible={workspaceShellState.isPatternsPanelVisible}
    videoActive={videoTrackActive}
    videoFitMode={$videoSettings.fitMode}
    {videoPictureInPictureSupported}
    {videoTheaterActive}
    installAvailable={appInstallState.available}
    showInstallHint={appInstallState.showHint}
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:installApp={() => void appInstallService.prompt()}
    on:acknowledgeInstallHint={() => appInstallService.acknowledgeHint()}
    on:openOptions={(event) => handleOpenOptions(event.detail?.view)}
    on:forceUpdate={() => void handleForceUpdate()}
    on:openAbout={handleOpenAbout}
    on:openAudioCompare={() => windowManager.openPopup('audioCompare')}
    on:openClipTag={() => windowManager.openPopup('clipTag')}
    on:openConverter={() => windowManager.openPopup('converter')}
    on:openTroubadour={() => windowManager.openPopup('troubadour')}
    on:showPlaylist={showPlaylist}
    on:showLibrary={showLibrary}
    on:showTrackDetails={showTrackDetails}
    on:showLyrics={showTrackLyrics}
    on:togglePatterns={togglePatterns}
    on:toggleMiniPlayer={() => miniPlayer.toggle()}
    on:toggleNowPlayingView={toggleNowPlayingView}
    on:setVideoFit={(event) => setVideoFit(event.detail)}
    on:toggleVideoPictureInPicture={() => void toggleVideoPictureInPicture()}
    on:toggleVideoTheater={toggleVideoTheater}
    on:exit={() => windowManager.exit()}
  />

  <AppWorkspace
    snapshotStore={playerController.snapshot}
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
    {playlistPanelHandlers}
    {libraryPanelHandlers}
    {selectedPlaylistItem}
    {playerDisplayTrack}
    {lyricsTrack}
    {modulePatternSnapshot}
    artworkState={artworkPresentationState}
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
    onTogglePlayback={() => void playbackCommands.togglePlayback()}
    onPreviousTrack={() => void playbackCommands.stepTrack(-1)}
    onNextTrack={() => void playbackCommands.stepTrack(1)}
    onPreviousSubsong={() => playerController.stepSubsong(-1)}
    onNextSubsong={() => playerController.stepSubsong(1)}
    onSeek={seekPlayback}
    onVolume={(volume) => playerController.setVolume(volume)}
    onMute={() => playerController.toggleMute()}
    onShowTrack={handleShowPlayerTrackDetails}
    onToggleVideoTheater={toggleVideoTheater}
    onToggleVideoPictureInPicture={() => void toggleVideoPictureInPicture()}
    onSetVideoFit={setVideoFit}
  />

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
      snapshotStore={playerController.snapshot}
      track={playerDisplayTrack}
      selectedTrack={selectedPlaylistItem}
      artwork={artworkPresentationState.displayedArtwork}
      backdropEffect={$appearanceSettings.backdropZones.player}
      backdropArtworkSettings={$appearanceSettings.backdropZoneArtwork.player}
      artworkBackgroundBright={backdropPresentation.artworkBackgroundBrightByZone.player}
      hasCollectionItems={playlistItems.length > 0 || libraryItems.length > 0 || favoriteItems.length > 0}
      {collectionsReady}
      showFavoriteToggle={$trackSettings.showFavoriteToggleInPlayerBar}
      favorite={favoriteTargetTrack ? favoritesHaveAllTracks(favoriteItems, [favoriteTargetTrack]) : false}
      showRafToggle={$playbackSettings.enableRaf && $playbackSettings.showRafToggleInPlayerBar}
      rafEnabled={$rafSettings.enabled}
      rafPresets={$rafPresets.presets}
      selectedRafPresetId={$rafPresets.selectedPresetId}
      rafPresetDirty={isRafPresetDirty($rafPresets, $rafSettings)}
      showVideoTheaterToggle={videoTrackActive}
      {videoTheaterActive}
      videoFullscreenActive={videoFullscreenExitAction}
      on:toggle={() => void playbackCommands.togglePlayback()}
      on:previous={() => void playbackCommands.stepTrack(-1)}
      on:next={() => void playbackCommands.stepTrack(1)}
      on:previousSubsong={() => playerController.stepSubsong(-1)}
      on:nextSubsong={() => playerController.stepSubsong(1)}
      on:seek={(event) => seekPlayback(event.detail)}
      on:volume={(event) => playerController.setVolume(event.detail)}
      on:mute={() => playerController.toggleMute()}
      on:toggleFavorite={() => favoriteTargetTrack && workspaceCollections.toggleFavoriteTracks([favoriteTargetTrack])}
      on:toggleRaf={() => rafSettings.setEnabled(!$rafSettings.enabled)}
      on:applyRafPreset={(event) => rafPresets.apply(event.detail)}
      on:openRafOptions={() => handleOpenOptions('raf')}
      on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
      on:toggleVideoTheater={toggleVideoTheater}
    />
  {/if}
</div>
