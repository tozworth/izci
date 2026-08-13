import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { MediaInspectionResult } from './media-inspection-pipeline';
import {
  CatalogMetadataInspectionOwner,
  createCatalogMetadataHandler,
  createMediaInspectionHandlers
} from './catalog-metadata-inspection';

function entity(overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id: 'track-1',
    path: 'Music/Track.flac',
    name: 'Track.flac',
    format: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 10,
    ...overrides
  };
}

describe('catalog metadata inspection', () => {
  it('installs real leased-file handlers for every accepted inspection kind', async () => {
    const file = new File(['media'], 'Track.flac');
    const signal = new AbortController().signal;
    const readArtwork = vi.fn().mockResolvedValue({ blob: file });
    const readLyrics = vi.fn().mockResolvedValue({ raw: 'lyrics', lines: [], source: 'vorbis-comments' });
    const readDocument = vi.fn().mockResolvedValue({ extension: 'flac' });
    const handlers = createMediaInspectionHandlers({
      readStream: vi.fn().mockResolvedValue(null),
      readModule: vi.fn().mockResolvedValue(null),
      readDuration: vi.fn().mockResolvedValue(undefined),
      readArtwork,
      readLyrics,
      readDocument
    });
    const context = { entity: entity(), file, signal, generationId: 'g', origin: 'tool' as const };

    await expect(handlers['embedded-artwork'](context)).resolves.toEqual({ blob: file });
    await expect(handlers['embedded-lyrics'](context)).resolves.toMatchObject({ raw: 'lyrics' });
    await expect(handlers['metadata-document'](context)).resolves.toMatchObject({ extension: 'flac' });
    expect(readArtwork).toHaveBeenCalledWith(file, 'flac', signal);
    expect(readLyrics).toHaveBeenCalledWith(file, 'flac', signal);
    expect(readDocument).toHaveBeenCalledWith(file, 'flac', signal);
  });

  it('uses the supplied leased file and fills only a missing stream duration', async () => {
    const file = new File(['audio'], 'Track.flac');
    const readStream = vi.fn().mockResolvedValue({ title: 'Track' });
    const readDuration = vi.fn().mockResolvedValue(123);
    const handler = createCatalogMetadataHandler({
      readStream,
      readModule: vi.fn(),
      readDuration
    });

    await expect(handler({
      entity: entity(),
      file,
      signal: new AbortController().signal,
      generationId: 'generation',
      origin: 'import'
    })).resolves.toEqual({ title: 'Track', duration: 123 });
    expect(readStream).toHaveBeenCalledWith(file, 'flac', expect.any(AbortSignal));
    expect(readDuration).toHaveBeenCalledOnce();

    readStream.mockResolvedValueOnce({ duration: 42 });
    await handler({
      entity: entity(),
      file,
      signal: new AbortController().signal,
      generationId: 'generation',
      origin: 'import'
    });
    expect(readDuration).toHaveBeenCalledOnce();
  });

  it('routes module work through the cancellable module reader', async () => {
    const file = new File(['module'], 'Track.mod');
    const readModule = vi.fn().mockResolvedValue({ trackerType: 'ProTracker' });
    const handler = createCatalogMetadataHandler({
      readStream: vi.fn(),
      readModule,
      readDuration: vi.fn()
    });
    const moduleEntity = entity({ kind: 'module', format: 'mod', name: 'Track.mod' });
    const signal = new AbortController().signal;

    await expect(handler({
      entity: moduleEntity,
      file,
      signal,
      generationId: 'generation',
      origin: 'folder-scan'
    })).resolves.toEqual({ trackerType: 'ProTracker' });
    expect(readModule).toHaveBeenCalledWith(moduleEntity, file, signal);
  });

  it('owns batch cancellation, generations, and idempotent disposal', async () => {
    const controllers: AbortController[] = [];
    const pending: Array<{
      entity: MediaEntity;
      resolve: (result: MediaInspectionResult<'catalog-metadata'>) => void;
      reject: (error: unknown) => void;
    }> = [];
    const pipeline = {
      inspect: vi.fn((request: { entity: MediaEntity; generationId: string }) => ({
        result: new Promise<MediaInspectionResult<'catalog-metadata'>>((resolve, reject) => {
          pending.push({ entity: request.entity, resolve, reject });
        }),
        cancel: () => false
      })),
      dispose: vi.fn().mockResolvedValue(undefined)
    };
    const owner = new CatalogMetadataInspectionOwner(
      pipeline,
      { create: () => 'generation-1' },
      { create: () => {
        const controller = new AbortController();
        controllers.push(controller);
        return controller;
      } }
    );
    const onResult = vi.fn();
    const batch = owner.inspect([entity()], { origin: 'hydration', onResult });

    expect(batch.generationId).toBe('generation-1');
    expect(batch.cancel()).toBe(true);
    expect(batch.cancel()).toBe(false);
    expect(controllers[0].signal.aborted).toBe(true);

    pending[0].resolve({
      kind: 'catalog-metadata',
      entityId: 'track-1',
      generationId: 'generation-1',
      sourceRevision: 'revision',
      value: { title: 'Late result' }
    });
    await batch.settled;
    expect(onResult).not.toHaveBeenCalled();

    const firstDispose = owner.dispose();
    const secondDispose = owner.dispose();
    expect(secondDispose).toBe(firstDispose);
    await firstDispose;
    expect(pipeline.dispose).toHaveBeenCalledOnce();
  });
});
