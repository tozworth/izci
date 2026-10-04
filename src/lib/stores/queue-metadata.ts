import { metadataSettings } from '$lib/stores/metadata-settings';
import { loadModuleMetadata } from '$lib/services/module-metadata';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import type { TrackItem, TrackMetadata } from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';
import { resolveTrackFile } from '$lib/services/file-access';
import { createMediaFileUrl } from '$lib/utils/native-media-files';

interface BackgroundDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface ScheduleMetadataParsingOptions {
  targetItems: TrackItem[];
  getItemList: () => TrackItem[];
  updateItems: (updater: (items: TrackItem[]) => TrackItem[]) => void;
  queuePersist: (complete: boolean) => void;
}

interface ResolvedMetadata {
  id: string;
  source: TrackItem;
  metadata: TrackMetadata;
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

function buildInitialMetadata(item: TrackItem): TrackMetadata | undefined {
  const metadata = mergeInferredArtistTitle(item.metadata, item.name, metadataSettings.getSnapshot().inferFromFilename);
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function shouldReadEmbeddedStreamMetadata(item: TrackItem): boolean {
  if (
    item.kind !== 'stream' ||
    (item.extension !== 'flac' && item.extension !== 'opus' && item.extension !== 'ogg' && item.extension !== 'mp3')
  ) {
    return false;
  }

  return item.metadata?.embeddedMetadataLoaded !== true;
}

function sameMetadataValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeWithNewerMetadata(
  source: TrackMetadata | undefined,
  parsed: TrackMetadata,
  current: TrackMetadata | undefined
): TrackMetadata {
  const merged = { ...parsed } as Record<string, unknown>;
  const sourceRecord = (source ?? {}) as Record<string, unknown>;
  const currentRecord = (current ?? {}) as Record<string, unknown>;

  for (const key of new Set([...Object.keys(sourceRecord), ...Object.keys(currentRecord)])) {
    if (sameMetadataValue(sourceRecord[key], currentRecord[key])) continue;

    if (currentRecord[key] === undefined) delete merged[key];
    else merged[key] = currentRecord[key];
  }

  return merged as TrackMetadata;
}

function hasSameContent(left: TrackItem, right: TrackItem): boolean {
  return (
    left.extension === right.extension &&
    left.kind === right.kind &&
    left.size === right.size &&
    left.lastModified === right.lastModified
  );
}

async function readStreamDuration(item: TrackItem): Promise<number | undefined> {
  if (typeof window === 'undefined' || item.kind !== 'stream') {
    return undefined;
  }

  const file = await resolveTrackFile(item).catch(() => null);

  const objectUrl = item.objectUrl ?? (file ? createMediaFileUrl(file) : undefined);

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

  const resolveMetadata = async (item: TrackItem): Promise<TrackMetadata | null> => {
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

  const resolveBatch = async (batch: TrackItem[]): Promise<ResolvedMetadata[]> => {
    const results: ResolvedMetadata[] = [];
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < batch.length) {
        const item = batch[nextIndex];
        nextIndex += 1;
        const metadata = await resolveMetadata(item);
        if (metadata) results.push({ id: item.id, source: item, metadata });
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
    const batch: TrackItem[] = [];

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
    void resolveBatch(batch)
      .then((updates) => {
        if (updates.length === 0) return;

        const updatesById = new Map(updates.map((update) => [update.id, update]));
        updateItems((existing) =>
          existing.map((item) => {
            const update = updatesById.get(item.id);
            if (!update || !hasSameContent(item, update.source)) return item;
            return {
              ...item,
              metadata: mergeWithNewerMetadata(
                update.source.metadata,
                update.metadata,
                item.metadata
              )
            };
          })
        );
        scheduledPersist = true;
        queuePersist(index >= targetItems.length);
      })
      .finally(() => {
        active = false;

        if (index < targetItems.length) {
          scheduleBackgroundTask(processChunk);
        } else if (scheduledPersist) {
          queuePersist(true);
        }
      });
  };

  scheduleBackgroundTask(processChunk);
}
