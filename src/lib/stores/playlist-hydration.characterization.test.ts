import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { PlaylistItem } from '$lib/types';
import type { StoredPlaylistState } from './playlist-persistence';

const persistenceHarness = vi.hoisted(() => ({
  readStoredState: vi.fn<(dbName: string) => Promise<StoredPlaylistState | null>>(
    async () => null
  ),
  persistStoredState: vi.fn(async () => {})
}));

vi.mock('./playlist-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./playlist-persistence')>(),
  readStoredState: persistenceHarness.readStoredState,
  persistStoredState: persistenceHarness.persistStoredState
}));

vi.mock('./playlist-metadata', () => ({
  scheduleMetadataParsing: vi.fn()
}));

vi.mock('$lib/services/logging', () => ({
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

function item(id: string): PlaylistItem {
  const name = `${id}.flac`;
  return {
    id,
    name,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    fileHandle: fileHandle(name),
    path: `Music/${name}`,
    metadata: { embeddedMetadataLoaded: true, duration: 1 }
  };
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
    store.select(queuedItem.id);
    expect(get(store.items)).toEqual([]);

    const storedItem = item('stored');
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
    expect(get(store.selection)).toEqual({
      ids: ['queued'],
      anchorId: 'queued',
      focusId: 'queued'
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledOnce();
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledWith(
      'test-hydration-queue',
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 'stored' }),
          expect.objectContaining({ id: 'queued', rating: 4.5 })
        ],
        selection: { ids: ['queued'], anchorId: 'queued', focusId: 'queued' }
      })
    );
  });
});
