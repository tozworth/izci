/**
 * Main-window runtime state: the component-owned reactive state shape, the
 * runtime's push subscription surface, and the store objects the runtime
 * creates. Pure move from `main-window-runtime.ts` — no behavior changes.
 */

import { writable } from 'svelte/store';
import type {
  LyricsPresentationState
} from '$lib/services/lyrics-presentation';
import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
import type { MiniPlayerState } from '$lib/services/mini-player';
import type { PlaybackProgressState } from '$lib/services/playback-progress';
import type { AppInstallState } from '$lib/services/app-install';
import type { MultiplayerSessionState } from '$lib/services/multiplayer-types';
import type { createMainWindowView } from '$lib/services/main-window-view';
import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
import type {
  PlaybackSnapshot,
  TrackItem,
  RepeatMode
} from '$lib/types';

/** Component-owned reactive state read by the runtime through getters. */
export interface MainWindowRuntimeState {
  isMultiplayerClient: boolean;
  isFreeplayClient: boolean;
  isSourceFileFreeplayClient: boolean;
  queueItems: TrackItem[];
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  queueSelectionIds: string[];
  librarySelectionIds: string[];
  librarySelectionAnchorId: string | null;
  favoriteSelectionIds: string[];
  favoriteSelectionAnchorId: string | null;
  selectedTrackItem: TrackItem | null;
  selectedLibraryItem: TrackItem | null;
  selectedFavoriteItem: TrackItem | null;
  playingTrack: TrackItem | null;
  playbackSnapshot: PlaybackSnapshot;
  playbackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'>;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  videoTrackActive: boolean;
  videoTheaterActive: boolean;
  videoTheaterControlsHidden: boolean;
  isNowPlayingLayoutActive: boolean;
  isAutomaticNowPlayingEligible: boolean;
  autoNowPlayingSuppressed: boolean;
  lyricsPresentationState: LyricsPresentationState;
  artworkPresentationState: import('$lib/services/artwork-presentation').ArtworkPresentationState;
  workspaceShellState: import('$lib/services/workspace-shell').WorkspaceShellState;
  playbackProgressState: PlaybackProgressState;
  miniPlayerState: MiniPlayerState;
  appInstallState: AppInstallState;
  multiplayerState: MultiplayerSessionState;
  renderBufferedRanges: Array<[number, number]> | null;
  renderPipelineBuffering: boolean;
  // Local store mirrors fed into the client-resolution resolvers.
  localPlayingTrack: TrackItem | null;
  localShuffleEnabled: boolean;
  localRepeatMode: RepeatMode;
  localPlaybackSnapshot: PlaybackSnapshot;
  localPlaybackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'>;
  // Pushed controller/ui state.
  playbackCommandsState: { pendingPlaybackTrackId: string | null };
  multiplayerConnectionDialogOpen: boolean;
  multiplayerConnectionDialogError: string | null;
  multiplayerConnectionOperation: 'hosting' | 'joining';
  multiplayerConnectionTargetName: string | null;
  multiplayerToastMessage: string | null;
}

/** Store objects the runtime creates and owns, exposing `set`. */
export interface MainWindowRuntimeStores {
  displayPlaybackSnapshotStore: ReturnType<typeof writable<PlaybackSnapshot>>;
  mediaSessionArtworkOverrideStore: ReturnType<typeof writable<LoadedStreamArtwork | null | undefined>>;
  multiplayerClientMediaSessionStore: ReturnType<typeof writable<boolean>>;
  miniPlayerTrack: ReturnType<typeof writable<TrackItem | null>>;
  miniPlayerSelectedTrack: ReturnType<typeof writable<TrackItem | null>>;
  miniPlayerArtworkUrl: ReturnType<typeof writable<string | null>>;
  view: ReturnType<typeof createMainWindowView>;
}

/** Push-subscription surface created around a mutable state object. */
interface MainWindowRuntimeSubscription<T> {
  subscribe(listener: (updates: Partial<T>) => void): () => void;
  getSnapshot(): T;
}

export function createMainWindowRuntimeState(): {
  state: MainWindowRuntimeState;
  publish(updates: Partial<MainWindowRuntimeState>): void;
  subscription: MainWindowRuntimeSubscription<MainWindowRuntimeState>;
} {
  const state: MainWindowRuntimeState = {
    isMultiplayerClient: false,
    isFreeplayClient: false,
    isSourceFileFreeplayClient: false,
    queueItems: [],
    libraryItems: [],
    favoriteItems: [],
    queueSelectionIds: [],
    librarySelectionIds: [],
    librarySelectionAnchorId: null,
    favoriteSelectionIds: [],
    favoriteSelectionAnchorId: null,
    selectedTrackItem: null,
    selectedLibraryItem: null,
    selectedFavoriteItem: null,
    playingTrack: null,
    playbackSnapshot: {
      state: 'idle',
      currentTime: 0,
      duration: 0,
      volume: DEFAULT_PLAYER_VOLUME,
      muted: false,
      backend: null,
      error: undefined
    },
    playbackStatus: {
      state: 'idle',
      volume: DEFAULT_PLAYER_VOLUME,
      backend: null,
      error: undefined
    },
    shuffleEnabled: false,
    repeatMode: 'off',
    videoTrackActive: false,
    videoTheaterActive: false,
    videoTheaterControlsHidden: false,
    isNowPlayingLayoutActive: false,
    isAutomaticNowPlayingEligible: false,
    autoNowPlayingSuppressed: false,
    lyricsPresentationState: {
      availability: 'unknown',
      trackKey: '',
      resumeAutoScrollToken: 0
    },
    artworkPresentationState: {
      detailsDisplayTrack: null,
      visibleDetailsArtwork: null,
      displayedArtwork: null,
      artworkBackgroundPrimary: null,
      artworkBackgroundSecondary: null,
      activeArtworkBackgroundSlot: 'primary',
      visibleArtworkBackground: null,
      artworkBackgroundAnalysis: {
        averageLuminance: 0,
        brightPixelRatio: 0,
        isBright: false
      },
      isArtworkBackgroundBright: false,
      isWindowChromeTransitionBypassed: false
    },
    workspaceShellState: {
      activeCollection: 'queue',
      activeWorkspaceTab: 'queue',
      isDetailsPanelVisible: false,
      isLyricsPanelVisible: false,
      isPatternsPanelVisible: false,
      isRightPanelVisible: false,
      isCompactWorkspace: false,
      isResizing: false,
      collapsedWorkspacePanels: [],
      widePanelWidths: { left: 0, center: 0, right: 0 },
      visibleWorkspacePanels: [],
      workspacePanels: [],
      workspaceTabs: [],
      queuePanelProps: null as never,
      libraryPanelProps: null as never,
      queueJumpRequest: null,
      libraryGroupRequest: null
    },
    playbackProgressState: { notice: null },
    miniPlayerState: { supported: false, active: false, opening: false },
    appInstallState: { available: false, showHint: false },
    multiplayerState: {
      mode: 'idle',
      connectionStatus: 'idle',
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostMotd: '',
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
        snapshot: {
          state: 'idle',
          currentTime: 0,
          duration: 0,
          volume: DEFAULT_PLAYER_VOLUME,
          muted: false,
          backend: null,
          error: undefined
        },
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
    },
    renderBufferedRanges: null,
    renderPipelineBuffering: false,
    localPlayingTrack: null,
    localShuffleEnabled: false,
    localRepeatMode: 'off',
    localPlaybackSnapshot: {
      state: 'idle',
      currentTime: 0,
      duration: 0,
      volume: DEFAULT_PLAYER_VOLUME,
      muted: false,
      backend: null,
      error: undefined
    },
    localPlaybackStatus: {
      state: 'idle',
      volume: DEFAULT_PLAYER_VOLUME,
      backend: null,
      error: undefined
    },
    playbackCommandsState: { pendingPlaybackTrackId: null },
    multiplayerConnectionDialogOpen: false,
    multiplayerConnectionDialogError: null,
    multiplayerConnectionOperation: 'joining',
    multiplayerConnectionTargetName: null,
    multiplayerToastMessage: null
  };
  const listeners = new Set<(updates: Partial<MainWindowRuntimeState>) => void>();

  function publish(updates: Partial<MainWindowRuntimeState>): void {
    Object.assign(state, updates);
    for (const listener of listeners) listener(updates);
  }

  function subscribe(listener: (updates: Partial<MainWindowRuntimeState>) => void): () => void {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  }

  function getSnapshot(): MainWindowRuntimeState {
    return state;
  }

  return { state, publish, subscription: { subscribe, getSnapshot } };
}
