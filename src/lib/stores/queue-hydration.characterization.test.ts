import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { TrackItem } from '$lib/types';
import type { StoredQueueState } from './queue-persistence';

const persistenceHarness = vi.hoisted(() => ({
  readStoredState: vi.fn<(dbName: string) => Promise<StoredQueueState | null>>(
    async () => null
  ),
  persistStoredState: vi.fn(async () => {})
}));

vi.mock('./queue-persistence', async (importOriginal) => ({
  ...await importOriginal<typeof import('./queue-persistence')>(),
  readStoredState: persistenceHarness.readStoredState,
  persistStoredState: persistenceHarness.persistStoredState
}));

vi.mock('./queue-metadata', () => ({
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

function item(id: string): TrackItem {
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
  it('keeps images out of restored and mutated playback queues while libraries retain them', async () => {
    const image: TrackItem = { ...item('photo'), name: 'photo.png', extension: 'png', kind: 'image', fileHandle: fileHandle('photo.png') };
    persistenceHarness.readStoredState.mockResolvedValue({
      items: [item('song'), image], selection: { ids: ['photo'], anchorId: 'photo', focusId: 'photo' },
      playbackOptions: { shuffle: false, repeatMode: 'off' }
    });
    const { createTrackCollectionStore } = await import('./queue');
    const queue = createTrackCollectionStore({ dbName: 'test-image-free-queue', dedupe: false, acceptItem: (entry) => entry.kind !== 'image' });
    const library = createTrackCollectionStore({ dbName: 'test-image-library', dedupe: true });
    await Promise.all([queue.ready(), library.ready()]);
    expect(get(queue.items).map((entry) => entry.id)).toEqual(['song']);
    expect(get(queue.selectedIds)).toEqual([]);
    expect(get(library.items).map((entry) => entry.id)).toEqual(['song', 'photo']);
    expect(queue.add([image])).toEqual([]);
    expect(queue.replaceAll([image])).toEqual({ addedItems: [], removedItems: [] });
    expect(queue.replaceItem('song', [image])).toBe(false);
    queue.reconcileFolder('photos', [image]);
    expect(get(queue.items).map((entry) => entry.id)).toEqual(['song']);
  });

  it('replays queued mutations after stored state and persists their combined result', async () => {
    let resolveHydration!: (state: StoredQueueState) => void;
    const hydration = new Promise<StoredQueueState>((resolve) => {
      resolveHydration = resolve;
    });
    persistenceHarness.readStoredState.mockImplementation((dbName) =>
      dbName === 'test-hydration-queue' ? hydration : Promise.resolve(null)
    );

    const { createTrackCollectionStore } = await import('./queue');
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

  it('retries a failed persistence write without requiring another mutation', async () => {
    persistenceHarness.persistStoredState
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValue(undefined);
    const { createTrackCollectionStore } = await import('./queue');
    const store = createTrackCollectionStore({ dbName: 'test-persistence-retry', dedupe: true });
    await store.ready();

    store.add([item('retry')]);
    await vi.advanceTimersByTimeAsync(400);
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(persistenceHarness.persistStoredState).toHaveBeenCalledTimes(2);
    expect(persistenceHarness.persistStoredState).toHaveBeenLastCalledWith(
      'test-persistence-retry',
      expect.objectContaining({ items: [expect.objectContaining({ id: 'retry' })] })
    );
  });
});
