import type { PlaybackState } from '$lib/contracts/playback';
import type { MediaEntity } from '$lib/contracts/catalog';
import { getTrackIdentity } from '$lib/utils/files';

interface PlayCountTrackerSyncInput {
  track: MediaEntity | null;
  playbackState: PlaybackState;
  libraryItems: MediaEntity[];
  thresholdSeconds: number;
}

interface PlayCountTrackerOptions {
  incrementLibraryPlayCount: (libraryItemId: string) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

interface ActivePlayCountSession {
  trackId: string;
  libraryItemId: string;
  timerId: ReturnType<typeof setTimeout>;
}

function resolveLibraryItem(track: MediaEntity | null, libraryItems: MediaEntity[]): MediaEntity | null {
  if (!track) {
    return null;
  }

  const directMatch = libraryItems.find((item) => item.id === track.id);

  if (directMatch) {
    return directMatch;
  }

  const trackIdentity = getTrackIdentity(track);
  return libraryItems.find((item) => getTrackIdentity(item) === trackIdentity) ?? null;
}

function normalizeThresholdMilliseconds(thresholdSeconds: number): number {
  return Math.max(1, Math.round(thresholdSeconds * 1000));
}

export function createPlayCountTracker({
  incrementLibraryPlayCount,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}: PlayCountTrackerOptions) {
  let activeSession: ActivePlayCountSession | null = null;
  let countedSessionKey: string | null = null;

  function clearActiveSession(): void {
    if (!activeSession) {
      return;
    }

    clearTimeoutFn(activeSession.timerId);
    activeSession = null;
  }

  function getSessionKey(trackId: string, libraryItemId: string): string {
    return `${trackId}:${libraryItemId}`;
  }

  function resetInactiveSession(): void {
    clearActiveSession();
    countedSessionKey = null;
  }

  function sync({ track, playbackState, libraryItems, thresholdSeconds }: PlayCountTrackerSyncInput): void {
    const libraryItem = resolveLibraryItem(track, libraryItems);

    if (!track || playbackState !== 'playing' || !libraryItem) {
      resetInactiveSession();
      return;
    }

    const sessionKey = getSessionKey(track.id, libraryItem.id);

    if (countedSessionKey && countedSessionKey !== sessionKey) {
      countedSessionKey = null;
    }

    if (countedSessionKey === sessionKey) {
      clearActiveSession();
      return;
    }

    if (
      activeSession &&
      activeSession.trackId === track.id &&
      activeSession.libraryItemId === libraryItem.id
    ) {
      return;
    }

    clearActiveSession();

    const timerId = setTimeoutFn(() => {
      countedSessionKey = sessionKey;
      activeSession = null;
      incrementLibraryPlayCount(libraryItem.id);
    }, normalizeThresholdMilliseconds(thresholdSeconds));

    activeSession = {
      trackId: track.id,
      libraryItemId: libraryItem.id,
      timerId
    };
  }

  return {
    sync,
    destroy: clearActiveSession
  };
}
