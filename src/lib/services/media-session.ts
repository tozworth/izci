import type { Readable } from 'svelte/store';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';
import { getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';

const DEFAULT_SEEK_OFFSET_SECONDS = 10;

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
  track: Readable<PlaylistItem | null>;
  handlers: MediaSessionHandlers;
}

const SILENT_AUDIO_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createMediaSessionService() {
  let snapshot: PlaybackSnapshot | null = null;
  let track: PlaylistItem | null = null;
  let transportAnchor: HTMLAudioElement | null = null;
  let transportHandlers: MediaSessionHandlers | null = null;
  let syncingTransportAnchor = false;

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

  function buildMetadata(activeTrack: PlaylistItem): MediaMetadataInit {
    const artist = getTrackDisplaySubtitle(activeTrack) || undefined;
    const album = activeTrack.metadata?.album?.trim();
    const trackerType = activeTrack.metadata?.trackerType?.trim();

    return {
      title: getTrackDisplayTitle(activeTrack) || activeTrack.name,
      artist,
      album: album || (activeTrack.kind === 'module' ? trackerType || activeTrack.extension.toUpperCase() : undefined)
    };
  }

  function ensureTransportAnchor(): HTMLAudioElement | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (transportAnchor) {
      return transportAnchor;
    }

    transportAnchor = document.createElement('audio');
    transportAnchor.src = SILENT_AUDIO_DATA_URI;
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
      if (syncingTransportAnchor) {
        return;
      }

      void transportHandlers?.play();
    });
    transportAnchor.addEventListener('pause', () => {
      if (syncingTransportAnchor) {
        return;
      }

      void transportHandlers?.pause?.();
    });

    return transportAnchor;
  }

  function withTransportAnchorSync<T>(action: () => T): T {
    syncingTransportAnchor = true;

    try {
      return action();
    } finally {
      queueMicrotask(() => {
        syncingTransportAnchor = false;
      });
    }
  }

  function syncMetadata(mediaSession: MediaSession): void {
    mediaSession.metadata = track ? new MediaMetadata(buildMetadata(track)) : null;
  }

  function syncPlaybackState(mediaSession: MediaSession): void {
    mediaSession.playbackState = track ? (snapshot?.state === 'playing' ? 'playing' : 'paused') : 'none';
  }

  function syncPositionState(mediaSession: MediaSession): void {
    if (typeof mediaSession.setPositionState !== 'function') {
      return;
    }

    if (!track) {
      try {
        mediaSession.setPositionState();
      } catch {
        // Ignore invalid/unsupported position state updates.
      }

      return;
    }

    const duration = snapshot?.duration ?? 0;

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    try {
      mediaSession.setPositionState({
        duration,
        position: clamp(snapshot?.currentTime ?? 0, 0, duration),
        playbackRate: snapshot?.state === 'playing' ? 1 : 0
      });
    } catch {
      // Ignore invalid/unsupported position state updates.
    }
  }

  function syncSession(mediaSession: MediaSession): void {
    syncMetadata(mediaSession);
    syncPlaybackState(mediaSession);
    syncPositionState(mediaSession);
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

      if (!audio) {
        return;
      }

      withTransportAnchorSync(() => {
        void audio.play().catch(() => undefined);
      });
    },
    pauseTransportAnchor(): void {
      const audio = transportAnchor;

      if (!audio) {
        return;
      }

      withTransportAnchorSync(() => {
        audio.pause();
      });
    },
    deactivateTransportAnchor(): void {
      const audio = transportAnchor;

      if (!audio) {
        return;
      }

      withTransportAnchorSync(() => {
        audio.pause();
        audio.currentTime = 0;
      });
    },
    connect({ snapshot: snapshotStore, track: trackStore, handlers }: MediaSessionConnectOptions): () => void {
      const mediaSession = getMediaSession();

      if (!mediaSession) {
        return () => undefined;
      }

      transportHandlers = handlers;
      registerHandlers(handlers);

      const unsubscribeSnapshot = snapshotStore.subscribe((value) => {
        snapshot = value;
        syncSession(mediaSession);
      });
      const unsubscribeTrack = trackStore.subscribe((value) => {
        track = value;
        syncSession(mediaSession);
      });

      return () => {
        unsubscribeSnapshot();
        unsubscribeTrack();
        snapshot = null;
        track = null;
        transportHandlers = null;
        syncSession(mediaSession);
        clearHandlers();
      };
    }
  };
}

export const mediaSessionService = createMediaSessionService();
