import { writable, type Readable } from 'svelte/store';
import { playbackSettings, REMEMBER_PROGRESS_DURATION_MINUTES } from '$lib/stores/playback-settings';
import type { PlaybackSnapshot } from '$lib/contracts/playback';
import type { MediaEntity } from '$lib/contracts/catalog';
import { getTrackIdentity } from '$lib/utils/files';
import {
  openBrowserDatabase,
  registerBrowserPersistenceOwner
} from '$lib/persistence/browser-indexed-db';
import {
  defineDatabase,
  defineStore,
  runTransaction,
  type DatabaseConnection
} from '$lib/persistence/indexed-db';
import { logWarning } from '$lib/logging/api';

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
  persistence: {
    state: 'ready' | 'busy' | 'degraded';
    error: unknown | null;
  };
}

interface CreatePlaybackProgressControllerOptions {
  track: Readable<MediaEntity | null>;
  snapshot: Readable<PlaybackSnapshot>;
}

const progressDatabaseSpec = defineDatabase({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: {
    [STORE_NAME]: defineStore<PlaybackProgressRecord, string>()({ keyPath: 'identity' })
  }
});

async function withProgressDatabase<TResult>(
  work: (connection: DatabaseConnection<typeof progressDatabaseSpec>) => Promise<TResult>
): Promise<TResult> {
  const connection = await openBrowserDatabase(progressDatabaseSpec);
  try {
    return await work(connection);
  } finally {
    await connection.close();
  }
}

function getProgressIdentity(track: MediaEntity): string {
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

async function readProgress(identity: string): Promise<PlaybackProgressRecord | null> {
  return withProgressDatabase((connection) => runTransaction(connection, {
    stores: [STORE_NAME],
    mode: 'readonly',
    operation: 'read playback progress'
  }, async (transaction) => normalizePlaybackProgressRecord(
    await transaction.store(STORE_NAME).get(identity)
  )));
}

export async function readAllPlaybackProgress(): Promise<PlaybackProgressRecord[]> {
  return withProgressDatabase((connection) => runTransaction(connection, {
    stores: [STORE_NAME],
    mode: 'readonly',
    operation: 'read all playback progress'
  }, async (transaction) => (await transaction.store(STORE_NAME).getAll())
    .map(normalizePlaybackProgressRecord)
    .filter((record): record is PlaybackProgressRecord => record !== null)));
}

export async function mergePlaybackProgress(records: PlaybackProgressRecord[]): Promise<number> {
  const normalized = records
    .map(normalizePlaybackProgressRecord)
    .filter((record): record is PlaybackProgressRecord => record !== null);
  if (normalized.length === 0) return 0;

  return withProgressDatabase((connection) => runTransaction(connection, {
    stores: [STORE_NAME],
    mode: 'readwrite',
    operation: 'merge playback progress',
    durability: 'strict'
  }, async (transaction) => {
    const store = transaction.store(STORE_NAME);
    let restored = 0;
    for (const record of normalized) {
      const current = normalizePlaybackProgressRecord(await store.get(record.identity));
      if (!current || record.updatedAt >= current.updatedAt) {
        await store.put(record);
        restored += 1;
      }
    }
    return restored;
  }));
}

async function writeProgress(record: PlaybackProgressRecord): Promise<void> {
  await withProgressDatabase((connection) => runTransaction(connection, {
    stores: [STORE_NAME],
    mode: 'readwrite',
    operation: 'persist playback progress',
    durability: 'strict'
  }, async (transaction) => {
    await transaction.store(STORE_NAME).put(record);
  }));
}

async function deleteProgress(identity: string): Promise<void> {
  await withProgressDatabase((connection) => runTransaction(connection, {
    stores: [STORE_NAME],
    mode: 'readwrite',
    operation: 'delete playback progress',
    durability: 'strict'
  }, async (transaction) => {
    await transaction.store(STORE_NAME).delete(identity);
  }));
}

export function createPlaybackProgressController({
  track,
  snapshot
}: CreatePlaybackProgressControllerOptions) {
  let state: PlaybackProgressState = {
    notice: null,
    persistence: { state: 'ready', error: null }
  };
  let currentTrack: MediaEntity | null = null;
  let currentSnapshot: PlaybackSnapshot | null = null;
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDeletedIdentity: string | null = null;
  let persistenceQueue = Promise.resolve();
  const store = writable(state);

  function publishState(): void {
    store.set(state);
  }

  function setPersistence(
    persistence: PlaybackProgressState['persistence']
  ): void {
    state = { ...state, persistence };
    publishState();
  }

  function enqueue(operation: () => Promise<void>): Promise<void> {
    const execute = async (): Promise<void> => {
      setPersistence({ state: 'busy', error: null });
      try {
        await operation();
        setPersistence({ state: 'ready', error: null });
      } catch (error) {
        logWarning('playback', 'Playback progress persistence failed', { error });
        setPersistence({ state: 'degraded', error });
      }
    };
    persistenceQueue = persistenceQueue.then(execute, execute);
    return persistenceQueue;
  }

  function persistCheckpoint(
    checkpointTrack: MediaEntity | null,
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
      state = { ...state, notice: null };
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

  const controller = {
    subscribe: store.subscribe,
    getSnapshot(): PlaybackProgressState {
      return state;
    },
    async resolveResumePosition(resumeTrack: MediaEntity): Promise<number> {
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
    showResumeNotice(resumeTrack: MediaEntity, currentTime: number): void {
      dismissNotice();
      state = { ...state, notice: { trackId: resumeTrack.id, currentTime } };
      publishState();
      noticeTimer = setTimeout(dismissNotice, RESUME_NOTICE_DURATION_MS);
    },
    dismissNotice,
    async clearProgress(clearTrack: MediaEntity): Promise<void> {
      dismissNotice();
      const identity = getProgressIdentity(clearTrack);
      lastDeletedIdentity = identity;
      await enqueue(() => deleteProgress(identity));
    },
    async destroy(): Promise<void> {
      await flush();
      dismissNotice();
      unsubscribeTrack();
      unsubscribeSnapshot();
      unsubscribeSettings();
      window.removeEventListener('pagehide', handlePageHide);
      unregisterPersistenceOwner();
    }
  };

  const unregisterPersistenceOwner = registerBrowserPersistenceOwner({
    label: 'playback progress',
    flush,
    dispose: async () => {
      dismissNotice();
      unsubscribeTrack();
      unsubscribeSnapshot();
      unsubscribeSettings();
      window.removeEventListener('pagehide', handlePageHide);
    }
  });

  return controller;
}
