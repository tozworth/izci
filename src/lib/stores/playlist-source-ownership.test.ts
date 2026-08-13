import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';

const persistence = vi.hoisted(() => ({
  states: new Map<string, unknown>(),
  sources: new Map<string, FileSystemFileHandle>()
}));

vi.mock('./playlist-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./playlist-persistence')>(),
  readStoredState: vi.fn(async (dbName: string) => persistence.states.get(dbName) ?? null),
  persistStoredState: vi.fn(async (dbName: string, state: unknown) => {
    persistence.states.set(dbName, state);
  })
}));

vi.mock('$lib/collections/catalog-metadata', () => ({
  scheduleMetadataParsing: vi.fn()
}));

vi.mock('$lib/media/media-source-persistence', () => ({
  readMediaSources: vi.fn(async (ids: string[]) => ids.flatMap((entityId) => {
    const fileHandle = persistence.sources.get(entityId);
    return fileHandle ? [{ entityId, fileHandle }] : [];
  })),
  persistMediaSources: vi.fn(async (sources: Array<{ entityId: string; fileHandle: FileSystemFileHandle }>) => {
    for (const source of sources) persistence.sources.set(source.entityId, source.fileHandle);
  }),
  deleteMediaSources: vi.fn(async (ids: string[]) => {
    for (const id of ids) persistence.sources.delete(id);
  })
}));

vi.mock('$lib/logging/api', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

import { mediaSources } from '$lib/media/media-source';
import { createTrackCollectionStore } from './playlist';

function fileHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => new File([], name)
  } as FileSystemFileHandle;
}

function item(id: string): MediaEntity {
  return {
    id,
    path: `Music/${id}.flac`,
    name: `${id}.flac`,
    format: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 2,
    metadata: { embeddedMetadataLoaded: true }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mediaSources.clear();
  persistence.states.clear();
  persistence.sources.clear();
});

describe('track collection media-source ownership', () => {
  it('keeps a shared entity locator until the last collection removes it', async () => {
    const playlist = createTrackCollectionStore({ dbName: 'source-owner-playlist', dedupe: false });
    const library = createTrackCollectionStore({ dbName: 'source-owner-library', dedupe: true });
    const shared = item('shared');
    const handle = fileHandle(shared.name);
    mediaSources.registerHandle(shared.id, handle, 'granted');

    playlist.add([shared]);
    library.add([shared]);
    expect(mediaSources.referenceCount(shared.id)).toBe(2);

    playlist.remove([shared.id]);
    expect(mediaSources.get(shared.id)).toMatchObject({ fileHandle: handle });
    expect(mediaSources.referenceCount(shared.id)).toBe(1);

    library.remove([shared.id]);
    expect(mediaSources.get(shared.id)).toBeNull();
    await Promise.all([playlist.shutdown(), library.shutdown()]);
  });

  it('counts duplicate playlist membership and releases every occurrence together', async () => {
    const playlist = createTrackCollectionStore({ dbName: 'source-owner-duplicates', dedupe: false });
    const shared = item('duplicate-id');
    mediaSources.registerHandle(shared.id, fileHandle(shared.name), 'granted');

    playlist.add([shared, shared]);
    expect(mediaSources.referenceCount(shared.id)).toBe(2);

    playlist.remove([shared.id]);
    expect(mediaSources.get(shared.id)).toBeNull();
    await playlist.shutdown();
  });

  it('releases runtime ownership on shutdown and reacquires it after persisted reload', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
      addEventListener: vi.fn()
    });
    const dbName = 'source-owner-reload';
    const original = createTrackCollectionStore({ dbName, dedupe: true });
    await original.ready();
    const persisted = item('persisted');
    const handle = fileHandle(persisted.name);
    mediaSources.registerHandle(persisted.id, handle, 'granted');
    original.add([persisted]);

    await original.shutdown();
    expect(mediaSources.get(persisted.id)).toBeNull();
    expect(persistence.sources.get(persisted.id)).toBe(handle);

    const reloaded = createTrackCollectionStore({ dbName, dedupe: true });
    await reloaded.ready();
    expect(reloaded.getCatalogSnapshot().entities).toEqual([persisted]);
    expect(mediaSources.get(persisted.id)).toMatchObject({ fileHandle: handle });
    expect(mediaSources.referenceCount(persisted.id)).toBe(1);

    await reloaded.shutdown();
    expect(mediaSources.get(persisted.id)).toBeNull();
  });

  it('persists and reloads a locator cloned onto a backup-created favorite ID', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
      addEventListener: vi.fn()
    });
    const library = createTrackCollectionStore({ dbName: 'backup-source-library', dedupe: true });
    const favorites = createTrackCollectionStore({ dbName: 'backup-source-favorites', dedupe: true });
    await Promise.all([library.ready(), favorites.ready()]);
    const source = item('backup-library-id');
    const favorite = { ...source, id: 'backup-favorite-id' };
    const handle = fileHandle(source.name);
    mediaSources.registerHandle(source.id, handle, 'granted');
    library.add([source]);
    expect(mediaSources.clone(source.id, favorite.id)).toBe(true);
    favorites.add([favorite]);

    await favorites.shutdown();
    expect(persistence.sources.get(favorite.id)).toBe(handle);
    expect(mediaSources.get(favorite.id)).toBeNull();

    const reloadedFavorites = createTrackCollectionStore({
      dbName: 'backup-source-favorites',
      dedupe: true
    });
    await reloadedFavorites.ready();
    expect(reloadedFavorites.getCatalogSnapshot().entities).toEqual([favorite]);
    expect(mediaSources.get(favorite.id)).toMatchObject({ fileHandle: handle });
    expect(mediaSources.referenceCount(favorite.id)).toBe(1);

    await Promise.all([library.shutdown(), reloadedFavorites.shutdown()]);
  });
});
