import type { Readable } from 'svelte/store';
import type { PlaybackSettings } from '$lib/contracts/player-settings';
import type { PlaybackSnapshot } from '$lib/contracts/playback';
import type { MediaEntity } from '$lib/contracts/catalog';
import {
  getTrackArtworkLoadKey,
  loadTrackArtwork,
  revokeTrackArtwork,
  type LoadedStreamArtwork
} from '$lib/services/stream-artwork';
import { getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';

const DEFAULT_SEEK_OFFSET_SECONDS = 10;
const POSITION_STATE_UPDATE_INTERVAL_SECONDS = 0.5;
const POSITION_STATE_SEEK_DELTA_SECONDS = 1;

interface PublishedPositionState {
  trackId: string | null;
  duration: number;
  position: number;
  playbackRate: number;
  playbackState: PlaybackSnapshot['state'];
}

interface MediaSessionHandlers {
  play: () => void | Promise<void>;
  pause?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
  previousTrack?: () => void | Promise<void>;
  nextTrack?: () => void | Promise<void>;
  seekTo?: (seconds: number) => void | Promise<void>;
}

interface MediaSessionConnectOptions {
  snapshot: Readable<PlaybackSnapshot>;
  track: Readable<MediaEntity | null>;
  settings: Readable<PlaybackSettings>;
  artworkOverride?: Readable<LoadedStreamArtwork | null | undefined>;
  transportAnchorActive?: Readable<boolean>;
  handlers: MediaSessionHandlers;
}

const TRANSPORT_ANCHOR_DURATION_SECONDS = 8;
const TRANSPORT_ANCHOR_SAMPLE_RATE = 8_000;

function createTransportAnchorUrl(): string {
  const sampleCount = TRANSPORT_ANCHOR_DURATION_SECONDS * TRANSPORT_ANCHOR_SAMPLE_RATE;
  const bytesPerSample = 2;
  const dataLength = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeText(offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TRANSPORT_ANCHOR_SAMPLE_RATE, true);
  view.setUint32(28, TRANSPORT_ANCHOR_SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataLength, true);

  // Avoid browsers optimizing a completely silent resource away while remaining inaudible.
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(44 + index * bytesPerSample, index % 2 === 0 ? 1 : -1, true);
  }

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createMediaSessionService() {
  let snapshot: PlaybackSnapshot | null = null;
  let track: MediaEntity | null = null;
  let playbackRate = 1;
  let transportAnchor: HTMLAudioElement | null = null;
  let transportAnchorUrl = '';
  let transportHandlers: MediaSessionHandlers | null = null;
  let ignoredTransportPlayEvents = 0;
  let ignoredTransportPauseEvents = 0;
  let lastPublishedPositionState: PublishedPositionState | null = null;
  let trackArtwork: LoadedStreamArtwork | null = null;
  let trackArtworkKey = '';
  let artworkLoadToken = 0;
  let artworkOverride: LoadedStreamArtwork | null | undefined;
  let ownsTransportAnchor = false;
  let ownedTransportAnchorState: 'inactive' | 'paused' | 'playing' = 'inactive';

  function getMediaSession(): MediaSession | null {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return null;
    }

    return navigator.mediaSession;
  }

  function setActionHandler(
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
    mediaSession: MediaSession
  ): void {
    try {
      mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore unsupported actions on Chromium variants that only expose a subset.
    }
  }

  function buildMetadata(activeTrack: MediaEntity): MediaMetadataInit {
    const artist = getTrackDisplaySubtitle(activeTrack) || undefined;
    const album = activeTrack.metadata?.album?.trim();
    const trackerType = activeTrack.metadata?.trackerType?.trim();

    return {
      title: getTrackDisplayTitle(activeTrack) || activeTrack.name,
      artist,
      album: album || (activeTrack.kind === 'module' ? trackerType || activeTrack.format.toUpperCase() : undefined),
      artwork: trackArtwork ? [trackArtwork.mediaImage] : undefined
    };
  }

  function clearTrackArtwork(): void {
    revokeTrackArtwork(trackArtwork);
    trackArtwork = null;
  }

  function ensureTransportAnchor(): HTMLAudioElement | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (transportAnchor) {
      return transportAnchor;
    }

    transportAnchor = document.createElement('audio');
    transportAnchorUrl = createTransportAnchorUrl();
    transportAnchor.src = transportAnchorUrl;
    transportAnchor.loop = true;
    transportAnchor.preload = 'auto';
    transportAnchor.volume = 1;
    transportAnchor.setAttribute('playsinline', '');
    transportAnchor.setAttribute('aria-hidden', 'true');
    transportAnchor.tabIndex = -1;
    transportAnchor.style.position = 'fixed';
    transportAnchor.style.left = '-9999px';
    transportAnchor.style.bottom = '0';
    transportAnchor.style.width = '1px';
    transportAnchor.style.height = '1px';
    transportAnchor.style.opacity = '0';
    transportAnchor.style.pointerEvents = 'none';
    document.body?.appendChild(transportAnchor);

    transportAnchor.addEventListener('play', () => {
      if (ignoredTransportPlayEvents > 0) {
        ignoredTransportPlayEvents -= 1;
        return;
      }

      void transportHandlers?.play();
    });
    transportAnchor.addEventListener('pause', () => {
      if (ignoredTransportPauseEvents > 0) {
        ignoredTransportPauseEvents -= 1;
        return;
      }

      void transportHandlers?.pause?.();
    });

    return transportAnchor;
  }

  function syncMetadata(mediaSession: MediaSession): void {
    mediaSession.metadata = track ? new MediaMetadata(buildMetadata(track)) : null;
  }

  function syncPlaybackState(mediaSession: MediaSession): void {
    mediaSession.playbackState = track ? (snapshot?.state === 'playing' ? 'playing' : 'paused') : 'none';
  }

  function resetPublishedPositionState(): void {
    lastPublishedPositionState = null;
  }

  function shouldPublishPositionState(nextState: PublishedPositionState): boolean {
    const previousState = lastPublishedPositionState;

    if (!previousState) {
      return true;
    }

    if (previousState.trackId !== nextState.trackId) {
      return true;
    }

    if (
      previousState.duration !== nextState.duration ||
      previousState.playbackRate !== nextState.playbackRate ||
      previousState.playbackState !== nextState.playbackState
    ) {
      return true;
    }

    const positionDelta = Math.abs(nextState.position - previousState.position);

    if (positionDelta >= POSITION_STATE_SEEK_DELTA_SECONDS) {
      return true;
    }

    if (nextState.playbackState !== 'playing') {
      return positionDelta > 0;
    }

    return positionDelta >= POSITION_STATE_UPDATE_INTERVAL_SECONDS;
  }

  function syncPositionState(mediaSession: MediaSession): void {
    if (typeof mediaSession.setPositionState !== 'function') {
      return;
    }

    if (!track) {
      try {
        mediaSession.setPositionState();
        resetPublishedPositionState();
      } catch {
        // Ignore invalid/unsupported position state updates.
      }

      return;
    }

    const duration = snapshot?.duration ?? 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      resetPublishedPositionState();
      return;
    }

    const positionPlaybackRate = snapshot?.state === 'playing'
      ? track.kind === 'module' ? 1 : playbackRate
      : 0;
    const nextState: PublishedPositionState = {
      trackId: track.id,
      duration,
      position: clamp(snapshot?.currentTime ?? 0, 0, duration),
      playbackRate: positionPlaybackRate,
      playbackState: snapshot?.state ?? 'idle'
    };

    if (!shouldPublishPositionState(nextState)) {
      return;
    }

    try {
      mediaSession.setPositionState({
        duration: nextState.duration,
        position: nextState.position,
        playbackRate: nextState.playbackRate
      });
      lastPublishedPositionState = nextState;
    } catch {
      // Ignore invalid/unsupported position state updates.
    }
  }

  function syncSession(mediaSession: MediaSession): void {
    syncMetadata(mediaSession);
    syncPlaybackState(mediaSession);
    syncPositionState(mediaSession);
  }

  function syncOwnedTransportAnchor(): void {
    if (!ownsTransportAnchor) {
      return;
    }

    const nextState = snapshot?.state === 'playing' ? 'playing' : 'paused';
    if (ownedTransportAnchorState === nextState) {
      return;
    }

    ensureTransportAnchor();
    ownedTransportAnchorState = nextState;
    if (nextState === 'playing') {
      mediaSessionService.playTransportAnchor();
    } else {
      mediaSessionService.pauseTransportAnchor();
    }
  }

  async function syncTrackArtwork(mediaSession: MediaSession, activeTrack: MediaEntity | null): Promise<void> {
    const loadToken = ++artworkLoadToken;

    clearTrackArtwork();
    syncSession(mediaSession);

    if (!activeTrack) {
      return;
    }

    const artwork = await loadTrackArtwork(activeTrack);

    if (loadToken !== artworkLoadToken) {
      revokeTrackArtwork(artwork);
      return;
    }

    trackArtwork = artwork;
    syncSession(mediaSession);
  }

  function resolveSeekTarget(delta: number): number | null {
    if (!track || !snapshot) {
      return null;
    }

    const duration = snapshot.duration;

    if (!Number.isFinite(duration) || duration <= 0) {
      return null;
    }

    return clamp(snapshot.currentTime + delta, 0, duration);
  }

  function registerHandlers(handlers: MediaSessionHandlers): void {
    const mediaSession = getMediaSession();

    if (!mediaSession) {
      return;
    }

    setActionHandler('play', () => void handlers.play(), mediaSession);
    setActionHandler('pause', handlers.pause ? () => void handlers.pause?.() : null, mediaSession);
    setActionHandler('stop', handlers.stop ? () => void handlers.stop?.() : null, mediaSession);
    setActionHandler(
      'previoustrack',
      handlers.previousTrack ? () => void handlers.previousTrack?.() : null,
      mediaSession
    );
    setActionHandler(
      'nexttrack',
      handlers.nextTrack ? () => void handlers.nextTrack?.() : null,
      mediaSession
    );
    setActionHandler(
      'seekbackward',
      handlers.seekTo
        ? (details) => {
            const nextPosition = resolveSeekTarget(-(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS));

            if (nextPosition !== null) {
              void handlers.seekTo?.(nextPosition);
            }
          }
        : null,
      mediaSession
    );
    setActionHandler(
      'seekforward',
      handlers.seekTo
        ? (details) => {
            const nextPosition = resolveSeekTarget(details.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS);

            if (nextPosition !== null) {
              void handlers.seekTo?.(nextPosition);
            }
          }
        : null,
      mediaSession
    );
    setActionHandler(
      'seekto',
      handlers.seekTo
        ? (details) => {
            if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) {
              return;
            }

            const duration = snapshot?.duration ?? 0;
            const nextPosition =
              Number.isFinite(duration) && duration > 0
                ? clamp(details.seekTime, 0, duration)
                : Math.max(details.seekTime, 0);

            void handlers.seekTo?.(nextPosition);
          }
        : null,
      mediaSession
    );
    syncSession(mediaSession);
  }

  function clearHandlers(): void {
    const mediaSession = getMediaSession();

    if (!mediaSession) {
      return;
    }

    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'stop',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto'
    ];

    for (const action of actions) {
      setActionHandler(action, null, mediaSession);
    }
  }

  return {
    activateTransportAnchor(): void {
      ensureTransportAnchor();
    },
    playTransportAnchor(): void {
      const audio = ensureTransportAnchor();

      if (!audio || !audio.paused) {
        return;
      }

      ignoredTransportPlayEvents += 1;
      void audio.play().catch(() => {
        ignoredTransportPlayEvents = Math.max(ignoredTransportPlayEvents - 1, 0);
        if (ownsTransportAnchor && snapshot?.state === 'playing') {
          ownedTransportAnchorState = 'inactive';
        }
      });
    },
    pauseTransportAnchor(): void {
      const audio = transportAnchor;

      if (!audio || audio.paused) {
        return;
      }

      ignoredTransportPauseEvents += 1;
      audio.pause();
    },
    deactivateTransportAnchor(): void {
      const audio = transportAnchor;

      if (!audio) {
        return;
      }

      if (!audio.paused) {
        ignoredTransportPauseEvents += 1;
        audio.pause();
      }
      audio.currentTime = 0;
    },
    connect({
      snapshot: snapshotStore,
      track: trackStore,
      settings: settingsStore,
      artworkOverride: artworkOverrideStore,
      transportAnchorActive: transportAnchorActiveStore,
      handlers
    }: MediaSessionConnectOptions): () => void {
      const mediaSession = getMediaSession();

      if (!mediaSession) {
        return () => undefined;
      }

      transportHandlers = handlers;
      registerHandlers(handlers);

      const unsubscribeSnapshot = snapshotStore.subscribe((value) => {
        snapshot = value;
        syncSession(mediaSession);
        syncOwnedTransportAnchor();
      });
      const unsubscribeTrack = trackStore.subscribe((value) => {
        const nextArtworkKey = getTrackArtworkLoadKey(value);
        track = value;

        if (artworkOverride !== undefined) {
          trackArtwork = artworkOverride;
          syncSession(mediaSession);
          return;
        }

        if (nextArtworkKey === trackArtworkKey) {
          syncSession(mediaSession);
          return;
        }

        trackArtworkKey = nextArtworkKey;
        void syncTrackArtwork(mediaSession, value);
      });
      const unsubscribeSettings = settingsStore.subscribe((value) => {
        playbackRate = value.playbackRate;
        syncPositionState(mediaSession);
      });
      const unsubscribeArtworkOverride = artworkOverrideStore?.subscribe((value) => {
        const wasOverridden = artworkOverride !== undefined;
        artworkOverride = value;

        if (value === undefined) {
          if (wasOverridden) {
            artworkLoadToken += 1;
            clearTrackArtwork();
            void syncTrackArtwork(mediaSession, track);
          }
          return;
        }

        artworkLoadToken += 1;
        clearTrackArtwork();
        trackArtwork = value;
        syncSession(mediaSession);
      }) ?? (() => undefined);
      const unsubscribeTransportAnchor = transportAnchorActiveStore?.subscribe((value) => {
        const previouslyOwned = ownsTransportAnchor;
        ownsTransportAnchor = value;

        if (!value && previouslyOwned) {
          mediaSessionService.deactivateTransportAnchor();
          ownedTransportAnchorState = 'inactive';
          return;
        }

        syncOwnedTransportAnchor();
      }) ?? (() => undefined);

      return () => {
        unsubscribeSnapshot();
        unsubscribeTrack();
        unsubscribeSettings();
        unsubscribeArtworkOverride();
        unsubscribeTransportAnchor();
        artworkLoadToken += 1;
        snapshot = null;
        track = null;
        playbackRate = 1;
        trackArtworkKey = '';
        artworkOverride = undefined;
        clearTrackArtwork();
        if (ownsTransportAnchor) mediaSessionService.deactivateTransportAnchor();
        ownsTransportAnchor = false;
        ownedTransportAnchorState = 'inactive';
        transportHandlers = null;
        syncSession(mediaSession);
        clearHandlers();
      };
    }
  };
}

export const mediaSessionService = createMediaSessionService();
