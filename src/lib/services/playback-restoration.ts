import type { Readable } from 'svelte/store';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';
import { logWarning } from '$lib/services/logging';

const PLAYBACK_RESTORATION_STORAGE_KEY = 'izci.playback-restoration';
const CHECKPOINT_DELAY_MS = 500;

interface PlaybackRestorationCheckpoint {
  trackId: string;
  currentTime: number;
  wasPlaying: boolean;
}

interface CreatePlaybackRestorationControllerOptions {
  track: Readable<TrackItem | null>;
  snapshot: Readable<PlaybackSnapshot>;
  getQueueTrack: (id: string) => TrackItem | null;
  ensureLoaded: (id: string) => Promise<TrackItem | null>;
  selectTrack: (id: string) => void;
  loadTrack: (
    track: TrackItem,
    options: { autoPlay: boolean; initialPosition: number }
  ) => Promise<void>;
  prepareFileAccess?: (track: TrackItem) => Promise<void>;
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
  getQueueTrack,
  ensureLoaded,
  selectTrack,
  loadTrack,
  prepareFileAccess = async () => undefined
}: CreatePlaybackRestorationControllerOptions) {
  let currentTrack: TrackItem | null = null;
  let currentSnapshot: PlaybackSnapshot | null = null;
  let checkpoint = readCheckpoint();
  let restoring = checkpoint !== null && playbackSettings.getSnapshot().restoreMode !== 'disabled';
  let pageHidden = false;
  let restoreFailed = false;
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

    if (restoring || restoreFailed || playbackSettings.getSnapshot().restoreMode === 'disabled') {
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
    if (!restoring && currentTrack && (value.state === 'playing' || value.state === 'paused')) {
      restoreFailed = false;
    }
    scheduleCheckpoint();
  });
  const unsubscribeSettings = playbackSettings.subscribe((settings) => {
    if (settings.restoreMode === 'disabled') {
      restoring = false;
      restoreFailed = false;
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
        const storedTrack = getQueueTrack(savedCheckpoint.trackId);
        if (!storedTrack) {
          clearStoredCheckpoint();
          return false;
        }

        await prepareFileAccess(storedTrack);
        const playableTrack = await ensureLoaded(storedTrack.id);
        if (!playableTrack) {
          restoreFailed = true;
          logWarning('playback', 'Playback restoration deferred because file access is unavailable');
          return false;
        }

        selectTrack(playableTrack.id);
        await loadTrack(playableTrack, {
          autoPlay: restoreMode === 'position-and-state' && savedCheckpoint.wasPlaying,
          initialPosition: savedCheckpoint.currentTime
        });
        return true;
      } catch (error) {
        restoreFailed = true;
        logWarning('playback', 'Playback restoration failed', { error });
        return false;
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
