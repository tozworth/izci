import { writable, type Readable } from 'svelte/store';
import { playbackSettings, REMEMBER_PROGRESS_DURATION_MINUTES } from '$lib/stores/playback-settings';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

const DATABASE_NAME = 'izci-playback-progress';
const DATABASE_VERSION = 1;
const STORE_NAME = 'progress';
const CHECKPOINT_INTERVAL_MS = 5_000;
const RESUME_NOTICE_DURATION_MS = 5_000;
const MINIMUM_RESUME_POSITION_SECONDS = 10;
const MAXIMUM_COMPLETION_MARGIN_SECONDS = 60;
const COMPLETION_FRACTION = 0.05;

export interface PlaybackProgressRecord {
  identity: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
}

export interface PlaybackProgressNotice {
  trackId: string;
  currentTime: number;
}

export interface PlaybackProgressState {
  notice: PlaybackProgressNotice | null;
}

interface CreatePlaybackProgressControllerOptions {
  track: Readable<PlaylistItem | null>;
  snapshot: Readable<PlaybackSnapshot>;
}

function getProgressIdentity(track: PlaylistItem): string {
  return `${getTrackIdentity(track)}:${track.size}:${track.lastModified}:subsong:${track.subsong ?? 'all'}`;
}

export function normalizePlaybackProgressRecord(value: unknown): PlaybackProgressRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const source = value as Partial<PlaybackProgressRecord>;
  if (
    typeof source.identity !== 'string' ||
    source.identity.length === 0 ||
    typeof source.currentTime !== 'number' ||
    !Number.isFinite(source.currentTime) ||
    typeof source.duration !== 'number' ||
    !Number.isFinite(source.duration) ||
    typeof source.updatedAt !== 'number' ||
    !Number.isFinite(source.updatedAt)
  ) {
    return null;
  }

  return {
    identity: source.identity,
    currentTime: Math.max(source.currentTime, 0),
    duration: Math.max(source.duration, 0),
    updatedAt: Math.max(source.updatedAt, 0)
  };
}

export function shouldRememberPlaybackProgress(
  currentTime: number,
  duration: number,
  minimumDurationMinutes: number
): boolean {
  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    currentTime < MINIMUM_RESUME_POSITION_SECONDS ||
    duration <= 0 ||
    duration < minimumDurationMinutes * 60
  ) {
    return false;
  }

  const completionMargin = Math.min(
    MAXIMUM_COMPLETION_MARGIN_SECONDS,
    duration * COMPLETION_FRACTION
  );
  return currentTime < duration - completionMargin;
}

async function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return null;
  }

  return await new Promise((resolve) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'identity' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function readProgress(identity: string): Promise<PlaybackProgressRecord | null> {
  const database = await openDatabase();
  if (!database) return null;

  return await new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(identity);
    let result: PlaybackProgressRecord | null = null;

    request.onsuccess = () => {
      result = normalizePlaybackProgressRecord(request.result);
    };
    request.onerror = () => {
      result = null;
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      resolve(null);
    };
    transaction.onabort = () => {
      database.close();
      resolve(null);
    };
  });
}

export async function readAllPlaybackProgress(): Promise<PlaybackProgressRecord[]> {
  const database = await openDatabase();
  if (!database) return [];

  return await new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    let result: PlaybackProgressRecord[] = [];
    request.onsuccess = () => {
      result = Array.isArray(request.result)
        ? request.result
            .map(normalizePlaybackProgressRecord)
            .filter((record): record is PlaybackProgressRecord => record !== null)
        : [];
    };
    request.onerror = () => {
      result = [];
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve([]);
    };
  });
}

export async function mergePlaybackProgress(records: PlaybackProgressRecord[]): Promise<number> {
  const normalized = records
    .map(normalizePlaybackProgressRecord)
    .filter((record): record is PlaybackProgressRecord => record !== null);
  if (normalized.length === 0) return 0;

  const database = await openDatabase();
  if (!database) return 0;

  return await new Promise((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    let restored = 0;
    for (const record of normalized) {
      const request = store.get(record.identity);
      request.onsuccess = () => {
        const current = normalizePlaybackProgressRecord(request.result);
        if (!current || record.updatedAt >= current.updatedAt) {
          store.put(record);
          restored += 1;
        }
      };
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(restored);
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve(0);
    };
  });
}

async function writeProgress(record: PlaybackProgressRecord): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}

async function deleteProgress(identity: string): Promise<void> {
  const database = await openDatabase();
  if (!database) return;

  await new Promise<void>((resolve) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(identity);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      database.close();
      resolve();
    };
  });
}

export function createPlaybackProgressController({
  track,
  snapshot
}: CreatePlaybackProgressControllerOptions) {
  let state: PlaybackProgressState = { notice: null };
  let currentTrack: PlaylistItem | null = null;
  let currentSnapshot: PlaybackSnapshot | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDeletedIdentity: string | null = null;
  let persistenceQueue = Promise.resolve();
  const store = writable(state);

  function publishState(): void {
    store.set(state);
  }

  function enqueue(operation: () => Promise<void>): Promise<void> {
    persistenceQueue = persistenceQueue.then(operation, operation);
    return persistenceQueue;
  }

  function persistCheckpoint(
    checkpointTrack: PlaylistItem | null,
    checkpointSnapshot: PlaybackSnapshot | null
  ): Promise<void> {
    if (!checkpointTrack || !checkpointSnapshot) {
      return persistenceQueue;
    }

    const identity = getProgressIdentity(checkpointTrack);
    const durationIndex = playbackSettings.getSnapshot().rememberProgressDurationIndex;
    const minimumDurationMinutes = REMEMBER_PROGRESS_DURATION_MINUTES[durationIndex] ?? null;

    if (
      minimumDurationMinutes === null ||
      !shouldRememberPlaybackProgress(
        checkpointSnapshot.currentTime,
        checkpointSnapshot.duration,
        minimumDurationMinutes
      )
    ) {
      if (lastDeletedIdentity === identity) return persistenceQueue;
      lastDeletedIdentity = identity;
      return enqueue(() => deleteProgress(identity));
    }

    if (lastDeletedIdentity === identity) lastDeletedIdentity = null;
    const record: PlaybackProgressRecord = {
      identity,
      currentTime: checkpointSnapshot.currentTime,
      duration: checkpointSnapshot.duration,
      updatedAt: Date.now()
    };
    return enqueue(() => writeProgress(record));
  }

  function flush(): Promise<void> {
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    return persistCheckpoint(currentTrack, currentSnapshot);
  }

  function scheduleCheckpoint(): void {
    if (checkpointTimer !== null || !currentTrack || !currentSnapshot) return;
    const durationIndex = playbackSettings.getSnapshot().rememberProgressDurationIndex;
    const minimumDurationMinutes = REMEMBER_PROGRESS_DURATION_MINUTES[durationIndex] ?? null;
    if (
      minimumDurationMinutes === null ||
      currentSnapshot.duration <= 0 ||
      currentSnapshot.duration < minimumDurationMinutes * 60
    ) {
      return;
    }
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null;
      void persistCheckpoint(currentTrack, currentSnapshot);
    }, CHECKPOINT_INTERVAL_MS);
  }

  function dismissNotice(): void {
    if (noticeTimer !== null) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (state.notice) {
      state = { notice: null };
      publishState();
    }
  }

  const unsubscribeTrack = track.subscribe((value) => {
    const trackChanged =
      value?.id !== currentTrack?.id ||
      Boolean(
        value && currentTrack && getProgressIdentity(value) !== getProgressIdentity(currentTrack)
      );
    if (currentTrack && trackChanged) {
      void persistCheckpoint(currentTrack, currentSnapshot);
      dismissNotice();
    }
    currentTrack = value;
    if (trackChanged) currentSnapshot = null;
  });
  const unsubscribeSnapshot = snapshot.subscribe((value) => {
    const previousState = currentSnapshot?.state;
    currentSnapshot = value;
    if (
      (value.state === 'paused' && previousState !== 'paused') ||
      (value.state === 'ended' && previousState !== 'ended')
    ) {
      void flush();
      return;
    }
    scheduleCheckpoint();
  });
  const unsubscribeSettings = playbackSettings.subscribe((settings) => {
    if (settings.rememberProgressDurationIndex === 0) dismissNotice();
    void flush();
  });

  function handlePageHide(): void {
    void flush();
  }
  window.addEventListener('pagehide', handlePageHide);

  return {
    subscribe: store.subscribe,
    getSnapshot(): PlaybackProgressState {
      return state;
    },
    async resolveResumePosition(resumeTrack: PlaylistItem): Promise<number> {
      await flush();
      const durationIndex = playbackSettings.getSnapshot().rememberProgressDurationIndex;
      const minimumDurationMinutes = REMEMBER_PROGRESS_DURATION_MINUTES[durationIndex] ?? null;
      if (minimumDurationMinutes === null) return 0;

      await persistenceQueue;
      const record = await readProgress(getProgressIdentity(resumeTrack));
      if (
        !record ||
        !shouldRememberPlaybackProgress(
          record.currentTime,
          record.duration,
          minimumDurationMinutes
        )
      ) {
        if (record) {
          lastDeletedIdentity = record.identity;
          await enqueue(() => deleteProgress(record.identity));
        }
        return 0;
      }
      return record.currentTime;
    },
    showResumeNotice(resumeTrack: PlaylistItem, currentTime: number): void {
      dismissNotice();
      state = { notice: { trackId: resumeTrack.id, currentTime } };
      publishState();
      noticeTimer = setTimeout(dismissNotice, RESUME_NOTICE_DURATION_MS);
    },
    dismissNotice,
    async clearProgress(clearTrack: PlaylistItem): Promise<void> {
      dismissNotice();
      const identity = getProgressIdentity(clearTrack);
      lastDeletedIdentity = identity;
      await enqueue(() => deleteProgress(identity));
    },
    destroy(): void {
      void flush();
      dismissNotice();
      unsubscribeTrack();
      unsubscribeSnapshot();
      unsubscribeSettings();
      window.removeEventListener('pagehide', handlePageHide);
    }
  };
}
