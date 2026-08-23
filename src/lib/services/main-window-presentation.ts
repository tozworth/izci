/**
 * Pure derivation resolvers for the main-window composition root.
 *
 * These are the *value computations* of `App.svelte`'s reactive layer,
 * moved into unit-testable functions. Each resolver is of the form "given
 * inputs, what is the value?" — no side effects, no mutations. Side-effecting
 * reactive blocks (store sets, `*.sync(...)` calls, shutdown handling, the
 * `autoNowPlayingSuppressed`/`isNowPlayingChromeHidden` resets) stay in the
 * component, which keeps one thin `$:` call per resolver.
 */

import {
  NOW_PLAYING_MIN_VIEWPORT_HEIGHT,
  NOW_PLAYING_MIN_VIEWPORT_WIDTH
} from '$lib/services/window-now-playing';
import type { MultiplayerSessionState } from '$lib/services/multiplayer-types';
import type { WindowControlsOverlayState } from '$lib/services/window-controls-overlay';
import type { WindowDisplayState } from '$lib/services/window-display-state';
import type {
  AppearanceSettings,
  LyricsDisplayStyle,
  PlaybackSnapshot,
  RepeatMode,
  TrackItem,
  TrackSelection
} from '$lib/types';
import { getTrackDisplayTitle } from '$lib/utils/files';

/**
 * Shape-compatible with the translate functions passed to the main-window
 * services (`transport-actions.ts`, `multiplayer-window-controller.ts`).
 */
export type Translate = (
  id: string,
  options?: {
    default?: string;
    values?: Record<string, string | number | boolean | Date | null | undefined>;
  }
) => string;

export type MultiplayerDialogOperation = 'hosting' | 'joining';

/** The subset of `PlaybackSnapshot` the player bar / status consumers read. */
export type PlaybackStatusPresentation = Pick<
  PlaybackSnapshot,
  'state' | 'volume' | 'backend' | 'error'
>;

// ── Multiplayer connection dialog ────────────────────────────────────────

export interface MultiplayerDialogPresentation {
  failed: boolean;
  resolvedTarget: string | null;
  notice: string;
  statusLine: string;
}

/**
 * Resolve the connection-dialog presentation (failure state, resolved target,
 * notice line, and status line) from the live session state, the dialog's
 * error state, and the pending host/join operation.
 */
export function resolveMultiplayerDialogPresentation(
  state: MultiplayerSessionState,
  dialog: { error: string | null },
  operation: MultiplayerDialogOperation,
  targetName: string | null,
  translate: Translate
): MultiplayerDialogPresentation {
  const failed =
    dialog.error !== null ||
    state.connectionStatus === 'error' ||
    state.connectionStatus === 'disconnected';
  const resolvedTarget = state.hostName ?? targetName;
  const notice = failed
    ? translate('main.multiplayer.connectionNoticeFailed', { default: 'Connection failed' })
    : operation === 'hosting'
      ? translate('main.multiplayer.startingHost', { default: 'Starting multiplayer host' })
      : resolvedTarget
        ? translate('main.multiplayer.connectingTo', {
            default: 'Connecting to {name}',
            values: { name: resolvedTarget }
          })
        : translate('main.multiplayer.connectingToHost', { default: 'Connecting to host' });
  const statusLine =
    dialog.error ??
    state.connectionDetail ??
    state.message ??
    (state.audioStatus === 'blocked'
      ? translate('main.multiplayer.audio.blocked', { default: 'Audio needs permission' })
      : null) ??
    (operation === 'hosting'
      ? translate('main.multiplayer.preparingRoom', { default: 'Preparing the signaling room...' })
      : translate('main.multiplayer.preparingConnection', {
          default: 'Preparing the connection...'
        }));
  return { failed, resolvedTarget, notice, statusLine };
}

// ── Client collections ───────────────────────────────────────────────────

export interface ClientCollectionsLocal {
  trackItems: TrackItem[];
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  collectionsReady: boolean;
}

export interface ClientCollectionsRemote {
  queue: TrackItem[];
  library: TrackItem[];
  favorites: TrackItem[];
  revision: number;
  connectionStatus: MultiplayerSessionState['connectionStatus'];
}

export interface ClientCollectionsPresentation {
  queueItems: TrackItem[];
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  collectionsReady: boolean;
}

/**
 * Resolve the visible collection items and readiness: the remote catalog for
 * multiplayer clients (ready only once connected and a revision arrived),
 * local store mirrors otherwise.
 */
export function resolveClientCollections(
  local: ClientCollectionsLocal,
  remote: ClientCollectionsRemote,
  isClient: boolean
): ClientCollectionsPresentation {
  if (!isClient) {
    return {
      queueItems: local.trackItems,
      libraryItems: local.libraryItems,
      favoriteItems: local.favoriteItems,
      collectionsReady: local.collectionsReady
    };
  }
  return {
    queueItems: remote.queue,
    libraryItems: remote.library,
    favoriteItems: remote.favorites,
    collectionsReady: remote.connectionStatus === 'connected' && remote.revision > 0
  };
}

// ── Client selections ────────────────────────────────────────────────────

export interface ClientSelectionsLocal {
  queueIds: string[];
  libraryIds: string[];
  libraryAnchorId: string | null;
  favoriteIds: string[];
  favoriteAnchorId: string | null;
}

export interface ClientSelectionsRemote {
  track: TrackSelection;
  library: TrackSelection;
  favorites: TrackSelection;
}

export interface ClientSelectionsPresentation extends ClientSelectionsLocal {}

/**
 * Resolve the per-collection selection ids/anchors: remote selections for
 * multiplayer clients, local store mirrors otherwise.
 */
export function resolveClientSelections(
  local: ClientSelectionsLocal,
  remote: ClientSelectionsRemote,
  isClient: boolean
): ClientSelectionsPresentation {
  return isClient
    ? {
        queueIds: remote.track.ids,
        libraryIds: remote.library.ids,
        libraryAnchorId: remote.library.anchorId,
        favoriteIds: remote.favorites.ids,
        favoriteAnchorId: remote.favorites.anchorId
      }
    : {
        queueIds: local.queueIds,
        libraryIds: local.libraryIds,
        libraryAnchorId: local.libraryAnchorId,
        favoriteIds: local.favoriteIds,
        favoriteAnchorId: local.favoriteAnchorId
      };
}

/**
 * Resolve the selected item for a collection: the focus id when present,
 * otherwise the last selected id, otherwise nothing.
 */
export function resolveClientSelectedItems(
  items: TrackItem[],
  selection: TrackSelection
): TrackItem | null {
  return items.find((item) => item.id === (selection.focusId ?? selection.ids.at(-1))) ?? null;
}

// ── Client playback ──────────────────────────────────────────────────────

export interface ClientPlaybackLocal {
  snapshot: PlaybackSnapshot;
  status: PlaybackStatusPresentation;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
}

export interface ClientPlaybackRemote {
  snapshot: PlaybackSnapshot;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
}

export interface ClientPlaybackPresentation {
  playbackSnapshot: PlaybackSnapshot;
  playbackStatus: PlaybackStatusPresentation;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
}

/**
 * Resolve the client-visible playback presentation (snapshot, status,
 * shuffle, repeat) for the player bar.
 *
 * The render pipeline's own loading (generation in flight: host
 * render + transfer, initial download, rebuffers) surfaces as the
 * loading state so the player bar shows the throbber; the host
 * snapshot alone reads 'idle'/'playing' through both phases. A
 * reported error wins over loading so failures are never masked.
 */
export function resolveClientPlayback(
  remote: ClientPlaybackRemote,
  local: ClientPlaybackLocal,
  isClient: boolean,
  isSourceFileClient: boolean,
  isRenderClient: boolean,
  buffering: boolean,
  ranges: Array<[number, number]> | null
): ClientPlaybackPresentation {
  const useRemotePlayback = isClient && !isSourceFileClient;
  const playbackSnapshot = useRemotePlayback
    ? {
        ...remote.snapshot,
        state:
          isRenderClient && buffering && remote.snapshot.state !== 'error'
            ? 'loading'
            : remote.snapshot.state,
        volume: local.snapshot.volume,
        muted: local.snapshot.muted,
        buffered: isRenderClient ? ranges ?? undefined : undefined
      }
    : local.snapshot;
  const playbackStatus = useRemotePlayback
    ? {
        state: playbackSnapshot.state,
        volume: playbackSnapshot.volume,
        backend: playbackSnapshot.backend,
        error: playbackSnapshot.error
      }
    : local.status;
  return {
    playbackSnapshot,
    playbackStatus,
    shuffleEnabled: isClient ? remote.shuffleEnabled : local.shuffleEnabled,
    repeatMode: isClient ? remote.repeatMode : local.repeatMode
  };
}

// ── Video theater ────────────────────────────────────────────────────────

export interface VideoTheaterPresentation {
  isFullscreenVideoTheater: boolean;
  fullscreenExitAction: boolean;
  chromeInset: number;
  topInset: number;
}

/**
 * Resolve the video-theater presentation: fullscreen state, the exit action
 * (fullscreen theater with a DOM fullscreen element), and the chrome/top
 * insets for the theater viewport.
 */
export function resolveVideoTheaterPresentation(
  videoTrackActive: boolean,
  theaterActive: boolean,
  fullscreen: boolean,
  windowControlsOverlay: WindowControlsOverlayState,
  topMenuBarHeight: number,
  hasDomFullscreenElement: boolean
): VideoTheaterPresentation {
  const isFullscreenVideoTheater = videoTrackActive && theaterActive && fullscreen;
  const chromeInset = windowControlsOverlay.visible
    ? Math.max(
        0,
        windowControlsOverlay.titlebarAreaRect.y + windowControlsOverlay.titlebarAreaRect.height
      )
    : topMenuBarHeight;
  return {
    isFullscreenVideoTheater,
    fullscreenExitAction: isFullscreenVideoTheater && hasDomFullscreenElement,
    chromeInset,
    topInset: isFullscreenVideoTheater ? 0 : chromeInset
  };
}

// ── Now Playing eligibility and lyrics presentation ──────────────────────

export interface NowPlayingEligibility {
  nowPlayingViewActive: boolean;
  isAutomaticNowPlayingEligible: boolean;
  isNowPlayingViewportEligible: boolean;
}

/**
 * Resolve the Now Playing input state: the manual view switch, automatic
 * eligibility (maximized preference), and the viewport gate. `isNowPlayingLayoutActive`
 * is derived separately by `resolveNowPlayingLayoutActive` because it reads the
 * mutable `autoNowPlayingSuppressed` toggle, which the eligibility derivation
 * must not (Svelte 4 would see a reactive-declaration cycle via the reset
 * effect that stays in the component).
 */
export function resolveNowPlayingEligibility(
  appearance: Pick<AppearanceSettings, 'nowPlayingViewActive' | 'autoNowPlayingOnMaximized'>,
  windowDisplay: Pick<WindowDisplayState, 'prefersNowPlaying'>,
  innerSize: { width: number; height: number },
  mobileMode: boolean
): NowPlayingEligibility {
  const nowPlayingViewActive = appearance.nowPlayingViewActive;
  const isAutomaticNowPlayingEligible =
    appearance.autoNowPlayingOnMaximized && windowDisplay.prefersNowPlaying;
  const isNowPlayingViewportEligible =
    mobileMode ||
    (innerSize.width >= NOW_PLAYING_MIN_VIEWPORT_WIDTH &&
      innerSize.height >= NOW_PLAYING_MIN_VIEWPORT_HEIGHT);
  return {
    nowPlayingViewActive,
    isAutomaticNowPlayingEligible,
    isNowPlayingViewportEligible
  };
}

/**
 * Resolve whether the Now Playing layout is active: the manual view or an
 * unsuppressed automatic eligibility, gated by the viewport and the current
 * track kind (video tracks never enter Now Playing).
 */
export function resolveNowPlayingLayoutActive(
  nowPlayingViewActive: boolean,
  isAutomaticNowPlayingEligible: boolean,
  isAutoNowPlayingSuppressed: boolean,
  isNowPlayingViewportEligible: boolean,
  trackKind: TrackItem['kind'] | undefined
): boolean {
  return (
    (nowPlayingViewActive || (isAutomaticNowPlayingEligible && !isAutoNowPlayingSuppressed)) &&
    isNowPlayingViewportEligible &&
    trackKind !== 'video'
  );
}

export interface LyricsPresentation {
  effectiveLyricsDisplayStyle: LyricsDisplayStyle;
  lyricsAutoScroll: boolean;
  lyricsFontSize: number;
}

/**
 * Resolve the effective lyrics presentation: the display style (theater while
 * the Now Playing layout is active and the setting is on), the auto-scroll
 * flag, and the font size for the effective style.
 */
export function resolveLyricsPresentation(
  appearance: Pick<AppearanceSettings, 'lyrics'>,
  isNowPlayingLayoutActive: boolean
): LyricsPresentation {
  const effectiveLyricsDisplayStyle =
    isNowPlayingLayoutActive && appearance.lyrics.autoTheaterInNowPlaying
      ? 'theater'
      : appearance.lyrics.displayStyle;
  return {
    effectiveLyricsDisplayStyle,
    lyricsAutoScroll: effectiveLyricsDisplayStyle === 'theater' || appearance.lyrics.autoScroll,
    lyricsFontSize: appearance.lyrics.fontSizes[effectiveLyricsDisplayStyle]
  };
}

// ── Small stragglers ─────────────────────────────────────────────────────

/** Resolve the window title from the live playing track when enabled. */
export function resolveWindowTitle(
  showTrackTitle: boolean,
  livePlayingTrack: TrackItem | null
): string {
  return showTrackTitle && livePlayingTrack ? getTrackDisplayTitle(livePlayingTrack) : 'izci';
}
