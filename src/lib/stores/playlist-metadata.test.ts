import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import { getMediaSourceRevision } from '$lib/services/media-inspection-pipeline';

const harness = vi.hoisted(() => ({
  inspect: vi.fn(),
  dispose: vi.fn(),
  infer: true
}));

vi.mock('$lib/services/catalog-metadata-inspection', () => ({
  inspectCatalogMetadata: harness.inspect,
  disposeCatalogMetadataInspection: harness.dispose
}));

vi.mock('$lib/stores/metadata-settings', () => ({
  metadataSettings: { getSnapshot: () => ({ inferFromFilename: harness.infer }) }
}));

import { disposePlaylistMetadata, scheduleMetadataParsing } from './playlist-metadata';

function entity(overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id: 'track-1',
    path: 'Artist - Title.flac',
    name: 'Artist - Title.flac',
    format: 'flac',
    kind: 'stream',
    size: 10,
    lastModified: 20,
    ...overrides
  };
}

describe('playlist metadata orchestration', () => {
  beforeEach(() => {
    harness.inspect.mockReset();
    harness.dispose.mockReset().mockResolvedValue(undefined);
    harness.infer = true;
  });

  it('applies inference and current-source inspection results', async () => {
    let items = [entity()];
    const queuePersist = vi.fn();
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    harness.inspect.mockImplementation((_entities, options) => {
      void Promise.resolve(options.onResult({
        kind: 'catalog-metadata',
        entityId: 'track-1',
        generationId: 'generation',
        sourceRevision: getMediaSourceRevision(items[0]),
        value: { album: 'Album', duration: 42 }
      })).then(resolveSettled);
      return { generationId: 'generation', settled, cancel: () => true };
    });

    const batch = scheduleMetadataParsing({
      targetItems: items,
      getItemList: () => items,
      updateItems: (updater) => { items = updater(items); },
      queuePersist
    });
    await batch?.settled;
    await Promise.resolve();

    expect(items[0].metadata).toMatchObject({
      artist: 'Artist',
      title: 'Title',
      album: 'Album',
      duration: 42
    });
    expect(queuePersist).toHaveBeenCalledWith(false);
    expect(queuePersist).toHaveBeenLastCalledWith(true);
  });

  it('rejects stale results after the source revision changes', async () => {
    const original = entity();
    let items = [original];
    const queuePersist = vi.fn();
    let onResult!: (result: unknown) => Promise<void> | void;
    harness.inspect.mockImplementation((_entities, options) => {
      onResult = options.onResult;
      return { generationId: 'generation', settled: Promise.resolve(), cancel: () => true };
    });
    scheduleMetadataParsing({
      targetItems: items,
      getItemList: () => items,
      updateItems: (updater) => { items = updater(items); },
      queuePersist
    });
    items = [{ ...items[0], size: 999, metadata: { title: 'New source' } }];

    await onResult({
      kind: 'catalog-metadata',
      entityId: 'track-1',
      generationId: 'generation',
      sourceRevision: getMediaSourceRevision(original),
      value: { title: 'Stale source' }
    });

    expect(items[0].metadata?.title).toBe('New source');
  });

  it('disposes the shared inspection owner explicitly', async () => {
    await disposePlaylistMetadata();
    expect(harness.dispose).toHaveBeenCalledOnce();
  });
});
