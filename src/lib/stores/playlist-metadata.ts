import { metadataSettings } from '$lib/stores/metadata-settings';
import { loadModuleMetadata } from '$lib/services/module-metadata';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import type { PlaylistItem, TrackMetadata } from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/services/logging';

interface BackgroundDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface ScheduleMetadataParsingOptions {
  targetItems: PlaylistItem[];
  getItemList: () => PlaylistItem[];
  updateItems: (updater: (items: PlaylistItem[]) => PlaylistItem[]) => void;
  queuePersist: (complete: boolean) => void;
}

const METADATA_IO_TIMEOUT_MS = 15_000;
const MEDIA_DURATION_TIMEOUT_MS = 10_000;
const METADATA_BATCH_SIZE = 64;
const METADATA_READ_CONCURRENCY = 2;

async function settleMetadataTask<T>(task: Promise<T>): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      task.catch(() => null),
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), METADATA_IO_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function scheduleBackgroundTask(callback: (deadline: BackgroundDeadline) => void): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 100 });
    return;
  }

  setTimeout(() => {
    callback({
      didTimeout: true,
      timeRemaining: () => 0
    });
  }, 0);
}

function buildInitialMetadata(item: PlaylistItem): TrackMetadata | undefined {
  const metadata = mergeInferredArtistTitle(item.metadata, item.name, metadataSettings.getSnapshot().inferFromFilename);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function shouldReadEmbeddedStreamMetadata(item: PlaylistItem): boolean {
  if (
    item.kind !== 'stream' ||
    (item.extension !== 'flac' && item.extension !== 'opus' && item.extension !== 'ogg' && item.extension !== 'mp3')
  ) {
    return false;
  }

  return item.metadata?.embeddedMetadataLoaded !== true;
}

async function readStreamDuration(item: PlaylistItem): Promise<number | undefined> {
  if (typeof window === 'undefined' || item.kind !== 'stream') {
    return undefined;
  }

  let file: File | null = item.file ?? null;

  if (!file && item.fileHandle) {
    try {
      file = await item.fileHandle.getFile();
    } catch {
      file = null;
    }
  }

  const objectUrl = item.objectUrl ?? (file ? URL.createObjectURL(file) : undefined);

  if (!objectUrl) {
    return undefined;
  }

  const shouldRevokeObjectUrl = !item.objectUrl;

  return await new Promise((resolve) => {
    const audio = new Audio();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
      if (shouldRevokeObjectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const handleLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : undefined;
      cleanup();
      resolve(duration);
    };

    const handleError = () => {
      cleanup();
      resolve(undefined);
    };

    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    timeoutId = setTimeout(handleError, MEDIA_DURATION_TIMEOUT_MS);
    audio.src = objectUrl;
  });
}

export function scheduleMetadataParsing({
  targetItems,
  getItemList,
  updateItems,
  queuePersist
}: ScheduleMetadataParsingOptions): void {
  if (targetItems.length === 0) {
    return;
  }

  let index = 0;
  let active = false;
  let scheduledPersist = false;
  let batchFailureCount = 0;

  const resolveMetadata = async (item: PlaylistItem): Promise<TrackMetadata | null> => {
    let metadata = buildInitialMetadata(item) ?? item.metadata ?? {};

    if (shouldReadEmbeddedStreamMetadata(item)) {
      const embeddedMetadata = await settleMetadataTask(loadTrackMetadata(item));
      if (embeddedMetadata) {
        metadata = mergeInferredArtistTitle(
          { ...metadata, ...embeddedMetadata },
          item.name,
          metadataSettings.getSnapshot().inferFromFilename
        );
      }
    }

    if ((metadata.duration ?? 0) <= 0) {
      if (item.kind === 'stream') {
        const duration = await settleMetadataTask(readStreamDuration(item));
        if (duration && duration > 0) metadata = { ...metadata, duration };
      } else if (item.kind === 'module') {
        const moduleMetadata = await settleMetadataTask(loadModuleMetadata(item));
        if (moduleMetadata) {
          metadata = mergeInferredArtistTitle(
            { ...metadata, ...moduleMetadata },
            item.name,
            metadataSettings.getSnapshot().inferFromFilename
          );
        }
      }
    }

    return JSON.stringify(item.metadata ?? {}) === JSON.stringify(metadata) ? null : metadata;
  };

  const resolveBatch = async (batch: PlaylistItem[]): Promise<Array<{ id: string; metadata: TrackMetadata }>> => {
    const results: Array<{ id: string; metadata: TrackMetadata }> = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < batch.length) {
        const item = batch[nextIndex];
        nextIndex += 1;

        try {
          const metadata = await resolveMetadata(item);

          if (metadata) {
            logDebug('library', 'metadata parsed for item', {
              id: item.id,
              discoveredFields: Object.keys(metadata).sort()
            });
            results.push({ id: item.id, metadata });
          }
        } catch (error) {
          batchFailureCount += 1;
          logDebug('library', 'metadata parsing failed for item', {
            id: item.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(METADATA_READ_CONCURRENCY, batch.length) }, () => worker())
    );
    return results;
  };

  const processChunk = (_deadline: BackgroundDeadline) => {
    if (active) return;

    const currentById = new Map(getItemList().map((item) => [item.id, item]));
    const batch: PlaylistItem[] = [];

    while (index < targetItems.length && batch.length < METADATA_BATCH_SIZE) {
      const currentItem = currentById.get(targetItems[index].id);
      index += 1;
      if (currentItem) batch.push(currentItem);
    }

    if (batch.length === 0) {
      if (index < targetItems.length) scheduleBackgroundTask(processChunk);
      return;
    }

    active = true;
    batchFailureCount = 0;
    logDebug('library', 'metadata parsing batch started', { items: batch.length });
    void resolveBatch(batch)
      .then((updates) => {
        if (updates.length === 0) return;

        const updatesById = new Map(updates.map((update) => [update.id, update.metadata]));
        updateItems((existing) =>
          existing.map((item) => {
            const metadata = updatesById.get(item.id);
            return metadata ? { ...item, metadata } : item;
          })
        );
        scheduledPersist = true;
        queuePersist(index >= targetItems.length);
      })
      .finally(() => {
        active = false;

        if (batchFailureCount > 0) {
          logWarning('library', 'metadata parsing batch finished with failures', {
            items: batch.length,
            failures: batchFailureCount
          });
        } else {
          logDebug('library', 'metadata parsing batch completed', { items: batch.length });
        }

        if (index < targetItems.length) {
          scheduleBackgroundTask(processChunk);
        } else if (scheduledPersist) {
          queuePersist(true);
        }
      });
  };

  scheduleBackgroundTask(processChunk);
}
