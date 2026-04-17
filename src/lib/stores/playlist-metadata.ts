import { metadataSettings } from '$lib/stores/metadata-settings';
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
  if (item.kind !== 'stream' || (item.extension !== 'flac' && item.extension !== 'opus')) {
    return false;
  }

  const title = item.metadata?.title?.trim();
  const artist = item.metadata?.artist?.trim();
  const album = item.metadata?.album?.trim();

  return !title || !artist || !album;
}

async function readStreamDuration(item: PlaylistItem): Promise<number | undefined> {
  if (typeof window === 'undefined' || item.kind !== 'stream' || !item.objectUrl) {
    return undefined;
  }

  const objectUrl = item.objectUrl;

  return await new Promise((resolve) => {
    const audio = new Audio();

    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
      audio.src = '';
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
        pendingEmbeddedMetadataItem = item;
        break;
      }

      if (item.kind === 'stream' && item.objectUrl && (currentItem.metadata?.duration ?? 0) <= 0) {
        pendingDurationItem = item;
        break;
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

      void loadTrackMetadata(pendingEmbeddedMetadataItem)
        .then((metadata) => {
          if (!metadata) {
            return;
          }

          const currentItem = getItemList().find((entry) => entry.id === pendingEmbeddedMetadataItem?.id);

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
              item.id === pendingEmbeddedMetadataItem?.id
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

      void readStreamDuration(pendingDurationItem)
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
