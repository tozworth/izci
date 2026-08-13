import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { StoredPlaylistState } from './playlist-persistence';
import { mediaSources } from '$lib/media/media-source';

const persistenceHarness = vi.hoisted(() => ({
  readStoredState: vi.fn<(dbName: string) => Promise<StoredPlaylistState | null>>(
    async () => null
  ),
  persistStoredState: vi.fn(async () => {})
}));
const sourceHarness = vi.hoisted(() => ({
  locators: new Map<string, FileSystemFileHandle>()
}));

vi.mock('./playlist-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./playlist-persistence')>(),
  readStoredState: persistenceHarness.readStoredState,
  persistStoredState: persistenceHarness.persistStoredState
}));

vi.mock('./playlist-metadata', () => ({
  scheduleMetadataParsing: vi.fn()
}));

vi.mock('$lib/media/media-source-persistence', () => ({
  readMediaSources: vi.fn(async (ids: string[]) => ids.map((entityId) => ({ entityId, fileHandle: sourceHarness.locators.get(entityId) ?? fileHandle(`${entityId}.flac`) }))),
  persistMediaSources: vi.fn(async () => undefined),
  deleteMediaSources: vi.fn(async () => undefined)
}));

vi.mock('$lib/logging/api', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

function fileHandle(name: string): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => new File([], name)
  } as FileSystemFileHandle;
}

function item(id: string): MediaEntity {
  const name = `${id}.flac`;
  const entity: MediaEntity = {
    id,
    name,
    format: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    path: `Music/${name}`,
    metadata: { embeddedMetadataLoaded: true, duration: 1 }
  };
  const handle = fileHandle(name);
  sourceHarness.locators.set(id, handle);
  mediaSources.registerHandle(id, handle, 'granted');
  return entity;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    },
    addEventListener: vi.fn()
  });
  persistenceHarness.readStoredState.mockReset().mockResolvedValue(null);
  persistenceHarness.persistStoredState.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('track collection hydration characterization', () => {
  it('replays queued mutations after stored state and persists their combined result', async () => {
    let resolveHydration!: (state: StoredPlaylistState) => void;
    const hydration = new Promise<StoredPlaylistState>((resolve) => {
      resolveHydration = resolve;
    });
    persistenceHarness.readStoredState.mockImplementation((dbName) =>
      dbName === 'test-hydration-queue' ? hydration : Promise.resolve(null)
    );

    const { createTrackCollectionStore } = await import('./playlist');
    const store = createTrackCollectionStore({ dbName: 'test-hydration-queue', dedupe: true });
    const queuedItem = item('queued');

    expect(store.add([queuedItem])).toEqual([]);
    store.updateRating(queuedItem.id, 4.5);
    store.updateMetadata('stored', { title: 'Queued title' });
    store.select(queuedItem.id);
    store.toggleShuffle();
    store.cycleRepeatMode();
    expect(get(store.items)).toEqual([]);

    const storedItem = {
      ...item('stored'),
      metadata: { artist: 'Stored artist', playCount: 8 }
    };
    resolveHydration({
      items: [storedItem],
      selection: { ids: ['stored'], anchorId: 'stored', focusId: 'stored' },
      playbackOptions: { shuffle: false, repeatMode: 'off' }
    });
    await store.ready();

    expect(get(store.items).map(({ id, rating }) => ({ id, rating }))).toEqual([
      { id: 'stored', rating: undefined },
      { id: 'queued', rating: 4.5 }
    ]);
    expect(get(store.items)[0]?.metadata).toEqual({
      artist: 'Stored artist',
      playCount: 8,
      title: 'Queued title'
    });
    expect(get(store.selection)).toEqual({
      ids: ['queued'],
      anchorId: 'queued',
      focusId: 'queued'
    });
    expect(get(store.shuffleEnabled)).toBe(true);
    expect(get(store.repeatMode)).toBe('all');

    await vi.advanceTimersByTimeAsync(400);
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledOnce();
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledWith(
      'test-hydration-queue',
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'stored' }),
          expect.objectContaining({ id: 'queued', rating: 4.5 })
        ],
        selection: { ids: ['queued'], anchorId: 'queued', focusId: 'queued' },
        playbackOptions: { shuffle: true, repeatMode: 'all' }
      })
    );
  });

  it('does not acknowledge a folder CAS until catalog and source persistence settles', async () => {
    const { createTrackCollectionStore } = await import('./playlist');
    const store = createTrackCollectionStore({ dbName: 'test-folder-cas-flush', dedupe: true });
    await store.ready();
    const planned = item('planned');
    let releasePersist!: () => void;
    const persistSettled = new Promise<void>((resolve) => { releasePersist = resolve; });
    persistenceHarness.persistStoredState.mockImplementationOnce(async () => persistSettled);
    const snapshot = store.getCatalogSnapshot();
    let acknowledged = false;

    const applying = store.applyCatalogIfRevision(snapshot.catalogRevision, {
      nextCatalog: [planned],
      addedItems: [planned],
      updatedItems: [],
      removedItems: [],
      sourceRegistrations: [{
        entityId: planned.id,
        fileHandle: sourceHarness.locators.get(planned.id)!,
        permission: 'granted'
      }],
      sourceDeletions: [],
      duplicates: []
    }).then((result) => {
      acknowledged = true;
      return result;
    });
    await vi.waitFor(() => expect(persistenceHarness.persistStoredState).toHaveBeenCalledOnce());
    expect(acknowledged).toBe(false);

    releasePersist();
    await expect(applying).resolves.toEqual({ status: 'applied' });
    expect(acknowledged).toBe(true);
  });
});
