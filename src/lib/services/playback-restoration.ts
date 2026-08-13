import type { Readable } from 'svelte/store';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { PlaybackSnapshot } from '$lib/contracts/playback';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { MediaMaterializationLease } from '$lib/media/media-source';

export const PLAYBACK_RESTORATION_STORAGE_KEY = 'izci.playback-restoration';
const CHECKPOINT_DELAY_MS = 500;

export interface PlaybackRestorationCheckpoint {
  trackId: string;
  currentTime: number;
  wasPlaying: boolean;
}

interface CreatePlaybackRestorationControllerOptions {
  track: Readable<MediaEntity | null>;
  snapshot: Readable<PlaybackSnapshot>;
  getPlaylistTrack: (id: string) => MediaEntity | null;
  ensureLoaded: (id: string) => Promise<MediaMaterializationLease | null>;
  selectTrack: (id: string) => void;
  loadTrack: (
    track: MediaMaterializationLease,
    options: { autoPlay: boolean; initialPosition: number }
  ) => Promise<void>;
}

export function normalizePlaybackRestorationCheckpoint(
  value: unknown
): PlaybackRestorationCheckpoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<PlaybackRestorationCheckpoint>;
  if (
    typeof source.trackId !== 'string' ||
    source.trackId.length === 0 ||
    typeof source.currentTime !== 'number' ||
    !Number.isFinite(source.currentTime) ||
    typeof source.wasPlaying !== 'boolean'
  ) {
    return null;
  }

  return {
    trackId: source.trackId,
    currentTime: Math.max(source.currentTime, 0),
    wasPlaying: source.wasPlaying
  };
}

function readCheckpoint(): PlaybackRestorationCheckpoint | null {
  try {
    const stored = window.localStorage.getItem(PLAYBACK_RESTORATION_STORAGE_KEY);
    return stored ? normalizePlaybackRestorationCheckpoint(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function createPlaybackRestorationController({
  track,
  snapshot,
  getPlaylistTrack,
  ensureLoaded,
  selectTrack,
  loadTrack
}: CreatePlaybackRestorationControllerOptions) {
  let currentTrack: MediaEntity | null = null;
  let currentSnapshot: PlaybackSnapshot | null = null;
  let checkpoint = readCheckpoint();
  let restoring = checkpoint !== null && playbackSettings.getSnapshot().restoreMode !== 'disabled';
  let pageHidden = false;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStoredCheckpoint(): void {
    checkpoint = null;
    window.localStorage.removeItem(PLAYBACK_RESTORATION_STORAGE_KEY);
  }

  function flushCheckpoint(): void {
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }

    if (restoring || playbackSettings.getSnapshot().restoreMode === 'disabled') {
      return;
    }

    if (!currentTrack || !currentSnapshot) {
      clearStoredCheckpoint();
      return;
    }

    checkpoint = {
      trackId: currentTrack.id,
      currentTime: Math.max(currentSnapshot.currentTime, 0),
      wasPlaying: currentSnapshot.state === 'playing'
    };
    window.localStorage.setItem(PLAYBACK_RESTORATION_STORAGE_KEY, JSON.stringify(checkpoint));
  }

  function scheduleCheckpoint(): void {
    if (restoring || pageHidden || checkpointTimer !== null) {
      return;
    }

    checkpointTimer = setTimeout(flushCheckpoint, CHECKPOINT_DELAY_MS);
  }

  const unsubscribeTrack = track.subscribe((value) => {
    currentTrack = value;
    scheduleCheckpoint();
  });
  const unsubscribeSnapshot = snapshot.subscribe((value) => {
    currentSnapshot = value;
    scheduleCheckpoint();
  });
  const unsubscribeSettings = playbackSettings.subscribe((settings) => {
    if (settings.restoreMode === 'disabled') {
      restoring = false;
      clearStoredCheckpoint();
      return;
    }

    scheduleCheckpoint();
  });

  function handlePageHide(): void {
    flushCheckpoint();
    pageHidden = true;
  }

  window.addEventListener('pagehide', handlePageHide);

  return {
    async restore(): Promise<boolean> {
      const restoreMode = playbackSettings.getSnapshot().restoreMode;
      const savedCheckpoint = checkpoint;

      if (restoreMode === 'disabled' || !savedCheckpoint) {
        restoring = false;
        if (restoreMode === 'disabled') {
          clearStoredCheckpoint();
        }
        return false;
      }

      try {
        const storedTrack = getPlaylistTrack(savedCheckpoint.trackId);
        if (!storedTrack) {
          clearStoredCheckpoint();
          return false;
        }

        const playableTrack = await ensureLoaded(storedTrack.id);
        if (!playableTrack) {
          return false;
        }

        selectTrack(playableTrack.entity.id);
        await loadTrack(playableTrack, {
          autoPlay: restoreMode === 'position-and-state' && savedCheckpoint.wasPlaying,
          initialPosition: savedCheckpoint.currentTime
        });
        return true;
      } finally {
        restoring = false;
        flushCheckpoint();
      }
    },
    destroy(): void {
      if (!pageHidden) {
        flushCheckpoint();
      }
      unsubscribeTrack();
      unsubscribeSnapshot();
      unsubscribeSettings();
      window.removeEventListener('pagehide', handlePageHide);
    }
  };
}
