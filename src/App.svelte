<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import SharedBackdropArtwork from '$lib/components/SharedBackdropArtwork.svelte';
  import SharedBackdropVisualizer from '$lib/components/SharedBackdropVisualizer.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import NowPlayingWorkspace from '$lib/components/workspace/NowPlayingWorkspace.svelte';
  import TabbedWorkspace from '$lib/components/workspace/TabbedWorkspace.svelte';
  import WideWorkspace from '$lib/components/workspace/WideWorkspace.svelte';
  import type {
    WorkspacePanelHandlers
  } from '$lib/components/workspace/types';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import {
    isArtworkBackgroundBrightForBrightness,
    type ArtworkBackgroundAnalysis
  } from '$lib/services/artwork-background';
  import { createImportController, FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import { appInstallService, type AppInstallState } from '$lib/services/app-install';
  import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
  import { getTrackLyricsLoadKey, loadTrackLyrics } from '$lib/services/lyrics';
  import { createPlaybackCommandsController } from '$lib/services/playback-commands';
  import { createPlaybackRestorationController } from '$lib/services/playback-restoration';
  import { forceServiceWorkerUpdateCheck } from '$lib/services/pwa-updates';
  import { createWorkspaceShellController } from '$lib/services/workspace-shell';
  import { mediaSessionService } from '$lib/services/media-session';
  import { createPlayCountTracker } from '$lib/services/play-count';
  import { playerController } from '$lib/services/player-controller';
  import {
    buildLibraryContextActions,
    buildPlaylistContextActions,
    buildSelectedWorkspaceTracks,
    getEquivalentLibraryIds,
    libraryHasAllTracks
  } from '$lib/services/workspace-actions';
  import { WORKSPACE_RESIZER_WIDTH } from '$lib/services/workspace-layout';
  import { windowManager } from '$lib/services/window-manager';
  import { windowMiniMode } from '$lib/services/window-mini-mode';
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
    appearanceSettings,
    hasArtworkBackdrop,
    hasVisualizerBackdrop
  } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import { libraryStore, playlistStore } from '$lib/stores/playlist';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import type {
    BackdropZoneId,
    BackdropZoneSettings,
    BackdropZoneEffect,
    BackdropZoneArtworkSettingsMap,
    LyricsDisplayStyle,
    PlaybackSnapshot,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection,
    WorkspaceCollection,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import type { OptionsViewName } from './options/views';
  import {
    buildPlaylistItems,
    clonePlaylistItems,
    getTrackDisplayTitle,
    getTrackIdentity
  } from '$lib/utils/files';

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

  const KEYBOARD_SEEK_STEP_SECONDS = 5;
  const KEYBOARD_VOLUME_STEP = 0.05;
  type LyricsAvailability = 'unknown' | 'loading' | 'available' | 'unavailable';

  const libraryContextActions = buildLibraryContextActions();

  let playlistItems: PlaylistItem[] = [];
  let libraryItems: PlaylistItem[] = [];
  let collectionsReady = false;
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let selectedPlaylistItem: PlaylistItem | null = null;
  let selectedLibraryItem: PlaylistItem | null = null;
  let selectedItem: PlaylistItem | null = null;
  let livePlayingTrack: PlaylistItem | null = null;
  let playerDisplayTrack: PlaylistItem | null = null;
  let lyricsTrack: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
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

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  let innerHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  let previousPlaybackState: PlaybackSnapshot['state'] = playbackStatus.state;
  let backdropZones: BackdropZoneSettings = appearanceSettings.getSnapshot().backdropZones;
  let backdropZoneArtwork: BackdropZoneArtworkSettingsMap =
    appearanceSettings.getSnapshot().backdropZoneArtwork;
  let activeBackdropZoneIds: BackdropZoneId[] = [];
  let activeBackdropEffects: BackdropZoneEffect[] = [];
  let artworkBackgroundBrightByZone: Record<BackdropZoneId, boolean> = {
    left: false,
    center: false,
    right: false,
    player: false,
    nowPlaying: false
  };
  let workspaceZoneArtworkBright: Record<WorkspacePanelId, boolean> = {
    left: false,
    center: false,
    right: false
  };
  let nowPlayingViewActive = appearanceSettings.getSnapshot().nowPlayingViewActive;
  let isAutomaticNowPlayingEligible = false;
  let autoNowPlayingSuppressed = false;
  let isNowPlayingViewportEligible = false;
  let isNowPlayingLayoutActive = false;
  let isNowPlayingChromeHidden = false;
  let isFullscreenNowPlayingChromeHidden = false;
  let isArtworkBackdropRequested = false;
  let isVisualizerBackdropRequested = false;
  let isArtworkBackdropActive = false;
  let backdropGeometryKey = '';
  let documentTitle = 'izci';
  let wasNowPlayingLayoutActive = false;
  let effectiveLyricsDisplayStyle: LyricsDisplayStyle = 'timestamped';
  let lyricsAutoScroll = true;
  let lyricsFontSize = appearanceSettings.getSnapshot().lyrics.fontSizes.timestamped;
  let lyricsResumeAutoScrollToken = 0;
  let lyricsAvailability: LyricsAvailability = 'unknown';
  let lyricsAvailabilityTrackKey = '';
  let lyricsAvailabilityToken = 0;
  let lyricsAutomationSignature = '';
  let nowPlayingRestoreTab: WorkspaceTab | null = null;
  let nowPlayingAutoFocusedLyrics = false;
  let nowPlayingHadLyricsPanelVisible = false;
  let nowPlayingAutoFocusTrackKey = '';
  let nowPlayingLyricsAutoScrollSignature = '';
  const workspaceShell = createWorkspaceShellController({
    getPlaylistContextActions,
    getLibraryContextActions
  });
  let workspaceShellState = workspaceShell.getSnapshot();
  const playbackCommands = createPlaybackCommandsController({
    getPlayingTrack: () => playingTrack,
    getSelectedPlaylistTrack: () => selectedPlaylistItem,
    getPlaybackState: () => playbackStatus.state,
    getShuffleEnabled: () => shuffleEnabled,
    getRepeatMode: () => repeatMode,
    getTrackById: (collection, id) =>
      (collection === 'library' ? libraryItems : playlistItems).find((item) => item.id === id) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems
  });
  const playCountTracker = createPlayCountTracker({
    incrementLibraryPlayCount
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
  let miniModeActive = windowMiniMode.getSnapshot().active;
  let appInstallState: AppInstallState = { available: false, showHint: false };
  const unsubscribePlaylistItems = playlistItemsStore.subscribe((value) => (playlistItems = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (libraryItems = value));
  void Promise.all([playlistStore.ready(), libraryStore.ready()]).then(async () => {
    collectionsReady = true;
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
  const unsubscribePlaylistSelectedTrack = playlistSelectedTrackStore.subscribe(
    (value) => (selectedPlaylistItem = value)
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => (selectedLibraryItem = value)
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
  const unsubscribeArtworkPresentation = artworkPresentation.subscribe(
    (value) => (artworkPresentationState = value)
  );
  const unsubscribeWindowMiniMode = windowMiniMode.subscribe(
    (value) => (miniModeActive = value.active)
  );
  const unsubscribeAppInstall = appInstallService.subscribe((value) => (appInstallState = value));

  const importController = createImportController({
    addFiles: handleAddFiles,
    clickFileInput: () => fileInput?.click()
  });
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) =>
    void playbackCommands.replacePlaylistFromFiles(files)
  );
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: playerController.snapshot,
    track: playerController.currentTrack,
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
    workspaceShellState.activeCollection === 'library' ? selectedLibraryItem : selectedPlaylistItem;
  $: livePlayingTrack = resolveTrackSnapshot(playingTrack, selectedItem, playlistItems, libraryItems);
  $: playerDisplayTrack = livePlayingTrack;
  $: lyricsTrack = livePlayingTrack;
  $: backdropZones = $appearanceSettings.backdropZones;
  $: backdropZoneArtwork = $appearanceSettings.backdropZoneArtwork;
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
    !miniModeActive;
  $: isFullscreenNowPlayingChromeHidden =
    isNowPlayingLayoutActive && $windowDisplayState.fullscreen && isNowPlayingChromeHidden;
  $: if (!isNowPlayingLayoutActive || !$windowDisplayState.fullscreen) {
    isNowPlayingChromeHidden = false;
  }
  $: syncNowPlayingLayoutTransition(isNowPlayingLayoutActive);
  $: syncLyricsAvailability(lyricsTrack);
  $: syncNowPlayingLyricsAutoFocus(
    isNowPlayingLayoutActive,
    $appearanceSettings.lyrics.autoFocusInNowPlaying,
    lyricsAvailability,
    lyricsAvailabilityTrackKey,
    workspaceShellState.activeWorkspaceTab
  );
  $: syncNowPlayingLyricsAutoScroll(
    isNowPlayingLayoutActive,
    workspaceShellState.activeWorkspaceTab,
    lyricsAvailabilityTrackKey,
    effectiveLyricsDisplayStyle
  );
  $: applyLyricsPanelAvailabilityAutomation(
    lyricsAvailabilityTrackKey,
    lyricsAvailability,
    $appearanceSettings.lyrics.openPanelForLyrics,
    $appearanceSettings.lyrics.closePanelWithoutLyrics
  );
  $: effectiveLyricsDisplayStyle =
    isNowPlayingLayoutActive && $appearanceSettings.lyrics.autoTheaterInNowPlaying
      ? 'theater'
      : $appearanceSettings.lyrics.displayStyle;
  $: lyricsAutoScroll = effectiveLyricsDisplayStyle === 'theater' || $appearanceSettings.lyrics.autoScroll;
  $: lyricsFontSize = $appearanceSettings.lyrics.fontSizes[effectiveLyricsDisplayStyle];
  $: workspaceZoneEffects = {
    left: backdropZones.left,
    center: backdropZones.center,
    right: backdropZones.right
  };
  $: workspaceZoneArtworkSettings = {
    left: backdropZoneArtwork.left,
    center: backdropZoneArtwork.center,
    right: backdropZoneArtwork.right
  };
  $: workspaceZoneArtworkBright = {
    left: artworkBackgroundBrightByZone.left,
    center: artworkBackgroundBrightByZone.center,
    right: artworkBackgroundBrightByZone.right
  };
  $: activeBackdropZoneIds = isNowPlayingLayoutActive
    ? ['nowPlaying']
    : miniModeActive
      ? ['player']
      : ['left', 'center', 'right', 'player'];
  $: activeBackdropEffects = activeBackdropZoneIds.map((zoneId) => backdropZones[zoneId]);
  $: isArtworkBackdropRequested = activeBackdropEffects.some(hasArtworkBackdrop);
  $: isVisualizerBackdropRequested = activeBackdropEffects.some(hasVisualizerBackdrop);
  $: isArtworkBackdropActive =
    isArtworkBackdropRequested && Boolean(artworkPresentationState.visibleArtworkBackground);
  $: artworkBackgroundBrightByZone = {
    left: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.left,
      artworkPresentationState.artworkBackgroundAnalysis,
      backdropZoneArtwork.left.brightness
    ),
    center: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.center,
      artworkPresentationState.artworkBackgroundAnalysis,
      backdropZoneArtwork.center.brightness
    ),
    right: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.right,
      artworkPresentationState.artworkBackgroundAnalysis,
      backdropZoneArtwork.right.brightness
    ),
    player: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.player,
      artworkPresentationState.artworkBackgroundAnalysis,
      backdropZoneArtwork.player.brightness
    ),
    nowPlaying: resolveZoneArtworkBackgroundBright(
      isArtworkBackdropActive,
      backdropZones.nowPlaying,
      artworkPresentationState.artworkBackgroundAnalysis,
      backdropZoneArtwork.nowPlaying.brightness
    )
  };
  $: backdropGeometryKey = [
    isNowPlayingLayoutActive ? 'now-playing' : miniModeActive ? 'mini' : workspaceShellState.isTabbedLayout ? 'tabbed' : 'wide',
    workspaceShellState.activeWorkspaceTab,
    workspaceShellState.visibleWorkspacePanels.join(','),
    workspaceShellState.workspaceTabs.map((tab) => tab.id).join(','),
    workspaceShellState.isDetailsPanelVisible ? 'details-open' : 'details-closed',
    workspaceShellState.isLyricsPanelVisible ? 'lyrics-open' : 'lyrics-closed',
    backdropZones.left,
    backdropZones.center,
    backdropZones.right,
    backdropZones.player,
    backdropZones.nowPlaying,
    backdropZoneArtwork.left.blur,
    backdropZoneArtwork.left.brightness,
    backdropZoneArtwork.center.blur,
    backdropZoneArtwork.center.brightness,
    backdropZoneArtwork.right.blur,
    backdropZoneArtwork.right.brightness,
    backdropZoneArtwork.player.blur,
    backdropZoneArtwork.player.brightness,
    backdropZoneArtwork.nowPlaying.blur,
    backdropZoneArtwork.nowPlaying.brightness,
    artworkBackgroundBrightByZone.left ? 'left-bright' : 'left-dim',
    artworkBackgroundBrightByZone.center ? 'center-bright' : 'center-dim',
    artworkBackgroundBrightByZone.right ? 'right-bright' : 'right-dim',
    artworkBackgroundBrightByZone.player ? 'player-bright' : 'player-dim',
    artworkBackgroundBrightByZone.nowPlaying ? 'now-playing-bright' : 'now-playing-dim',
    $windowControlsOverlayState.visible ? 'wco-visible' : 'wco-hidden',
    Math.round($windowControlsOverlayState.titlebarAreaRect.x),
    Math.round($windowControlsOverlayState.titlebarAreaRect.y),
    Math.round($windowControlsOverlayState.titlebarAreaRect.width),
    Math.round($windowControlsOverlayState.titlebarAreaRect.height),
    innerWidth,
    innerHeight
  ].join(':');
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
    playlistSelectionIds,
    librarySelectionIds,
    librarySelectionAnchorId,
    playingTrackId: playingTrack?.id ?? null,
    shuffleEnabled,
    repeatMode,
    keepEmptyWorkspacePanelsOpen: $appearanceSettings.keepEmptyWorkspacePanelsOpen
  });
  $: {
    artworkPresentation.syncSelection(
      selectedItem,
      playlistSelectionIds.length > 0 || librarySelectionIds.length > 0
    );
    void artworkPresentation.syncDetailsDisplay();
  }
  $: void artworkPresentation.syncDisplayedArtwork(playerDisplayTrack);
  $: void artworkPresentation.syncArtworkBrightness(
    artworkPresentationState.visibleArtworkBackground,
    isArtworkBackdropRequested
  );
  $: artworkPresentation.syncArtworkMenuClasses(
    false,
    false
  );
  $: artworkPresentation.setWindowControlsOverlayVisible($windowControlsOverlayState.visible);

  const playlistPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => handleAddFiles(files, 'playlist'),
    openFiles: () => void handleMenuOpenFiles('playlist'),
    select: (event) => handleSelect('playlist', event),
    activate: (event) => void playbackCommands.activatePlaylistTrack(event.detail),
    contextAction: handlePlaylistContextAction,
    toggleShuffle: () => playlistStore.toggleShuffle(),
    cycleRepeat: () => playlistStore.cycleRepeatMode()
  };
  const libraryPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => handleAddFiles(files, 'library'),
    openFiles: () => void handleMenuOpenFiles('library'),
    select: (event) => handleSelect('library', event),
    setSelection: (event) => handleSetSelection('library', event),
    activate: (event) => void playbackCommands.activateLibraryTrack(event.detail),
    contextAction: handleLibraryContextAction
  };

  function cleanupRemovedItems(items: PlaylistItem[]) {
    for (const item of items) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }
  }

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

  function addFiles(files: FileList | File[], target: WorkspaceCollection) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    appInstallService.markEngaged();

    return (target === 'library' ? libraryStore : playlistStore).add(nextItems);
  }

  function handleAddFiles(
    files: FileList | File[],
    target: WorkspaceCollection = workspaceShellState.activeCollection
  ) {
    const nextItems = addFiles(files, target);
    const selectedIds = target === 'library' ? librarySelectionIds : playlistSelectionIds;

    if (nextItems.length > 0 && selectedIds.length === 0) {
      workspaceShell.selectTrack(target, nextItems[0].id);
      return;
    }

    workspaceShell.focusCollection(target);
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

  function handleShowPlaylistTrack(id: string) {
    workspaceShell.showPlaylistTrack(id);
  }

  function handleShowPlayerTrackDetails(id: string) {
    handleShowPlaylistTrack(id);
    workspaceShell.showTrackDetails();
  }

  function resolveZoneArtworkBackgroundBright(
    active: boolean,
    effect: BackdropZoneEffect,
    analysis: ArtworkBackgroundAnalysis,
    brightness: number
  ): boolean {
    return (
      active &&
      hasArtworkBackdrop(effect) &&
      isArtworkBackgroundBrightForBrightness(analysis, brightness)
    );
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

  function seekPlayback(seconds: number): void {
    lyricsResumeAutoScrollToken += 1;
    playbackCommands.seek(seconds);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function syncLyricsAvailability(track: PlaylistItem | null): void {
    const nextTrackKey = getTrackLyricsLoadKey(track);

    if (nextTrackKey === lyricsAvailabilityTrackKey) {
      return;
    }

    lyricsAvailabilityTrackKey = nextTrackKey;
    const currentToken = ++lyricsAvailabilityToken;

    if (!track || !nextTrackKey) {
      lyricsAvailability = 'unavailable';
      return;
    }

    lyricsAvailability = 'loading';

    void loadTrackLyrics(track)
      .then((loadedLyrics) => {
        if (currentToken === lyricsAvailabilityToken) {
          lyricsAvailability = loadedLyrics ? 'available' : 'unavailable';
        }
      })
      .catch(() => {
        if (currentToken === lyricsAvailabilityToken) {
          lyricsAvailability = 'unavailable';
        }
      });
  }

  function applyLyricsPanelAvailabilityAutomation(
    trackKey: string,
    availability: LyricsAvailability,
    openWhenAvailable: boolean,
    closeWhenUnavailable: boolean
  ): void {
    const signature = `${trackKey}:${availability}:${openWhenAvailable}:${closeWhenUnavailable}`;

    if (signature === lyricsAutomationSignature || availability === 'loading' || availability === 'unknown') {
      return;
    }

    lyricsAutomationSignature = signature;

    if (availability === 'available' && openWhenAvailable) {
      workspaceShell.showTrackLyrics();
      return;
    }

    if (availability === 'unavailable' && closeWhenUnavailable && workspaceShellState.isLyricsPanelVisible) {
      workspaceShell.closeTrackLyrics();
    }
  }

  function restoreWorkspaceTab(tab: WorkspaceTab): void {
    if (!workspaceShellState.workspaceTabs.some((workspaceTab) => workspaceTab.id === tab)) {
      return;
    }

    workspaceShell.setActiveWorkspaceTab(tab);
  }

  function syncNowPlayingLayoutTransition(isActive: boolean): void {
    if (isActive === wasNowPlayingLayoutActive) {
      return;
    }

    if (isActive) {
      nowPlayingRestoreTab = workspaceShellState.activeWorkspaceTab;
      nowPlayingAutoFocusedLyrics = false;
      nowPlayingHadLyricsPanelVisible = workspaceShellState.isLyricsPanelVisible;
      nowPlayingAutoFocusTrackKey = '';
      wasNowPlayingLayoutActive = true;
      return;
    }

    if (
      nowPlayingAutoFocusedLyrics &&
      workspaceShellState.activeWorkspaceTab === 'lyrics' &&
      nowPlayingRestoreTab
    ) {
      restoreWorkspaceTab(nowPlayingRestoreTab);
    }

    if (
      nowPlayingAutoFocusedLyrics &&
      !nowPlayingHadLyricsPanelVisible &&
      workspaceShellState.isLyricsPanelVisible
    ) {
      workspaceShell.closeTrackLyrics();
    }

    nowPlayingRestoreTab = null;
    nowPlayingAutoFocusedLyrics = false;
    nowPlayingHadLyricsPanelVisible = false;
    nowPlayingAutoFocusTrackKey = '';
    wasNowPlayingLayoutActive = false;
  }

  function syncNowPlayingLyricsAutoFocus(
    isLayoutActive: boolean,
    autoFocusInNowPlaying: boolean,
    availability: LyricsAvailability,
    trackKey: string,
    activeWorkspaceTab: WorkspaceTab
  ): void {
    if (
      !isLayoutActive ||
      !autoFocusInNowPlaying ||
      availability !== 'available' ||
      !trackKey ||
      nowPlayingAutoFocusTrackKey === trackKey
    ) {
      return;
    }

    nowPlayingAutoFocusTrackKey = trackKey;

    if (activeWorkspaceTab === 'lyrics') {
      return;
    }

    nowPlayingRestoreTab ??= activeWorkspaceTab;
    nowPlayingAutoFocusedLyrics = true;
    workspaceShell.showTrackLyrics();
  }

  function syncNowPlayingLyricsAutoScroll(
    isLayoutActive: boolean,
    activeWorkspaceTab: WorkspaceTab,
    trackKey: string,
    displayStyle: LyricsDisplayStyle
  ): void {
    const signature =
      isLayoutActive && activeWorkspaceTab === 'lyrics'
        ? `${trackKey}:${displayStyle}`
        : '';

    if (signature === nowPlayingLyricsAutoScrollSignature) {
      return;
    }

    nowPlayingLyricsAutoScrollSignature = signature;

    if (signature) {
      lyricsResumeAutoScrollToken += 1;
    }
  }

  async function handleMenuOpenFiles(target: WorkspaceCollection = workspaceShellState.activeCollection) {
    await importController.openFiles(target);
  }

  async function handleMenuOpenFolder(target: WorkspaceCollection = workspaceShellState.activeCollection) {
    await importController.openFolder(target);
  }

  function handleMenuInput(event: Event) {
    importController.handleFileInputChange(event);
  }

  function handleOpenOptions(view?: OptionsViewName) {
    windowManager.openOptions(view);
  }

  function handleOpenAbout() {
    windowManager.openOptions('about');
  }

  async function handleForceUpdate() {
    await forceServiceWorkerUpdateCheck();
  }

  function toggleNowPlayingView() {
    if (isNowPlayingLayoutActive) {
      closeNowPlayingView();
      return;
    }

    if (miniModeActive) {
      windowMiniMode.exit();
      window.requestAnimationFrame(() => {
        ensureComfortableNowPlayingWindowSize();
      });
    } else {
      ensureComfortableNowPlayingWindowSize();
    }

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

  function seekByKeyboardStep(direction: -1 | 1): void {
    if (!playingTrack || playbackSnapshot.duration <= 0) {
      return;
    }

    seekPlayback(
      clamp(
        playbackSnapshot.currentTime + direction * KEYBOARD_SEEK_STEP_SECONDS,
        0,
        playbackSnapshot.duration
      )
    );
  }

  function changeVolumeByKeyboardStep(direction: -1 | 1): void {
    playerController.setVolume(
      clamp(playbackSnapshot.volume + direction * KEYBOARD_VOLUME_STEP, 0, 1)
    );
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

    if (miniModeActive) {
      windowMiniMode.exit();
    }

    enableNowPlayingView();
    await windowFullscreen.enter();
  }

  function shouldIgnoreKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function isTrackRowKeyboardTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest('[data-track-row-button]'));
  }

  function shouldIgnorePlaybackKeyboardTarget(target: EventTarget | null) {
    if (shouldIgnoreKeyboardTarget(target)) {
      return true;
    }

    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tagName = target.tagName;
    return (
      (tagName === 'BUTTON' || tagName === 'A') &&
      !isTrackRowKeyboardTarget(target)
    );
  }

  function handleWindowContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault();
      void toggleFullscreenNowPlaying();
      return;
    }

    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (isNowPlayingLayoutActive) {
        event.preventDefault();
        closeNowPlayingView();
        return;
      }

      if (workspaceShellState.isRightPanelVisible) {
        event.preventDefault();
        closeActiveRightPanel();
      }

      return;
    }

    if (event.key === 'Delete' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      const ids =
        workspaceShellState.activeCollection === 'library' ? librarySelectionIds : playlistSelectionIds;

      if (ids.length === 0) {
        return;
      }

      event.preventDefault();

      if (workspaceShellState.activeCollection === 'library') {
        removeLibraryItems(ids);
      } else {
        removePlaylistItems(ids);
      }

      return;
    }

    if (event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      if (cycleWorkspaceTab(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'ArrowLeft' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      seekByKeyboardStep(-1);
      return;
    }

    if (event.key === 'ArrowRight' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      seekByKeyboardStep(1);
      return;
    }

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      void playbackCommands.stepTrack(event.key === 'ArrowLeft' ? -1 : 1);
      return;
    }

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      changeVolumeByKeyboardStep(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }

    if (event.key === 'Enter' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnorePlaybackKeyboardTarget(event.target)) {
        return;
      }

      const selectedTrack =
        workspaceShellState.activeCollection === 'library' ? selectedLibraryItem : selectedPlaylistItem;

      if (!selectedTrack) {
        return;
      }

      event.preventDefault();

      if (workspaceShellState.activeCollection === 'library') {
        void playbackCommands.activateLibraryTrack(selectedTrack.id);
      } else {
        void playbackCommands.activatePlaylistTrack(selectedTrack.id);
      }

      return;
    }

    if (event.key === ' ' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnorePlaybackKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      void playbackCommands.togglePlayback();
      return;
    }

    if (event.key.toLowerCase() === 'm' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnorePlaybackKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();
      playerController.toggleMute();
      return;
    }

    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      return;
    }

    if (shouldIgnoreKeyboardTarget(event.target)) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'a':
        event.preventDefault();
        workspaceShell.selectAllTracks(workspaceShellState.activeCollection);
        break;
      case 'o':
        event.preventDefault();
        void handleMenuOpenFiles();
        break;
      case 'p':
        event.preventDefault();
        handleOpenOptions();
        break;
      case 'm':
        event.preventDefault();
        windowMiniMode.toggle();
        break;
      case 'q':
        event.preventDefault();
        windowManager.exit();
        break;
    }
  }


  function removePlaylistItems(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    const removedSet = new Set(ids);
    const removedItems = playlistStore.remove(ids);

    if (playingTrack && removedSet.has(playingTrack.id)) {
      playerController.unload();
    }

    cleanupRemovedItems(removedItems);
  }

  function removeLibraryItems(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    cleanupRemovedItems(libraryStore.remove(ids));
  }

  function getPlaylistContextActions(ids: string[]) {
    return buildPlaylistContextActions(playlistItems, libraryItems, ids);
  }

  function getLibraryContextActions() {
    return libraryContextActions;
  }

  function incrementLibraryPlayCount(libraryItemId: string): void {
    const item = libraryItems.find((entry) => entry.id === libraryItemId);
    const currentPlayCount = item?.metadata?.playCount ?? 0;
    const nextPlayCount = Number.isFinite(currentPlayCount)
      ? Math.max(0, Math.floor(currentPlayCount)) + 1
      : 1;

    libraryStore.updateMetadata(libraryItemId, {
      playCount: nextPlayCount
    });
  }

  function resetLibraryPlayCounts(ids: string[]): void {
    for (const id of ids) {
      libraryStore.updateMetadata(id, {
        playCount: 0
      });
    }
  }

  function handlePlaylistContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      workspaceShell.showTrackDetails();
      return;
    }

    if (actionId === 'track-lyrics') {
      workspaceShell.showTrackLyrics();
      return;
    }

    if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(libraryItems, tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(libraryItems, tracks));
        return;
      }

      const addedItems = libraryStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        workspaceShell.selectTrack('library', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removePlaylistItems(ids);
    }
  }

  function handleLibraryContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedWorkspaceTracks(libraryItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      workspaceShell.showTrackDetails();
      return;
    }

    if (actionId === 'track-lyrics') {
      workspaceShell.showTrackLyrics();
      return;
    }

    if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0) {
        workspaceShell.selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));

      cleanupRemovedItems(removedItems);
      playerController.unload();

      if (addedItems.length > 0) {
        workspaceShell.selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'reset-play-count') {
      resetLibraryPlayCounts(ids);
      return;
    }

    if (actionId === 'remove') {
      removeLibraryItems(ids);
    }
  }

  $: if (playbackStatus.state !== previousPlaybackState) {
    if (playbackStatus.state === 'ended') {
      void playbackCommands.handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  onDestroy(() => {
    playbackRestoration.destroy();
    artworkPresentation.destroy();
    playCountTracker.destroy();
    workspaceShell.destroy();
    unsubscribePlaylistItems();
    unsubscribeLibraryItems();
    unsubscribePlaylistSelectedIds();
    unsubscribeLibrarySelectedIds();
    unsubscribeLibrarySelection();
    unsubscribePlaylistSelectedTrack();
    unsubscribeLibrarySelectedTrack();
    unsubscribeShuffle();
    unsubscribeRepeat();
    unsubscribeTrack();
    unsubscribePlaybackSnapshot();
    unsubscribePlaybackStatus();
    unsubscribeWorkspaceShell();
    unsubscribePlaybackCommands();
    unsubscribeArtworkPresentation();
    unsubscribeWindowMiniMode();
    unsubscribeAppInstall();
    appInstallService.destroy();
    unsubscribeLaunchedFiles();
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
  on:contextmenu={handleWindowContextMenu}
  on:keydown={handleWindowKeydown}
  on:pointermove={(event) => workspaceShell.handlePanelResizeMove(event)}
  on:pointerup={() => workspaceShell.endPanelResize()}
  on:pointercancel={() => workspaceShell.endPanelResize()}
/>

<div
  class="app-shell"
  class:tabbed-layout={workspaceShellState.isTabbedLayout}
  class:mini-mode={miniModeActive}
  class:now-playing-mode={isNowPlayingLayoutActive}
  class:now-playing-theater-chrome-hidden={isFullscreenNowPlayingChromeHidden}
  class:window-chrome-transition-bypass={artworkPresentationState.isWindowChromeTransitionBypassed}
  class:window-controls-overlay-active={$windowControlsOverlayState.visible}
>
  {#if isArtworkBackdropActive}
    <SharedBackdropArtwork
      artworkUrl={artworkPresentationState.visibleArtworkBackground?.url}
      geometryKey={backdropGeometryKey}
    />
  {/if}

  {#if isVisualizerBackdropRequested}
    <SharedBackdropVisualizer
      artworkUrl={artworkPresentationState.displayedArtwork?.url}
      geometryKey={backdropGeometryKey}
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

  <TopMenuBar
    {miniModeActive}
    nowPlayingViewActive={isNowPlayingLayoutActive}
    installAvailable={appInstallState.available}
    showInstallHint={appInstallState.showHint}
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:installApp={() => void appInstallService.prompt()}
    on:acknowledgeInstallHint={() => appInstallService.acknowledgeHint()}
    on:openOptions={(event) => handleOpenOptions(event.detail?.view)}
    on:forceUpdate={() => void handleForceUpdate()}
    on:openAbout={handleOpenAbout}
    on:showPlaylist={showPlaylist}
    on:showLibrary={showLibrary}
    on:showTrackDetails={showTrackDetails}
    on:showLyrics={showTrackLyrics}
    on:toggleMiniMode={() => windowMiniMode.toggle()}
    on:toggleNowPlayingView={toggleNowPlayingView}
    on:exit={() => windowManager.exit()}
  />

  {#if isNowPlayingLayoutActive}
    <NowPlayingWorkspace
      snapshotStore={playerController.snapshot}
      {playbackSnapshot}
      track={playerDisplayTrack}
      selectedTrack={selectedPlaylistItem}
      artwork={artworkPresentationState.displayedArtwork}
      backdropArtwork={artworkPresentationState.visibleArtworkBackground}
      artworkBackgroundBright={artworkBackgroundBrightByZone.nowPlaying}
      backdropEffect={backdropZones.nowPlaying}
      backdropArtworkSettings={backdropZoneArtwork.nowPlaying}
      activeWorkspaceTab={workspaceShellState.activeWorkspaceTab}
      workspaceTabs={workspaceShellState.workspaceTabs}
      playlistPanelProps={workspaceShellState.playlistPanelProps}
      {playlistPanelHandlers}
      libraryPanelProps={workspaceShellState.libraryPanelProps}
      {libraryPanelHandlers}
      selectedItem={artworkPresentationState.detailsDisplayTrack}
      {lyricsTrack}
      lyricsDisplayStyle={effectiveLyricsDisplayStyle}
      {lyricsAutoScroll}
      {lyricsFontSize}
      {lyricsResumeAutoScrollToken}
      lyricsTheaterDowntimeDots={$appearanceSettings.lyrics.theaterDowntimeDots}
      lyricsTheaterDowntimeThresholdSeconds={$appearanceSettings.lyrics.theaterDowntimeThresholdSeconds}
      lyricsTheaterSmoothScroll={$appearanceSettings.lyrics.theaterSmoothScroll}
      panelAutoHideDelaySeconds={$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}
      alwaysUseArtworkPlayerColors={$appearanceSettings.useNowPlayingArtworkPlayerColors}
      on:close={closeNowPlayingView}
      on:chromeHiddenChange={(event) => (isNowPlayingChromeHidden = event.detail)}
      on:tabChange={(event) => handleNowPlayingTabChange(event.detail)}
      on:tabClose={(event) => workspaceShell.closeWorkspaceTab(event.detail)}
      on:tabMove={(event) => workspaceShell.moveTabbedWorkspaceTab(event.detail)}
      on:toggle={() => void playbackCommands.togglePlayback()}
      on:previous={() => void playbackCommands.stepTrack(-1)}
      on:next={() => void playbackCommands.stepTrack(1)}
      on:seek={(event) => seekPlayback(event.detail)}
      on:volume={(event) => playerController.setVolume(event.detail)}
      on:mute={() => playerController.toggleMute()}
      on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
    />
  {:else if !miniModeActive}
    {#if workspaceShellState.isTabbedLayout}
      <TabbedWorkspace
        snapshotStore={playerController.snapshot}
        {playbackSnapshot}
        activeWorkspaceTab={workspaceShellState.activeWorkspaceTab}
        workspaceTabs={workspaceShellState.workspaceTabs}
        playlistPanelProps={workspaceShellState.playlistPanelProps}
        {playlistPanelHandlers}
        libraryPanelProps={workspaceShellState.libraryPanelProps}
        {libraryPanelHandlers}
        selectedItem={artworkPresentationState.detailsDisplayTrack}
        detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
        {lyricsTrack}
        backdropArtwork={artworkPresentationState.visibleArtworkBackground}
        zoneArtworkBright={workspaceZoneArtworkBright}
        zoneEffects={workspaceZoneEffects}
        zoneArtworkSettings={workspaceZoneArtworkSettings}
        lyricsDisplayStyle={effectiveLyricsDisplayStyle}
        {lyricsAutoScroll}
        {lyricsFontSize}
        {lyricsResumeAutoScrollToken}
        lyricsTheaterDowntimeDots={$appearanceSettings.lyrics.theaterDowntimeDots}
        lyricsTheaterDowntimeThresholdSeconds={$appearanceSettings.lyrics.theaterDowntimeThresholdSeconds}
        lyricsTheaterSmoothScroll={$appearanceSettings.lyrics.theaterSmoothScroll}
        on:seek={(event) => seekPlayback(event.detail)}
        on:tabChange={(event) => workspaceShell.setActiveWorkspaceTab(event.detail)}
        on:tabClose={(event) => workspaceShell.closeWorkspaceTab(event.detail)}
        on:tabMove={(event) => workspaceShell.moveTabbedWorkspaceTab(event.detail)}
      />
    {:else}
      <WideWorkspace
        snapshotStore={playerController.snapshot}
        {playbackSnapshot}
        workspacePanels={workspaceShellState.workspacePanels}
        playlistPanelProps={workspaceShellState.playlistPanelProps}
        {playlistPanelHandlers}
        libraryPanelProps={workspaceShellState.libraryPanelProps}
        {libraryPanelHandlers}
        panelWidths={workspaceShellState.widePanelWidths}
        resizerWidth={WORKSPACE_RESIZER_WIDTH}
        isResizing={workspaceShellState.isResizing}
        selectedItem={artworkPresentationState.detailsDisplayTrack}
        detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
        {lyricsTrack}
        backdropArtwork={artworkPresentationState.visibleArtworkBackground}
        zoneArtworkBright={workspaceZoneArtworkBright}
        zoneEffects={workspaceZoneEffects}
        zoneArtworkSettings={workspaceZoneArtworkSettings}
        lyricsDisplayStyle={effectiveLyricsDisplayStyle}
        {lyricsAutoScroll}
        {lyricsFontSize}
        {lyricsResumeAutoScrollToken}
        lyricsTheaterDowntimeDots={$appearanceSettings.lyrics.theaterDowntimeDots}
        lyricsTheaterDowntimeThresholdSeconds={$appearanceSettings.lyrics.theaterDowntimeThresholdSeconds}
        lyricsTheaterSmoothScroll={$appearanceSettings.lyrics.theaterSmoothScroll}
        on:seek={(event) => seekPlayback(event.detail)}
        on:tabChange={(event) => workspaceShell.setActiveWorkspaceTab(event.detail)}
        on:tabClose={(event) => workspaceShell.closeWorkspaceTab(event.detail)}
        on:tabMove={(event) => workspaceShell.moveWorkspaceTab(event.detail)}
        on:resizeStart={(event) => workspaceShell.handleWideWorkspaceResizeStart(event.detail)}
      />
    {/if}
  {/if}

  {#if playbackStatus.error && !miniModeActive}
    <aside class="error-banner">{playbackStatus.error}</aside>
  {/if}

  {#if !isNowPlayingLayoutActive}
    <PlayerControls
      snapshotStore={playerController.snapshot}
      track={playerDisplayTrack}
      selectedTrack={selectedPlaylistItem}
      artwork={artworkPresentationState.displayedArtwork}
      backdropEffect={backdropZones.player}
      backdropArtworkSettings={backdropZoneArtwork.player}
      artworkBackgroundBright={artworkBackgroundBrightByZone.player}
      hasCollectionItems={playlistItems.length > 0 || libraryItems.length > 0}
      {collectionsReady}
      on:toggle={() => void playbackCommands.togglePlayback()}
      on:previous={() => void playbackCommands.stepTrack(-1)}
      on:next={() => void playbackCommands.stepTrack(1)}
      on:seek={(event) => seekPlayback(event.detail)}
      on:volume={(event) => playerController.setVolume(event.detail)}
      on:mute={() => playerController.toggleMute()}
      on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
    />
  {/if}
</div>
