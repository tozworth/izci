import { writable } from 'svelte/store';
import type { PlaylistItem } from '$lib/types';
import {
  analyzeArtworkBackground,
  DEFAULT_ARTWORK_BACKGROUND_ANALYSIS,
  type ArtworkBackgroundAnalysis
} from '$lib/services/artwork-background';
import {
  getTrackArtworkLoadKey,
  loadTrackArtwork,
  revokeTrackArtwork,
  type LoadedStreamArtwork
} from '$lib/services/stream-artwork';

export type ArtworkBackgroundSlot = 'primary' | 'secondary';

export interface ArtworkPresentationState {
  detailsDisplayTrack: PlaylistItem | null;
  visibleDetailsArtwork: LoadedStreamArtwork | null;
  displayedArtwork: LoadedStreamArtwork | null;
  artworkBackgroundPrimary: LoadedStreamArtwork | null;
  artworkBackgroundSecondary: LoadedStreamArtwork | null;
  activeArtworkBackgroundSlot: ArtworkBackgroundSlot;
  visibleArtworkBackground: LoadedStreamArtwork | null;
  artworkBackgroundAnalysis: ArtworkBackgroundAnalysis;
  isArtworkBackgroundBright: boolean;
  isWindowChromeTransitionBypassed: boolean;
}

interface CreateArtworkPresentationControllerOptions {
  resolveTrackSnapshot: (track: PlaylistItem | null) => PlaylistItem | null;
  isPlaybackDetailsPending: (trackId: string) => boolean;
  loadArtwork?: typeof loadTrackArtwork;
  getArtworkLoadKey?: typeof getTrackArtworkLoadKey;
}

const ARTWORK_BACKGROUND_TRANSITION_MS = 320;

function createInitialState(): ArtworkPresentationState {
  return {
    detailsDisplayTrack: null,
    visibleDetailsArtwork: null,
    displayedArtwork: null,
    artworkBackgroundPrimary: null,
    artworkBackgroundSecondary: null,
    activeArtworkBackgroundSlot: 'primary',
    visibleArtworkBackground: null,
    artworkBackgroundAnalysis: DEFAULT_ARTWORK_BACKGROUND_ANALYSIS,
    isArtworkBackgroundBright: false,
    isWindowChromeTransitionBypassed: false
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hasCommittedPlaybackDetails(track: PlaylistItem | null): boolean {
  if (!track) {
    return true;
  }

  const metadata = track.metadata;

  if (
    (metadata?.duration ?? 0) > 0 ||
    (metadata?.bitrate ?? 0) > 0 ||
    Boolean(metadata?.title?.trim()) ||
    Boolean(metadata?.artist?.trim()) ||
    Boolean(metadata?.album?.trim()) ||
    Boolean(metadata?.albumArtist?.trim()) ||
    Boolean(metadata?.genre?.trim()) ||
    Boolean(metadata?.year?.trim()) ||
    Boolean(metadata?.trackNumber?.trim()) ||
    Boolean(metadata?.discNumber?.trim()) ||
    Boolean(metadata?.composer?.trim())
  ) {
    return true;
  }

  if (track.kind === 'module') {
    return Boolean(
      metadata?.patterns ||
        metadata?.channels ||
        metadata?.orders ||
        metadata?.subsongNames?.length ||
        metadata?.message?.trim() ||
        metadata?.originalType?.trim()
    );
  }

  return false;
}

function getArtworkBackground(
  state: ArtworkPresentationState,
  slot: ArtworkBackgroundSlot
): LoadedStreamArtwork | null {
  return slot === 'primary' ? state.artworkBackgroundPrimary : state.artworkBackgroundSecondary;
}

function buildPublishedState(
  state: ArtworkPresentationState,
  detailsArtwork: LoadedStreamArtwork | null,
  detailsArtworkTrackKey: string
): ArtworkPresentationState {
  const activeArtworkBackground = getArtworkBackground(state, state.activeArtworkBackgroundSlot);

  return {
    ...state,
    visibleDetailsArtwork:
      state.detailsDisplayTrack && detailsArtworkTrackKey === getTrackArtworkLoadKey(state.detailsDisplayTrack)
        ? detailsArtwork
        : null,
    visibleArtworkBackground: activeArtworkBackground
  };
}

export function resolveTrackSnapshot(
  track: PlaylistItem | null,
  selectedTrackSnapshot: PlaylistItem | null,
  playlistTrackSnapshot: PlaylistItem[],
  libraryTrackSnapshot: PlaylistItem[]
): PlaylistItem | null {
  if (!track) {
    return null;
  }

  if (selectedTrackSnapshot?.id === track.id) {
    return selectedTrackSnapshot;
  }

  return (
    playlistTrackSnapshot.find((item) => item.id === track.id) ??
    libraryTrackSnapshot.find((item) => item.id === track.id) ??
    track
  );
}

export function hasSameTrackMetadata(left: PlaylistItem | null, right: PlaylistItem | null): boolean {
  return JSON.stringify(left?.metadata ?? {}) === JSON.stringify(right?.metadata ?? {});
}

export function createArtworkPresentationController({
  resolveTrackSnapshot,
  isPlaybackDetailsPending,
  loadArtwork = loadTrackArtwork,
  getArtworkLoadKey = getTrackArtworkLoadKey
}: CreateArtworkPresentationControllerOptions) {
  let state = createInitialState();
  let detailsTargetTrack: PlaylistItem | null = null;
  let detailsArtwork: LoadedStreamArtwork | null = null;
  let detailsArtworkTrackKey = '';
  let exitingArtworkBackgroundSlot: ArtworkBackgroundSlot | null = null;
  let artworkLoadToken = 0;
  let detailsArtworkLoadToken = 0;
  let artworkBackgroundCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let displayedArtworkKey = '';
  let detailsDisplayRequestKey = '';
  let artworkBrightnessKey = '';
  let previousWindowControlsOverlayVisible = false;
  let windowChromeTransitionBypassFrameA: number | null = null;
  let windowChromeTransitionBypassFrameB: number | null = null;

  const store = writable(state);

  function publishState(): void {
    state = buildPublishedState(state, detailsArtwork, detailsArtworkTrackKey);
    store.set(state);
  }

  function clearArtworkBackgroundCleanupTimer(): void {
    if (artworkBackgroundCleanupTimer === null) {
      return;
    }

    clearTimeout(artworkBackgroundCleanupTimer);
    artworkBackgroundCleanupTimer = null;
  }

  function setArtworkBackground(
    slot: ArtworkBackgroundSlot,
    artwork: LoadedStreamArtwork | null
  ): void {
    if (slot === 'primary') {
      state = { ...state, artworkBackgroundPrimary: artwork };
      return;
    }

    state = { ...state, artworkBackgroundSecondary: artwork };
  }

  function scheduleArtworkBackgroundCleanup(slot: ArtworkBackgroundSlot): void {
    clearArtworkBackgroundCleanupTimer();
    exitingArtworkBackgroundSlot = slot;
    publishState();

    artworkBackgroundCleanupTimer = setTimeout(() => {
      artworkBackgroundCleanupTimer = null;

      if (slot === state.activeArtworkBackgroundSlot) {
        return;
      }

      const artwork = getArtworkBackground(state, slot);

      if (!artwork) {
        return;
      }

      revokeTrackArtwork(artwork);
      setArtworkBackground(slot, null);

      if (exitingArtworkBackgroundSlot === slot) {
        exitingArtworkBackgroundSlot = null;
      }

      publishState();
    }, ARTWORK_BACKGROUND_TRANSITION_MS);
  }

  function replaceArtworkBackground(artwork: LoadedStreamArtwork | null): void {
    const nextSlot: ArtworkBackgroundSlot =
      state.activeArtworkBackgroundSlot === 'primary' ? 'secondary' : 'primary';
    const previousActiveSlot = state.activeArtworkBackgroundSlot;
    const previousActiveArtwork = getArtworkBackground(state, previousActiveSlot);
    const staleArtwork = getArtworkBackground(state, nextSlot);

    clearArtworkBackgroundCleanupTimer();

    if (staleArtwork) {
      revokeTrackArtwork(staleArtwork);
    }

    if (exitingArtworkBackgroundSlot === nextSlot) {
      exitingArtworkBackgroundSlot = null;
    }

    setArtworkBackground(nextSlot, artwork);
    state = { ...state, activeArtworkBackgroundSlot: nextSlot };

    if (!previousActiveArtwork) {
      setArtworkBackground(previousActiveSlot, null);
      exitingArtworkBackgroundSlot = null;
      publishState();
      return;
    }

    publishState();
    scheduleArtworkBackgroundCleanup(previousActiveSlot);
  }

  function setDetailsDisplay(track: PlaylistItem | null, artwork: LoadedStreamArtwork | null): void {
    const previousArtwork = detailsArtwork;

    state = { ...state, detailsDisplayTrack: track };
    detailsArtwork = artwork;
    detailsArtworkTrackKey = getTrackArtworkLoadKey(track);

    if (previousArtwork && previousArtwork !== artwork) {
      revokeTrackArtwork(previousArtwork);
    }

    publishState();
  }

  function clearArtworkBackgrounds(): void {
    clearArtworkBackgroundCleanupTimer();
    revokeTrackArtwork(state.artworkBackgroundPrimary);
    revokeTrackArtwork(state.artworkBackgroundSecondary);
    state = {
      ...state,
      artworkBackgroundPrimary: null,
      artworkBackgroundSecondary: null,
      artworkBackgroundAnalysis: DEFAULT_ARTWORK_BACKGROUND_ANALYSIS,
      isArtworkBackgroundBright: false
    };
    exitingArtworkBackgroundSlot = null;
    publishState();
  }

  async function waitForDetailsCommitReady(
    track: PlaylistItem,
    loadToken: number
  ): Promise<PlaylistItem | null> {
    const deadline = Date.now() + 1000;

    while (
      loadToken === detailsArtworkLoadToken &&
      detailsTargetTrack?.id === track.id &&
      isPlaybackDetailsPending(track.id) &&
      !hasCommittedPlaybackDetails(resolveTrackSnapshot(track)) &&
      Date.now() < deadline
    ) {
      await wait(16);
    }

    return resolveTrackSnapshot(track);
  }

  function clearWindowChromeTransitionBypassFrames(): void {
    if (typeof window === 'undefined') {
      return;
    }

    if (windowChromeTransitionBypassFrameA !== null) {
      window.cancelAnimationFrame(windowChromeTransitionBypassFrameA);
      windowChromeTransitionBypassFrameA = null;
    }

    if (windowChromeTransitionBypassFrameB !== null) {
      window.cancelAnimationFrame(windowChromeTransitionBypassFrameB);
      windowChromeTransitionBypassFrameB = null;
    }
  }

  function bypassWindowChromeTransitions(): void {
    if (typeof window === 'undefined') {
      return;
    }

    clearWindowChromeTransitionBypassFrames();
    state = { ...state, isWindowChromeTransitionBypassed: true };
    publishState();

    windowChromeTransitionBypassFrameA = window.requestAnimationFrame(() => {
      windowChromeTransitionBypassFrameA = null;
      windowChromeTransitionBypassFrameB = window.requestAnimationFrame(() => {
        windowChromeTransitionBypassFrameB = null;
        state = { ...state, isWindowChromeTransitionBypassed: false };
        publishState();
      });
    });
  }

  return {
    subscribe: store.subscribe,
    getSnapshot(): ArtworkPresentationState {
      return state;
    },
    syncSelection(selectedItem: PlaylistItem | null, hasAnySelection: boolean): void {
      if (selectedItem) {
        detailsTargetTrack = selectedItem;
      } else if (!hasAnySelection) {
        detailsTargetTrack = null;
      }

      if (selectedItem && state.detailsDisplayTrack?.id === selectedItem.id) {
        // Refresh the displayed track only when the selection carries a newer
        // object (e.g. metadata edited). The same reference means nothing
        // changed; republishing would churn the reactive graph (resize storms
        // re-sync the workspace shell, which re-runs this with an identical
        // item) and cascade into expensive recomputations downstream.
        if (state.detailsDisplayTrack !== selectedItem) {
          state = { ...state, detailsDisplayTrack: selectedItem };
          publishState();
        }
        return;
      }

      if (!hasAnySelection && state.detailsDisplayTrack) {
        setDetailsDisplay(null, null);
      }
    },
    async syncDisplayedArtwork(track: PlaylistItem | null): Promise<void> {
      const nextArtworkKey = getArtworkLoadKey(track);

      if (nextArtworkKey === displayedArtworkKey) {
        return;
      }

      displayedArtworkKey = nextArtworkKey;
      const loadToken = ++artworkLoadToken;

      if (!track) {
        state = { ...state, displayedArtwork: null };
        publishState();
        replaceArtworkBackground(null);
        return;
      }

      let artwork: LoadedStreamArtwork | null = null;

      try {
        artwork = await loadArtwork(track);
      } catch {
        artwork = null;
      }

      if (loadToken !== artworkLoadToken) {
        revokeTrackArtwork(artwork);
        return;
      }

      state = { ...state, displayedArtwork: artwork };
      publishState();
      replaceArtworkBackground(artwork);
    },
    async syncDetailsDisplay(): Promise<void> {
      const track = detailsTargetTrack;
      const nextDetailsKey = getTrackArtworkLoadKey(track);

      if (nextDetailsKey === detailsDisplayRequestKey) {
        return;
      }

      detailsDisplayRequestKey = nextDetailsKey;
      const loadToken = ++detailsArtworkLoadToken;

      if (!track) {
        setDetailsDisplay(null, null);
        return;
      }

      const artwork = await loadArtwork(track);

      if (loadToken !== detailsArtworkLoadToken) {
        revokeTrackArtwork(artwork);
        return;
      }

      const resolvedTrack = await waitForDetailsCommitReady(track, loadToken);

      if (loadToken !== detailsArtworkLoadToken) {
        revokeTrackArtwork(artwork);
        return;
      }

      setDetailsDisplay(resolvedTrack, artwork);
    },
    async syncArtworkBrightness(
      artwork: LoadedStreamArtwork | null,
      enabled: boolean
    ): Promise<void> {
      const brightnessKey = enabled && artwork ? artwork.url : '';

      if (brightnessKey === artworkBrightnessKey) {
        return;
      }

      artworkBrightnessKey = brightnessKey;

      if (brightnessKey.length === 0) {
        state = {
          ...state,
          artworkBackgroundAnalysis: DEFAULT_ARTWORK_BACKGROUND_ANALYSIS,
          isArtworkBackgroundBright: false
        };
        publishState();
        return;
      }

      const analysis = await analyzeArtworkBackground(artwork);

      if (artworkBrightnessKey !== brightnessKey) {
        return;
      }

      state = {
        ...state,
        artworkBackgroundAnalysis: analysis,
        isArtworkBackgroundBright: analysis.isBright
      };
      publishState();
    },
    syncArtworkMenuClasses(active: boolean, bright: boolean): void {
      if (typeof document === 'undefined' || !document.body) {
        return;
      }

      document.body.classList.toggle('artwork-background-active', active);
      document.body.classList.toggle('artwork-background-bright', active && bright);
    },
    setWindowControlsOverlayVisible(visible: boolean): void {
      if (visible === previousWindowControlsOverlayVisible) {
        return;
      }

      previousWindowControlsOverlayVisible = visible;
      bypassWindowChromeTransitions();
    },
    destroy(): void {
      artworkLoadToken += 1;
      detailsArtworkLoadToken += 1;
      clearWindowChromeTransitionBypassFrames();
      state = { ...state, displayedArtwork: null };
      publishState();
      setDetailsDisplay(null, null);
      clearArtworkBackgrounds();
      if (typeof document !== 'undefined' && document.body) {
        document.body.classList.remove('artwork-background-active', 'artwork-background-bright');
      }
    }
  };
}
