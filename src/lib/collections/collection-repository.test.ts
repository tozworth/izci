import { describe, expect, it, vi } from 'vitest';
import type { PlaylistPlaybackOptions } from '$lib/contracts/catalog';
import {
  CollectionRepository,
  type CollectionRecord,
  type CollectionScheduler,
  type CollectionStorage
} from './collection-repository';

interface Entity { id: string; path: string }
const playbackOptions: PlaylistPlaybackOptions = { shuffle: false, repeatMode: 'off' };

class FakeScheduler implements CollectionScheduler {
  callback: (() => void) | null = null;
  setTimeout(callback: () => void): unknown { this.callback = callback; return callback; }
  clearTimeout(handle: unknown): void { if (this.callback === handle) this.callback = null; }
  fire(): void { const callback = this.callback; this.callback = null; callback?.(); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(storage: CollectionStorage<Entity>, scheduler = new FakeScheduler()) {
  return {
    scheduler,
    repository: new CollectionRepository({
      storage,
      scheduler,
      defaultPlaybackOptions: playbackOptions,
      policy: { dedupe: true, identity: (entity) => entity.path.toLowerCase() }
    })
  };
}

describe('collection repository lifecycle', () => {
  it('queues typed commands during hydration and applies them after durable state', async () => {
    const loading = deferred<{ record: CollectionRecord<Entity> } | null>();
    const storage: CollectionStorage<Entity> = { load: () => loading.promise, save: vi.fn() };
    const owner = repository(storage);
    const hydrate = owner.repository.hydrate();
    const addition = owner.repository.dispatch({
      type: 'add', entities: [{ id: 'new', path: 'new.flac' }]
    });
    loading.resolve({
      record: {
        entities: [{ id: 'stored', path: 'stored.flac' }],
        selection: { ids: ['stored'], anchorId: 'stored', focusId: 'stored' },
        playbackOptions
      }
    });

    await hydrate;
    await addition;
    expect(owner.repository.getSnapshot().entities.map((entity) => entity.id)).toEqual(['stored', 'new']);
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'ready', dirty: true });
  });

  it('keeps load failures observable instead of publishing an authoritative empty history', async () => {
    const failure = new Error('database unavailable');
    const owner = repository({ load: () => Promise.reject(failure), save: vi.fn() });
    await owner.repository.hydrate();
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'degraded', error: failure });
    expect(owner.repository.getSnapshot().entities).toEqual([]);
  });

  it('reloads durable history before applying a command after hydration fails', async () => {
    const failure = new Error('database unavailable');
    let attempts = 0;
    const storage: CollectionStorage<Entity> = {
      load: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
        return {
          record: {
            entities: [{ id: 'stored', path: 'stored.flac' }],
            selection: { ids: [], anchorId: null, focusId: null },
            playbackOptions
          }
        };
      }),
      save: vi.fn()
    };
    const owner = repository(storage);

    await owner.repository.hydrate();
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'new', path: 'new.flac' }] });

    expect(storage.load).toHaveBeenCalledTimes(2);
    expect(owner.repository.getSnapshot().entities.map((entity) => entity.id)).toEqual(['stored', 'new']);
  });

  it('never persists a command while durable history remains unreadable', async () => {
    const failure = new Error('database unavailable');
    const storage: CollectionStorage<Entity> = {
      load: vi.fn(async () => { throw failure; }),
      save: vi.fn()
    };
    const owner = repository(storage);

    await owner.repository.hydrate();
    await expect(owner.repository.dispatch({
      type: 'add', entities: [{ id: 'new', path: 'new.flac' }]
    })).rejects.toBe(failure);
    await expect(owner.repository.flush()).resolves.toBeUndefined();

    expect(owner.repository.getSnapshot().entities).toEqual([]);
    expect(storage.save).not.toHaveBeenCalled();
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'degraded', dirty: false, error: failure });
  });

  it('persists every revision that arrives while a prior write is in flight', async () => {
    const firstSave = deferred<void>();
    const firstSaveStarted = deferred<void>();
    const saved: CollectionRecord<Entity>[] = [];
    const storage: CollectionStorage<Entity> = {
      load: () => Promise.resolve(null),
      save: vi.fn(async (record) => {
        saved.push(record);
        if (saved.length === 1) {
          firstSaveStarted.resolve();
          await firstSave.promise;
        }
      })
    };
    const owner = repository(storage);
    await owner.repository.hydrate();
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });
    const flushing = owner.repository.flush();
    await firstSaveStarted.promise;
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'b', path: 'b' }] });
    firstSave.resolve();
    await flushing;

    expect(saved.map((record) => record.entities.map((entity) => entity.id))).toEqual([
      ['a'],
      ['a', 'b']
    ]);
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'ready', dirty: false });
  });

  it('checks a catalog revision inside the serialized command boundary', async () => {
    const storage: CollectionStorage<Entity> = { load: () => Promise.resolve(null), save: vi.fn() };
    const owner = repository(storage);
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });
    const expectedRevision = owner.repository.getSnapshot().catalogRevision;
    const selection = owner.repository.dispatch({
      type: 'set-selection', selection: { ids: ['a'], anchorId: 'a', focusId: 'a' }
    });
    const accepted = owner.repository.dispatchIfCatalogRevision(expectedRevision, {
      type: 'add', entities: [{ id: 'b', path: 'b' }]
    });
    await selection;
    expect(await accepted).toMatchObject({ status: 'applied' });

    const stale = await owner.repository.dispatchIfCatalogRevision(expectedRevision, {
      type: 'add', entities: [{ id: 'c', path: 'c' }]
    });
    expect(stale).toEqual({ status: 'conflict', actualCatalogRevision: expectedRevision + 1 });
    expect(owner.repository.getSnapshot().entities.map((entity) => entity.id)).toEqual(['a', 'b']);
  });

  it('publishes commands synchronously after hydration for the existing store facade', async () => {
    const storage: CollectionStorage<Entity> = { load: () => Promise.resolve(null), save: vi.fn() };
    const owner = repository(storage);
    await owner.repository.hydrate();

    const dispatched = owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });

    expect(owner.repository.getSnapshot().entities.map((entity) => entity.id)).toEqual(['a']);
    await expect(dispatched).resolves.toMatchObject({ changed: true });
  });

  it('reports write failures, retains dirty state, and retries on the next explicit flush', async () => {
    let fail = true;
    const storage: CollectionStorage<Entity> = {
      load: () => Promise.resolve(null),
      save: vi.fn(async () => {
        if (fail) throw new Error('quota');
      })
    };
    const owner = repository(storage);
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });
    await expect(owner.repository.flush()).rejects.toThrow('quota');
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'degraded', dirty: true });
    fail = false;
    await owner.repository.flush();
    expect(owner.repository.getStatus()).toMatchObject({ phase: 'ready', dirty: false });
  });

  it('flushes once and rejects later commands during idempotent shutdown', async () => {
    const storage: CollectionStorage<Entity> = { load: () => Promise.resolve(null), save: vi.fn() };
    const owner = repository(storage);
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });
    const first = owner.repository.shutdown();
    const second = owner.repository.shutdown();
    expect(second).toBe(first);
    await first;
    expect(storage.save).toHaveBeenCalledOnce();
    expect(owner.repository.getStatus().phase).toBe('disposed');
    await expect(owner.repository.dispatch({ type: 'remove', ids: ['a'] })).rejects.toThrow('shutting down');
  });

  it('can start an explicitly ephemeral repository ready for synchronous facades', async () => {
    const storage: CollectionStorage<Entity> = { load: vi.fn(), save: vi.fn() };
    const owner = new CollectionRepository({
      storage,
      scheduler: new FakeScheduler(),
      defaultPlaybackOptions: playbackOptions,
      policy: { dedupe: false, identity: (entity: Entity) => entity.path },
      initiallyHydrated: true
    });

    const dispatched = owner.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] });
    expect(owner.getSnapshot().entities).toEqual([{ id: 'a', path: 'a' }]);
    await dispatched;
    expect(storage.load).not.toHaveBeenCalled();
  });

  it('keeps an earlier persistence deadline when later background work requests a longer delay', async () => {
    const scheduler = new FakeScheduler();
    const storage: CollectionStorage<Entity> = { load: () => Promise.resolve(null), save: vi.fn() };
    const owner = repository(storage, scheduler);
    await owner.repository.hydrate();
    await owner.repository.dispatch({ type: 'add', entities: [{ id: 'a', path: 'a' }] }, 400);
    const firstCallback = scheduler.callback;

    owner.repository.requestPersist(5_000);
    expect(scheduler.callback).toBe(firstCallback);

    scheduler.fire();
    await owner.repository.flush();
    expect(storage.save).toHaveBeenCalledOnce();
  });
});
