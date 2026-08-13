<script lang="ts">
  import { onDestroy } from 'svelte';
  import { writable } from 'svelte/store';
  import { t } from 'svelte-i18n';
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
  import { createAppShortcuts } from '$lib/services/app-shortcuts';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import { invalidateCachedArtwork } from '$lib/services/artwork-cache';
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
  import {
    createPlaybackCommandsController,
    shouldRestartForPrevious
  } from '$lib/services/playback-commands';
  import { createMiniPlayerController, type MiniPlayerState } from '$lib/services/mini-player';
  import {
    createPlaybackProgressController,
    type PlaybackProgressState
  } from '$lib/services/playback-progress';
  import { createPlaybackRestorationController } from '$lib/services/playback-restoration';
  import { forceServiceWorkerUpdateCheck } from '$lib/services/pwa-updates';
  import { logError } from '$lib/logging/api';
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
  import { disposePlaylistMetadata } from '$lib/stores/playlist-metadata';
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
    detachTrackForMetadataWrite,
    readTroubadourBatchResult,
    readTroubadourWritePreparationRequest,
    REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE,
    respondToTroubadourBatchContextRequest,
    respondToTroubadourWritePreparation,
    type TroubadourBatchContext,
    type TroubadourBatchItemResult,
    type TroubadourTrackReference,
    type TroubadourWriteTarget
  } from '$lib/services/troubadour-sync';
  import type { LyricsDisplayStyle } from '$lib/contracts/appearance-settings';
  import type { ModulePatternSnapshot } from '$lib/contracts/module-playback';
  import type { PlaybackSnapshot } from '$lib/contracts/playback';
  import type { MediaEntity, PlaylistRepeatMode, PlaylistSelection } from '$lib/contracts/catalog';
  import type { VideoFitMode } from '$lib/contracts/player-settings';
  import type { WorkspaceCollection, WorkspaceTab } from '$lib/contracts/workspace';
  import { buildOptionsWindowPath, isOptionsViewName, type OptionsViewName } from './options/views';
  import { getFavoriteIdentity, getTrackDisplayTitle, getTrackIdentity } from '$lib/utils/files';
  import {
    buildFreeplayLibraryContextActions,
    buildFreeplayPlaylistContextActions,
    buildSelectedWorkspaceTracks,
    favoritesHaveAllTracks,
    resolveTrackLibraryNavigationAction
  } from '$lib/services/workspace-actions';
  import { experimentalSettings } from '$lib/stores/experimental-settings';
  import { multiplayerRecents } from '$lib/stores/multiplayer-recents';
  import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
  import {
    forgetMultiplayerPairing,
    multiplayerPairings
  } from '$lib/stores/multiplayer-pairings';
  import {
    createMultiplayerSession
  } from '$lib/services/multiplayer-session';
  import { multiplayerRenderPlaybackService } from '$lib/services/multiplayer-render-playback';
  import type { MultiplayerSessionState } from '$lib/services/multiplayer-types';
  import { resolveMultiplayerPlayingTrackSelection } from '$lib/services/multiplayer-selection';
  import {
    getRemoteArtworkLoadKey,
    toLoadedMultiplayerArtwork
  } from '$lib/services/multiplayer-artwork';
  import type { MultiplayerCommand } from '$lib/services/multiplayer-protocol';
  import { mediaEntityFromMultiplayerTrack } from '$lib/services/multiplayer-host-projection';
  import { mediaSources } from '$lib/media/media-source';
  import {
    buildSelectAllSelection,
    emptySelection,
    resolveSelectSelection
  } from '$lib/stores/playlist-selection';

  const {
    items: playlistItemsStore,
    selectedIds: playlistSelectedIdsStore,
    selectedTrack: playlistSelectedTrackStore,
    shuffleEnabled: shuffleStore,
    repeatMode: repeatStore
  } = playlistStore;
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

  let localMediaEntities: MediaEntity[] = [];
  let localLibraryItems: MediaEntity[] = [];
  let localFavoriteItems: MediaEntity[] = [];
  let playlistItems: MediaEntity[] = [];
  let libraryItems: MediaEntity[] = [];
  let favoriteItems: MediaEntity[] = [];
  let localCollectionsReady = false;
  let collectionsReady = false;
  let localPlaylistSelectionIds: string[] = [];
  let localLibrarySelectionIds: string[] = [];
  let localLibrarySelectionAnchorId: string | null = null;
  let localFavoriteSelectionIds: string[] = [];
  let localFavoriteSelectionAnchorId: string | null = null;
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let favoriteSelectionIds: string[] = [];
  let favoriteSelectionAnchorId: string | null = null;
  let remotePlaylistSelection: PlaylistSelection = emptySelection;
  let remoteLibrarySelection: PlaylistSelection = emptySelection;
  let remoteFavoriteSelection: PlaylistSelection = emptySelection;
  let lastPrunedRemoteCatalog: MultiplayerSessionState['remoteCatalog'] | null = null;
  let observedRemotePlayingTrackId: string | null = null;
  let lastTroubadourContext: TroubadourBatchContext | null = null;
  let localSelectedMediaEntity: MediaEntity | null = null;
  let localSelectedLibraryItem: MediaEntity | null = null;
  let localSelectedFavoriteItem: MediaEntity | null = null;
  let selectedMediaEntity: MediaEntity | null = null;
  let selectedLibraryItem: MediaEntity | null = null;
  let selectedFavoriteItem: MediaEntity | null = null;
  let selectedItem: MediaEntity | null = null;
  let livePlayingTrack: MediaEntity | null = null;
  let playerDisplayTrack: MediaEntity | null = null;
  let favoriteTargetTrack: MediaEntity | null = null;
  let lyricsTrack: MediaEntity | null = null;
  let detailsLibraryTargets: TrackLibraryNavigationTargets = {};
  let localPlayingTrack: MediaEntity | null = null;
  let playingTrack: MediaEntity | null = null;
  let videoParkingHost: HTMLDivElement | null = null;
  let localShuffleEnabled = false;
  let localRepeatMode: PlaylistRepeatMode = 'off';
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
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
      playlist: [],
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
  let multiplayerToastTimer: number | null = null;
  let lastMultiplayerToastMessage: string | null = null;
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
  let playbackProgressState: PlaybackProgressState = {
    notice: null,
    persistence: { state: 'ready', error: null }
  };
  let miniPlayerState: MiniPlayerState = {
    supported: false,
    active: false,
    opening: false
  };
  const miniPlayerTrack = writable<MediaEntity | null>(null);
  const miniPlayerSelectedTrack = writable<MediaEntity | null>(null);
  const miniPlayerArtworkUrl = writable<string | null>(null);

  function getRemoteSelection(collection: WorkspaceCollection): PlaylistSelection {
    return collection === 'playlist' ? remotePlaylistSelection : remoteLibrarySelection;
  }

  function setRemoteSelection(collection: WorkspaceCollection, selection: PlaylistSelection): void {
    if (collection === 'playlist') {
      remotePlaylistSelection = selection;
    } else {
      remoteLibrarySelection = selection;
    }
  }

  function clearCollectionSelection(collection: WorkspaceCollection): void {
    if (isMultiplayerClient) {
      setRemoteSelection(collection, emptySelection);
      return;
    }
    (collection === 'playlist' ? playlistStore : libraryStore).setSelection(emptySelection);
  }

  function selectCollectionTrack(
    collection: WorkspaceCollection,
    id: string,
    options?: { range?: boolean; toggle?: boolean }
  ): void {
    if (!isMultiplayerClient) {
      (collection === 'playlist' ? playlistStore : libraryStore).select(id, options);
      return;
    }
    const items = collection === 'playlist' ? playlistItems : libraryItems;
    setRemoteSelection(
      collection,
      resolveSelectSelection(items, getRemoteSelection(collection), id, options)
    );
  }

  function setCollectionSelection(collection: WorkspaceCollection, selection: PlaylistSelection): void {
    if (isMultiplayerClient) {
      const items = collection === 'playlist' ? playlistItems : libraryItems;
      const itemIds = new Set(items.map((item) => item.id));
      const ids = selection.ids.filter((id) => itemIds.has(id));
      setRemoteSelection(collection, {
        ids,
        anchorId: selection.anchorId && itemIds.has(selection.anchorId) ? selection.anchorId : ids[0] ?? null,
        focusId: selection.focusId && itemIds.has(selection.focusId) ? selection.focusId : ids.at(-1) ?? null
      });
      return;
    }
    (collection === 'playlist' ? playlistStore : libraryStore).setSelection(selection);
  }

  function selectAllCollectionTracks(collection: WorkspaceCollection): void {
    if (isMultiplayerClient) {
      setRemoteSelection(
        collection,
        buildSelectAllSelection(collection === 'playlist' ? playlistItems : libraryItems)
      );
      return;
    }
    (collection === 'playlist' ? playlistStore : libraryStore).selectAll();
  }

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
    getPlaylistContextActions: (ids) => isFreeplayClient
      ? buildFreeplayPlaylistContextActions(playlistItems, libraryItems, ids)
      : workspaceCollections.getPlaylistContextActions(ids),
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
      clear: clearCollectionSelection,
      select: selectCollectionTrack,
      set: setCollectionSelection,
      selectAll: selectAllCollectionTracks
    }
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
      showTrackLyrics: () => workspaceShell.showTrackLyrics(),
      showLibraryGroup: (target) => workspaceShell.showLibraryGroup(target),
      playPlaylist: playPlaylistFromCollectionAction
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
    getSelectedPlaylistTrack: () => selectedMediaEntity,
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
      (collection === 'library' ? libraryItems : playlistItems).find((item) => item.id === id) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems: workspaceCollections.cleanupRemovedItems,
    resolveResumePosition: (track) => playbackProgress.resolveResumePosition(track),
    notifyTrackResumed: (track, currentTime) =>
      playbackProgress.showResumeNotice(track, currentTime)
  });
  async function handleMultiplayerHostCommand(command: MultiplayerCommand): Promise<boolean> {
    if (multiplayerState.mode !== 'hosting') return false;

    switch (command.type) {
      case 'transport.toggle':
        if (multiplayerSession.cancelPendingPlayback()) return true;
        await playbackCommands.togglePlayback();
        return true;
      case 'transport.play':
        await playbackCommands.play();
        return true;
      case 'transport.pause':
        multiplayerSession.cancelPendingPlayback();
        playbackCommands.pause();
        return true;
      case 'transport.stop':
        multiplayerSession.cancelPendingPlayback();
        playbackCommands.stop();
        return true;
      case 'transport.previous':
        await playbackCommands.stepTrack(-1);
        return true;
      case 'transport.next':
        await playbackCommands.stepTrack(1);
        return true;
      case 'transport.seek':
        if (!playingTrack || command.seconds > playbackSnapshot.duration + 1) return false;
        seekPlayback(command.seconds);
        return true;
      case 'playlist.shuffle':
        playlistStore.toggleShuffle();
        return true;
      case 'playlist.repeat':
        playlistStore.cycleRepeatMode();
        return true;
      case 'collection.activate': {
        const items = command.collection === 'playlist'
          ? playlistItems
          : command.collection === 'favorites'
            ? favoriteItems
            : libraryItems;
        if (!items.some((item) => item.id === command.itemId)) return false;
        if (command.collection === 'playlist') {
          await playbackCommands.activatePlaylistTrack(command.itemId);
        } else if (command.collection === 'favorites') {
          const track = favoriteItems.find((item) => item.id === command.itemId);
          if (!track) return false;
          await playbackCommands.activateFavoriteTrack(track);
        } else {
          await playbackCommands.activateLibraryTrack(command.itemId);
        }
        return true;
      }
    }
  }
  const multiplayerSession = createMultiplayerSession({
    handleHostCommand: handleMultiplayerHostCommand,
    pauseHostPlayback: () => playbackCommands.pause(),
    resumeHostPlayback: () => { void playbackCommands.play(); }
  });
  prepareLaunchMultiplayerDialog();
  multiplayerState = multiplayerSession.getSnapshot();
  const unsubscribeMultiplayer = multiplayerSession.subscribe((value) => {
    const enteredFreeplay = value.freeplay && !multiplayerState.freeplay;
    multiplayerState = value;
    if (enteredFreeplay) workspaceShell.setActiveWorkspaceTab('library');
    if (value.mode === 'client' && value.reconnecting) {
      multiplayerConnectionDialogOpen = true;
      multiplayerConnectionDialogError = null;
    }
    if (multiplayerConnectionDialogOpen
      && (value.connectionStatus === 'error' || value.connectionStatus === 'disconnected')
      && !value.reconnecting
      && value.message
      && value.message !== 'Reconnecting to the host...') {
      multiplayerConnectionDialogError = value.message;
    }
    if (multiplayerConnectionDialogOpen && value.reconnecting) {
      multiplayerConnectionDialogError = null;
    }
    if (isMultiplayerConnectionReady(value)) {
      lastMultiplayerToastMessage = null;
      multiplayerConnectionDialogOpen = false;
      multiplayerConnectionDialogError = null;
    }
    if (value.message
      && value.message !== lastMultiplayerToastMessage
      && value.message !== 'Reconnecting to the host...'
      && !multiplayerConnectionDialogOpen) {
      showMultiplayerToast(value.message);
    }
    if (value.mode !== 'client') {
      lastPrunedRemoteCatalog = null;
      return;
    }
    if (value.remoteCatalog === lastPrunedRemoteCatalog) return;
    lastPrunedRemoteCatalog = value.remoteCatalog;

    const playlistIds = new Set(value.remoteCatalog.playlist.map((item) => item.id));
    const libraryIds = new Set(value.remoteCatalog.library.map((item) => item.id));
    const favoriteIds = new Set(value.remoteCatalog.favorites.map((item) => item.id));
    remotePlaylistSelection = pruneSelection(remotePlaylistSelection, playlistIds);
    remoteLibrarySelection = pruneSelection(remoteLibrarySelection, libraryIds);
    remoteFavoriteSelection = pruneSelection(remoteFavoriteSelection, favoriteIds);
  });

  function showMultiplayerToast(message: string): void {
    lastMultiplayerToastMessage = message;
    multiplayerToastMessage = message;
    if (multiplayerToastTimer !== null) window.clearTimeout(multiplayerToastTimer);
    multiplayerToastTimer = window.setTimeout(dismissMultiplayerToast, 9_000);
  }

  function dismissMultiplayerToast(): void {
    if (multiplayerToastTimer !== null) window.clearTimeout(multiplayerToastTimer);
    multiplayerToastTimer = null;
    multiplayerToastMessage = null;
  }

  function beginMultiplayerConnection(
    operation: 'hosting' | 'joining',
    targetName: string | null = null
  ): void {
    multiplayerConnectionOperation = operation;
    multiplayerConnectionTargetName = targetName;
    multiplayerConnectionDialogError = null;
    multiplayerConnectionDialogOpen = true;
  }

  function prepareLaunchMultiplayerDialog(): void {
    const settings = experimentalSettings.getSnapshot();
    if (!settings.multiplayer) return;
    const last = settings.multiplayerRestoreLastSession
      ? multiplayerLastSession.getSnapshot()
      : null;
    if (!last && !settings.multiplayerAutoHost) return;
    if (last?.mode === 'client') {
      beginMultiplayerConnection('joining', last.hostName);
      return;
    }
    beginMultiplayerConnection('hosting');
  }

  function isMultiplayerConnectionReady(value: MultiplayerSessionState): boolean {
    if (value.connectionStatus !== 'connected' || value.message !== null) return false;
    if (value.mode === 'hosting') return true;
    if (value.mode !== 'client'
      || value.remoteCatalog.revision <= 0
      || value.remoteDelivery.generationId === 'idle') return false;
    if (!value.receiveAudio || value.remoteDelivery.mode === 'none') return true;
    return value.audioStatus === 'playing'
      || value.audioStatus === 'ready'
      || value.audioStatus === 'refused'
      || value.audioStatus === 'disabled';
  }

  function failMultiplayerConnection(error: unknown, fallback: string): void {
    multiplayerConnectionDialogError = error instanceof Error ? error.message : fallback;
    multiplayerConnectionDialogOpen = true;
  }

  function dismissMultiplayerConnectionDialog(): void {
    multiplayerConnectionDialogOpen = false;
    multiplayerConnectionDialogError = null;
    if (multiplayerState.mode === 'client') void multiplayerSession.leave();
    else if (multiplayerState.mode === 'hosting' && multiplayerState.connectionStatus !== 'connected') {
      void multiplayerSession.stopHosting();
    }
  }

  function pruneSelection(selection: PlaylistSelection, ids: Set<string>): PlaylistSelection {
    const retained = selection.ids.filter((id) => ids.has(id));
    return {
      ids: retained,
      anchorId: selection.anchorId && ids.has(selection.anchorId) ? selection.anchorId : retained[0] ?? null,
      focusId: selection.focusId && ids.has(selection.focusId) ? selection.focusId : retained.at(-1) ?? null
    };
  }

  function togglePlayback(): void {
    if (isMultiplayerClient) {
      if (isSourceFileFreeplayClient) {
        if (playbackSnapshot.state === 'playing') playerController.pause();
        else {
          void playerController.resumeAudio();
          playerController.play();
        }
        return;
      }
      multiplayerSession.sendCommand({ type: 'transport.toggle' });
      return;
    }
    if (multiplayerState.mode === 'hosting' && multiplayerSession.cancelPendingPlayback()) return;
    void playbackCommands.togglePlayback();
  }

  function playPlayback(): void {
    if (isMultiplayerClient) {
      if (isSourceFileFreeplayClient) {
        void playerController.resumeAudio();
        playerController.play();
        return;
      }
      multiplayerSession.sendCommand({ type: 'transport.play' });
      return;
    }
    void playbackCommands.play();
  }

  function pausePlayback(): void {
    if (isMultiplayerClient) {
      if (isSourceFileFreeplayClient) {
        playerController.pause();
        return;
      }
      multiplayerSession.sendCommand({ type: 'transport.pause' });
      return;
    }
    multiplayerSession.cancelPendingPlayback();
    playbackCommands.pause();
  }

  function stopPlayback(): void {
    if (isMultiplayerClient) {
      if (isSourceFileFreeplayClient) {
        playerController.seek(0);
        playerController.pause();
        return;
      }
      multiplayerSession.sendCommand({ type: 'transport.stop' });
      return;
    }
    multiplayerSession.cancelPendingPlayback();
    playbackCommands.stop();
  }

  function stepTrack(direction: -1 | 1): void {
    if (isMultiplayerClient) {
      if (shouldRestartForPrevious(
        direction,
        $playbackSettings.restartCurrentTrackOnPrevious,
        playingTrack !== null,
        playbackSnapshot.currentTime
      )) {
        if (isSourceFileFreeplayClient) playerController.seek(0);
        else multiplayerSession.sendCommand({ type: 'transport.seek', seconds: 0 });
        return;
      }
      multiplayerSession.sendCommand({
        type: direction < 0 ? 'transport.previous' : 'transport.next'
      });
      return;
    }
    void playbackCommands.stepTrack(direction);
  }

  function setPlayerVolume(volume: number): void {
    if (isMultiplayerClient) {
      playerController.setVolume(volume);
      return;
    }
    playerController.setVolume(volume);
  }

  function togglePlayerMute(): void {
    if (isMultiplayerClient) {
      playerController.toggleMute();
      return;
    }
    playerController.toggleMute();
  }

  function togglePlaylistShuffle(): void {
    if (isMultiplayerClient) {
      multiplayerSession.sendCommand({ type: 'playlist.shuffle' });
      return;
    }
    playlistStore.toggleShuffle();
  }

  function cyclePlaylistRepeat(): void {
    if (isMultiplayerClient) {
      multiplayerSession.sendCommand({ type: 'playlist.repeat' });
      return;
    }
    playlistStore.cycleRepeatMode();
  }

  function activateMultiplayerTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean {
    if (!isMultiplayerClient) return false;
    multiplayerSession.sendCommand({ type: 'collection.activate', collection, itemId: id });
    return true;
  }

  function addToFreeplayQueue(ids: string[]): void {
    if (!isFreeplayClient || ids.length === 0) return;
    const current = multiplayerState.freeplayQueue;
    multiplayerSession.setFreeplayQueue([
      ...current,
      ...ids.filter((id) => !current.includes(id))
    ]);
  }

  function removeFromFreeplayQueue(ids: string[]): void {
    if (!isFreeplayClient || ids.length === 0) return;
    const removed = new Set(ids);
    multiplayerSession.setFreeplayQueue(
      multiplayerState.freeplayQueue.filter((id) => !removed.has(id))
    );
  }

  function handleFreeplayNavigationAction(actionId: string, tracks: MediaEntity[]): boolean {
    if (tracks.length !== 1) return false;
    const target = resolveTrackLibraryNavigationAction(actionId, tracks[0], libraryItems);
    if (!target) return false;
    workspaceShell.showLibraryGroup(target);
    return true;
  }

  function handleFreeplayPlaylistContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'remove') {
      removeFromFreeplayQueue(ids);
      return;
    }
    const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);
    if (handleFreeplayNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') workspaceShell.showTrackDetails();
  }

  function handleFreeplayLibraryContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'add-to-playlist') {
      addToFreeplayQueue(ids);
      return;
    }
    if (actionId === 'replace-playlist' || actionId === 'shuffle-play') {
      if (ids.length === 0) return;
      multiplayerSession.setFreeplayQueue(ids);
      if (actionId === 'shuffle-play' && !multiplayerState.remoteCatalog.shuffleEnabled) {
        multiplayerSession.sendCommand({ type: 'playlist.shuffle' });
      }
      activateMultiplayerTrack('playlist', ids[0]);
      return;
    }
    const source = $libraryViewSettings.activeView === 'favorites' ? favoriteItems : libraryItems;
    const tracks = buildSelectedWorkspaceTracks(source, ids);
    if (handleFreeplayNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') workspaceShell.showTrackDetails();
  }
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
  const unsubscribeMediaEntities = playlistItemsStore.subscribe((value) => (localMediaEntities = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (localLibraryItems = value));
  const unsubscribeFavoriteItems = favoriteItemsStore.subscribe((value) => (localFavoriteItems = value));
  void Promise.all([playlistStore.ready(), libraryStore.ready(), favoritesStore.ready()]).then(async () => {
    localCollectionsReady = true;
    void scanLaunchLibraryFolders();
    await playbackRestoration.restore();
    void startLaunchMultiplayer();
  });
  const unsubscribePlaylistSelectedIds = playlistSelectedIdsStore.subscribe(
    (value) => (localPlaylistSelectionIds = value)
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
  const unsubscribePlaylistSelectedTrack = playlistSelectedTrackStore.subscribe(
    (value) => (localSelectedMediaEntity = value)
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
    if (multiplayerState.mode === 'client') return;
    playbackCommands.notifyCurrentTrackChanged(value);

    if (!value?.metadata) {
      return;
    }

    playlistStore.updateMetadata(value.id, value.metadata);

    const playingIdentity = getTrackIdentity(value);

    for (const item of localLibraryItems) {
      if (getTrackIdentity(item) === playingIdentity) {
        libraryStore.updateMetadata(item.id, value.metadata);
      }
    }

    for (const item of localFavoriteItems) {
      if (getTrackIdentity(item) === playingIdentity) {
        favoritesStore.updateMetadata(item.id, value.metadata);
      }
    }
  });
  const unsubscribePlaybackSnapshot = playerController.snapshot.subscribe((value) => {
    localPlaybackSnapshot = value;
    if (value.state === 'playing') appInstallService.markEngaged();
    if (multiplayerState.mode !== 'client') {
      void playbackCommands.handlePlaybackProgress();
    }
  });

  function playPlaylistFromCollectionAction(): void {
    playPlayback();
  }
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
      selectedMediaEntity,
      selectedLibraryItem: $libraryViewSettings.activeView === 'favorites' ? selectedFavoriteItem : selectedLibraryItem,
      playingTrack,
      playbackSnapshot
    }),
    handlers: {
      toggleFullscreenPresentation,
      closeNowPlayingView,
      closeActiveRightPanel,
      removeMediaEntities: (ids) => {
        if (isFreeplayClient) {
          removeFromFreeplayQueue(ids);
          return;
        }
        if (!isMultiplayerClient) workspaceCollections.removeMediaEntities(ids);
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
      activatePlaylistTrack: (id) => {
        if (activateMultiplayerTrack('playlist', id)) return;
        return playbackCommands.activatePlaylistTrack(id);
      },
      activateLibraryTrack: (id) => activateLibraryPanelTrack(id),
      togglePlayback,
      toggleMute: togglePlayerMute,
      selectAllTracks: (collection) =>
        collection === 'library' && $libraryViewSettings.activeView === 'favorites'
          ? isMultiplayerClient
            ? (remoteFavoriteSelection = buildSelectAllSelection(favoriteItems))
            : favoritesStore.selectAll()
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
  $: playlistItems = isMultiplayerClient ? multiplayerState.remoteCatalog.playlist.map(mediaEntityFromMultiplayerTrack) : localMediaEntities;
  $: libraryItems = isMultiplayerClient ? multiplayerState.remoteCatalog.library.map(mediaEntityFromMultiplayerTrack) : localLibraryItems;
  $: favoriteItems = isMultiplayerClient ? multiplayerState.remoteCatalog.favorites.map(mediaEntityFromMultiplayerTrack) : localFavoriteItems;
  $: collectionsReady = isMultiplayerClient
    ? multiplayerState.connectionStatus === 'connected' && multiplayerState.remoteCatalog.revision > 0
    : localCollectionsReady;
  $: playlistSelectionIds = isMultiplayerClient
    ? remotePlaylistSelection.ids
    : localPlaylistSelectionIds;
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
  $: selectedMediaEntity = isMultiplayerClient
    ? playlistItems.find((item) => item.id === (remotePlaylistSelection.focusId ?? remotePlaylistSelection.ids.at(-1))) ?? null
    : localSelectedMediaEntity;
  $: selectedLibraryItem = isMultiplayerClient
    ? libraryItems.find((item) => item.id === (remoteLibrarySelection.focusId ?? remoteLibrarySelection.ids.at(-1))) ?? null
    : localSelectedLibraryItem;
  $: selectedFavoriteItem = isMultiplayerClient
    ? favoriteItems.find((item) => item.id === (remoteFavoriteSelection.focusId ?? remoteFavoriteSelection.ids.at(-1))) ?? null
    : localSelectedFavoriteItem;
  $: playingTrack = isMultiplayerClient
    ? (multiplayerState.remotePlayback.track ? mediaEntityFromMultiplayerTrack(multiplayerState.remotePlayback.track) : null)
    : localPlayingTrack;
  $: {
    const selectionSync = resolveMultiplayerPlayingTrackSelection(
      observedRemotePlayingTrackId,
      isMultiplayerClient ? playingTrack?.id ?? null : null,
      playlistItems
    );
    observedRemotePlayingTrackId = selectionSync.observedTrackId;
    if (isMultiplayerClient && selectionSync.selection) {
      workspaceShell.setCollectionSelection('playlist', selectionSync.selection);
    }
  }
  const RENDER_BUFFERED_POLL_INTERVAL_MS = 500;
  let renderBufferedRanges: Array<[number, number]> | null = null;
  let renderPipelineBuffering = false;
  let renderBufferedPollTimer: number | null = null;

  function sameBufferedRanges(a: Array<[number, number]> | null, b: Array<[number, number]>): boolean {
    if (a === null) return b.length === 0;
    if (a.length !== b.length) return false;
    return a.every(([start, end], index) => start === b[index][0] && end === b[index][1]);
  }

  function startRenderBufferedPoll(): void {
    if (renderBufferedPollTimer !== null || typeof window === 'undefined') return;
    renderBufferedPollTimer = window.setInterval(() => {
      const state = multiplayerRenderPlaybackService.getState();
      const ranges = state.bufferedRanges
        .map(([start, end]): [number, number] => [start / 1_000, end / 1_000]);
      if (!sameBufferedRanges(renderBufferedRanges, ranges)) {
        renderBufferedRanges = ranges;
      }
      if (renderPipelineBuffering !== state.buffering) {
        renderPipelineBuffering = state.buffering;
      }
    }, RENDER_BUFFERED_POLL_INTERVAL_MS);
  }

  function stopRenderBufferedPoll(): void {
    if (renderBufferedPollTimer !== null) {
      window.clearInterval(renderBufferedPollTimer);
      renderBufferedPollTimer = null;
    }
    renderBufferedRanges = null;
    renderPipelineBuffering = false;
  }

  $: isRenderDeliveryClient = isMultiplayerClient
    && !isSourceFileFreeplayClient
    && multiplayerState.remoteDelivery.mode === 'render';
  $: if (isRenderDeliveryClient) {
    startRenderBufferedPoll();
  } else {
    stopRenderBufferedPoll();
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
      : selectedMediaEntity;
  $: livePlayingTrack = resolveTrackSnapshot(playingTrack, selectedItem, playlistItems, libraryItems);
  $: playerDisplayTrack = livePlayingTrack;
  $: miniPlayerTrack.set(playerDisplayTrack);
  $: miniPlayerSelectedTrack.set(selectedMediaEntity);
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
    keepEmptyWorkspacePanelsOpen: $appearanceSettings.keepEmptyWorkspacePanelsOpen,
    readOnly: isMultiplayerClient && !isFreeplayClient
  });
  $: multiplayerSession.updateHostState({
    playlist: localMediaEntities,
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
      playlistSelectionIds.length > 0 || librarySelectionIds.length > 0 || favoriteSelectionIds.length > 0
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

  const playlistPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => { if (!isMultiplayerClient) workspaceCollections.handleAddFiles(files, 'playlist'); },
    addFolders: (handles) => { if (!isMultiplayerClient) void filesystemFolders.rememberMany(handles); },
    openFiles: () => { if (!isMultiplayerClient) void handleMenuOpenFiles('playlist'); },
    select: (event) => handleSelect('playlist', event),
    setSelection: (event) => handleSetSelection('playlist', event),
    activate: (event) => {
      if (!activateMultiplayerTrack('playlist', event.detail)) {
        void playbackCommands.activatePlaylistTrack(event.detail);
      }
    },
    contextAction: (event) => {
      if (isFreeplayClient) {
        handleFreeplayPlaylistContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      if (!isMultiplayerClient) {
        workspaceCollections.handlePlaylistContextAction(event.detail.actionId, event.detail.ids);
      }
    },
    toggleShuffle: togglePlaylistShuffle,
    cycleRepeat: cyclePlaylistRepeat
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
    if (isMultiplayerClient) {
      remoteFavoriteSelection = resolveSelectSelection(
        favoriteItems,
        remoteFavoriteSelection,
        event.detail.id,
        { range: event.detail.range, toggle: event.detail.toggle }
      );
    } else {
      favoritesStore.select(event.detail.id, {
        range: event.detail.range,
        toggle: event.detail.toggle
      });
    }
  }

  function handleLibraryPanelSetSelection(event: CustomEvent<PlaylistSelection>) {
    if ($libraryViewSettings.activeView === 'favorites') {
      workspaceShell.focusCollection('library');
      if (isMultiplayerClient) {
        remoteFavoriteSelection = event.detail;
      } else {
        favoritesStore.setSelection(event.detail);
      }
      return;
    }

    handleSetSelection('library', event);
  }

  async function activateLibraryPanelTrack(id: string) {
    if (isFreeplayClient) {
      addToFreeplayQueue([id]);
      activateMultiplayerTrack('playlist', id);
      return;
    }
    if (activateMultiplayerTrack(
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
    if (isMultiplayerClient) {
      if (isSourceFileFreeplayClient) {
        playerController.seek(seconds);
        return;
      }
      multiplayerSession.sendCommand({ type: 'transport.seek', seconds });
      return;
    }
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

  function syncVideoPresentation(track: MediaEntity | null, autoEnterTheater: boolean): void {
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

  type TroubadourMatchTarget = TroubadourBatchItemResult | TroubadourWriteTarget;

  function getTroubadourResultReferences(result: TroubadourMatchTarget): TroubadourTrackReference[] {
    const contextReferences = result.contextId
      ? lastTroubadourContext?.tracks.find((track) => track.contextId === result.contextId)?.references ?? []
      : [];
    const unique = new Map<string, TroubadourTrackReference>();

    for (const reference of [...(result.references ?? []), ...contextReferences]) {
      unique.set(`${reference.collection}:${reference.id}`, reference);
    }

    return [...unique.values()];
  }

  function getTroubadourContextTrack(result: TroubadourMatchTarget) {
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
    item: MediaEntity,
    collection: TroubadourTrackReference['collection'],
    result: TroubadourMatchTarget
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

    const itemHandle = mediaSources.get(item.id)?.fileHandle;
    const originalHandle = result.originalFileHandle ?? contextTrack?.fileHandle;

    if (originalHandle && itemHandle) {
      if (originalHandle === itemHandle) return true;

      try {
        if (typeof originalHandle.isSameEntry === 'function' && await originalHandle.isSameEntry(itemHandle)) {
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

  function navigateTrackDetailsToLibrary(target: TrackLibraryNavigationTarget) {
    workspaceShell.showLibraryGroup(target);
  }

  async function preparePlaybackForTroubadourWrite(targets: TroubadourWriteTarget[]): Promise<void> {
    const track = playingTrack;
    if (!track) return;

    for (const target of targets) {
      if (!await isTroubadourResultMatch(track, 'current', target)) continue;
      await detachTrackForMetadataWrite(
        track,
        {
          autoPlay: playbackStatus.state === 'playing',
          initialPosition: playbackSnapshot.currentTime
        },
        (detachedTrack, options) => playerController.load(detachedTrack, options)
      );
      return;
    }
  }

  function getTroubadourExternalPatch(result: TroubadourBatchItemResult) {
    return {
      ...(result.file ? { file: result.file } : {}),
      ...(result.fileHandle ? { fileHandle: result.fileHandle } : {}),
      ...(result.path !== undefined ? { path: result.path } : {}),
      ...(result.sourceFolderId !== undefined ? { sourceFolderId: result.sourceFolderId } : {}),
      ...(result.name !== undefined ? { name: result.name } : {}),
      ...(result.extension !== undefined ? { format: result.extension } : {}),
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

    const writePreparation = readTroubadourWritePreparationRequest(event, troubadourWindow);
    if (writePreparation && troubadourWindow) {
      void preparePlaybackForTroubadourWrite(writePreparation.targets)
        .finally(() => respondToTroubadourWritePreparation(troubadourWindow, writePreparation.requestId));
      return;
    }

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

  async function handleMultiplayerHost(): Promise<void> {
    beginMultiplayerConnection('hosting');
    try {
      await multiplayerSession.startHosting();
    } catch (error) {
      failMultiplayerConnection(error, 'Could not start multiplayer hosting.');
    }
  }

  async function startLaunchMultiplayer(): Promise<void> {
    const settings = experimentalSettings.getSnapshot();
    if (!settings.multiplayer) return;
    if (settings.multiplayerRestoreLastSession) {
      const restored = await multiplayerSession.restoreLastSession().catch((error) => {
        logError('multiplayer', 'Last session restore could not start', error);
        return null;
      });
      if (restored === 'client') {
        playerController.pause();
        return;
      }
      if (restored === 'hosting') return;
    }
    if (!settings.multiplayerAutoHost) return;
    try {
      await multiplayerSession.startHosting({ silent: true });
    } catch (error) {
      logError('multiplayer', 'Persistent peer hosting could not start', error);
    }
  }

  async function handleMultiplayerJoin(): Promise<void> {
    const inviteCode = window.prompt(
      $t('main.multiplayer.enterInvite', { default: 'Enter the host invite code' })
    );
    if (!inviteCode) return;
    await joinMultiplayer(inviteCode);
  }

  async function joinMultiplayer(inviteCode: string): Promise<void> {
    beginMultiplayerConnection('joining');
    playerController.pause();
    try {
      await multiplayerSession.join(inviteCode);
    } catch (error) {
      failMultiplayerConnection(error, 'Could not join that multiplayer session.');
    }
  }

  async function joinPairedMultiplayer(hostId: string): Promise<void> {
    const pairing = $multiplayerPairings.find((candidate) => candidate.hostId === hostId);
    beginMultiplayerConnection('joining', pairing?.name ?? null);
    playerController.pause();
    try {
      await multiplayerSession.joinPaired(hostId);
    } catch (error) {
      failMultiplayerConnection(error, 'Could not join that paired host.');
    }
  }

  async function copyMultiplayerInvite(): Promise<void> {
    const inviteCode = multiplayerState.inviteCode;
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
    } catch {
      window.prompt(
        $t('main.multiplayer.copyInviteFallback', { default: 'Copy this invite code' }),
        inviteCode
      );
    }
  }

  function toggleNowPlayingView() {
    if (isNowPlayingLayoutActive) {
      closeNowPlayingView();
      return;
    }

    if (!mobileMode) {
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

    if (!mobileMode) {
      restoreNowPlayingWindowSize();
    }
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
    if (!isMultiplayerClient && playbackStatus.state === 'ended') {
      void playbackCommands.handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  $: if (!isMultiplayerClient && $playbackSettings.gaplessPlayback && playingTrack) {
    void playbackCommands.prepareUpcomingTrack();
  }

  onDestroy(() => {
    void disposePlaylistMetadata();
    dismissMultiplayerToast();
    playbackRestoration.destroy();
    playbackProgress.destroy();
    artworkPresentation.destroy();
    lyricsPresentation.destroy();
    playCountTracker.destroy();
    workspaceShell.destroy();
    unsubscribeMediaEntities();
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
    unsubscribeMultiplayer();
    multiplayerSession.destroy();
    miniPlayer.destroy();
    appInstallService.destroy();
    unsubscribeLaunchedFiles();
    stopLibraryFolderCommands();
    stopLoadoutRuntime();
    stopRenderBufferedPoll();
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
    on:showPlaylist={showPlaylist}
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
    {playlistPanelHandlers}
    {libraryPanelHandlers}
    {selectedMediaEntity}
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
    {playlistPanelHandlers}
    {libraryPanelHandlers}
    {selectedMediaEntity}
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
      selectedTrack={selectedMediaEntity}
      artwork={artworkPresentationState.displayedArtwork}
      backdropEffect={$appearanceSettings.backdropZones.player}
      backdropArtworkSettings={$appearanceSettings.backdropZoneArtwork.player}
      artworkBackgroundBright={backdropPresentation.artworkBackgroundBrightByZone.player}
      hasCollectionItems={playlistItems.length > 0 || libraryItems.length > 0 || favoriteItems.length > 0}
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
