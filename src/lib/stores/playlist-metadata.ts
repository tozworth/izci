import { metadataSettings } from '$lib/stores/metadata-settings';
import { loadModuleMetadata } from '$lib/services/module-metadata';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import type { PlaylistItem, TrackMetadata } from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';

interface BackgroundDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface ScheduleMetadataParsingOptions {
  targetItems: PlaylistItem[];
  getItemList: () => PlaylistItem[];
  updateItems: (updater: (items: PlaylistItem[]) => PlaylistItem[]) => void;
  queuePersist: () => void;
}

const METADATA_IO_TIMEOUT_MS = 15_000;
const MEDIA_DURATION_TIMEOUT_MS = 10_000;

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

  const processChunk = (deadline: BackgroundDeadline) => {
    if (active) {
      return;
    }

    const updates: Array<{ id: string; metadata: TrackMetadata }> = [];
    let pendingEmbeddedMetadataItem: PlaylistItem | null = null;
    let pendingDurationItem: PlaylistItem | null = null;
    let pendingModuleMetadataItem: PlaylistItem | null = null;

    while (index < targetItems.length && (deadline.didTimeout || deadline.timeRemaining() > 2)) {
      const item = targetItems[index];
      index += 1;

      const currentItem = getItemList().find((entry) => entry.id === item.id);

      if (!currentItem) {
        continue;
      }

      const metadata = buildInitialMetadata(item);
      const mergedMetadata = metadata ? { ...currentItem.metadata, ...metadata } : currentItem.metadata;

      if (metadata && JSON.stringify(currentItem.metadata ?? {}) !== JSON.stringify(mergedMetadata ?? {})) {
        updates.push({ id: item.id, metadata: mergedMetadata ?? {} });
      }

      if (shouldReadEmbeddedStreamMetadata(currentItem)) {
        pendingEmbeddedMetadataItem = currentItem;
        break;
      }

      if ((currentItem.metadata?.duration ?? 0) <= 0) {
        if (currentItem.kind === 'stream') {
          pendingDurationItem = currentItem;
          break;
        }

        if (currentItem.kind === 'module') {
          pendingModuleMetadataItem = currentItem;
          break;
        }
      }
    }

    if (updates.length > 0) {
      const updatesById = new Map(updates.map((update) => [update.id, update.metadata]));

      updateItems((existing) =>
        existing.map((item) => {
          const metadata = updatesById.get(item.id);
          return metadata
            ? {
                ...item,
                metadata
              }
            : item;
        })
      );
      queuePersist();
    }

    if (pendingEmbeddedMetadataItem) {
      active = true;

      void settleMetadataTask(loadTrackMetadata(pendingEmbeddedMetadataItem))
        .then(async (metadata) => {
          const itemId = pendingEmbeddedMetadataItem?.id;

          if (!itemId) {
            return;
          }

          const currentItem = getItemList().find((entry) => entry.id === itemId);

          if (!currentItem) {
            return;
          }

          if (metadata) {
            const mergedMetadata = mergeInferredArtistTitle(
              {
                ...currentItem.metadata,
                ...metadata
              },
              currentItem.name,
              metadataSettings.getSnapshot().inferFromFilename
            );

            if (JSON.stringify(currentItem.metadata ?? {}) !== JSON.stringify(mergedMetadata ?? {})) {
              updateItems((existing) =>
                existing.map((item) =>
                  item.id === itemId
                    ? {
                        ...item,
                        metadata: mergedMetadata
                      }
                    : item
                )
              );
              queuePersist();
            }
          }

          const refreshedItem = getItemList().find((entry) => entry.id === itemId);

          if (!refreshedItem || refreshedItem.kind !== 'stream' || (refreshedItem.metadata?.duration ?? 0) > 0) {
            return;
          }

          const duration = await settleMetadataTask(readStreamDuration(refreshedItem));

          if (!duration || duration <= 0) {
            return;
          }

          const latestItem = getItemList().find((entry) => entry.id === itemId);

          if (!latestItem) {
            return;
          }

          updateItems((existing) =>
            existing.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    metadata: {
                      ...latestItem.metadata,
                      duration
                    }
                  }
                : item
            )
          );
          queuePersist();
        })
        .finally(() => {
          active = false;

          if (index < targetItems.length) {
            scheduleBackgroundTask(processChunk);
          }
        });

      return;
    }

    if (pendingModuleMetadataItem) {
      active = true;

      void settleMetadataTask(loadModuleMetadata(pendingModuleMetadataItem))
        .then((metadata) => {
          if (!metadata) {
            return;
          }

          const currentItem = getItemList().find((entry) => entry.id === pendingModuleMetadataItem?.id);

          if (!currentItem) {
            return;
          }

          const mergedMetadata = mergeInferredArtistTitle(
            {
              ...currentItem.metadata,
              ...metadata
            },
            currentItem.name,
            metadataSettings.getSnapshot().inferFromFilename
          );

          if (JSON.stringify(currentItem.metadata ?? {}) === JSON.stringify(mergedMetadata ?? {})) {
            return;
          }

          updateItems((existing) =>
            existing.map((item) =>
              item.id === pendingModuleMetadataItem?.id
                ? {
                    ...item,
                    metadata: mergedMetadata
                  }
                : item
            )
          );
          queuePersist();
        })
        .finally(() => {
          active = false;

          if (index < targetItems.length) {
            scheduleBackgroundTask(processChunk);
          }
        });

      return;
    }

    if (pendingDurationItem) {
      active = true;

      void settleMetadataTask(readStreamDuration(pendingDurationItem))
        .then((duration) => {
          if (!duration || duration <= 0) {
            return;
          }

          const currentItem = getItemList().find((entry) => entry.id === pendingDurationItem?.id);

          if (!currentItem) {
            return;
          }

          updateItems((existing) =>
            existing.map((item) =>
              item.id === pendingDurationItem?.id
                ? {
                    ...item,
                    metadata: {
                      ...currentItem.metadata,
                      duration
                    }
                  }
                : item
            )
          );
          queuePersist();
        })
        .finally(() => {
          active = false;

          if (index < targetItems.length) {
            scheduleBackgroundTask(processChunk);
          }
        });

      return;
    }

    if (index < targetItems.length) {
      scheduleBackgroundTask(processChunk);
    }
  };

  scheduleBackgroundTask(processChunk);
}
