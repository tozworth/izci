import type { MediaEntity } from '$lib/contracts/catalog';
import type { TrackMetadata } from '$lib/contracts/media-metadata';
import { logWarning } from '$lib/logging/api';
import {
  disposeCatalogMetadataInspection,
  inspectCatalogMetadata,
  type CatalogMetadataInspectionBatch
} from '$lib/services/catalog-metadata-inspection';
import { getMediaSourceRevision } from '$lib/services/media-inspection-pipeline';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { mergeInferredArtistTitle } from '$lib/utils/files';

interface ScheduleMetadataParsingOptions {
  targetItems: MediaEntity[];
  getItemList: () => MediaEntity[];
  updateItems: (updater: (items: MediaEntity[]) => MediaEntity[]) => void;
  queuePersist: (complete: boolean) => void;
}

function inferredMetadata(item: MediaEntity): TrackMetadata | undefined {
  const metadata = mergeInferredArtistTitle(
    item.metadata,
    item.name,
    metadataSettings.getSnapshot().inferFromFilename
  );
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function sameMetadata(left: TrackMetadata | undefined, right: TrackMetadata | undefined): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function updateCurrentMetadata(
  expected: MediaEntity,
  metadata: TrackMetadata | undefined,
  updateItems: ScheduleMetadataParsingOptions['updateItems']
): boolean {
  let changed = false;
  const expectedRevision = getMediaSourceRevision(expected);
  updateItems((items) => items.map((current) => {
    if (
      current.id !== expected.id
      || getMediaSourceRevision(current) !== expectedRevision
      || sameMetadata(current.metadata, metadata)
    ) {
      return current;
    }
    changed = true;
    return { ...current, metadata };
  }));
  return changed;
}

export function scheduleMetadataParsing({
  targetItems,
  getItemList,
  updateItems,
  queuePersist
}: ScheduleMetadataParsingOptions): CatalogMetadataInspectionBatch | null {
  if (targetItems.length === 0) return null;

  let changed = false;
  for (const target of targetItems) {
    changed = updateCurrentMetadata(target, inferredMetadata(target), updateItems) || changed;
  }
  if (changed) queuePersist(false);

  const batch = inspectCatalogMetadata(targetItems, {
    origin: 'import',
    onResult: (result) => {
      const current = getItemList().find((item) => item.id === result.entityId);
      if (!current || getMediaSourceRevision(current) !== result.sourceRevision) return;

      const metadata = mergeInferredArtistTitle(
        { ...current.metadata, ...result.value },
        current.name,
        metadataSettings.getSnapshot().inferFromFilename
      );
      if (updateCurrentMetadata(current, metadata, updateItems)) {
        changed = true;
        queuePersist(false);
      }
    },
    onError: (error, entity) => {
      logWarning('decode', 'Catalog metadata inspection failed', {
        id: entity.id,
        format: entity.format,
        error
      });
    }
  });
  void batch.settled.then(() => {
    if (changed) queuePersist(true);
  });
  return batch;
}

export function disposePlaylistMetadata(): Promise<void> {
  return disposeCatalogMetadataInspection();
}
