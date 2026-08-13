import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { MediaMaterializationLease } from '$lib/media/media-source';
import { InspectionWorkCancelledError } from '$lib/media/inspection-work-queue';
import {
  MediaInspectionPipeline,
  getMediaSourceRevision,
  type MediaInspectionHandlers
} from './media-inspection-pipeline';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class ManualTimers {
  readonly callbacks = new Map<number, () => void>();
  #next = 0;
  setTimeout(callback: () => void): unknown {
    const handle = ++this.#next;
    this.callbacks.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown): void { this.callbacks.delete(handle as number); }
  fireAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

const entity: MediaEntity = {
  id: 'track',
  path: 'Music/Track.flac',
  name: 'Track.flac',
  format: 'flac',
  kind: 'stream',
  size: 12,
  lastModified: 34
};

function handlers(
  catalog: MediaInspectionHandlers['catalog-metadata'] = async () => ({ title: 'Track' })
): MediaInspectionHandlers {
  return {
    'catalog-metadata': catalog,
    'embedded-artwork': async () => null,
    'embedded-lyrics': async () => null,
    'metadata-document': async () => null
  };
}

function harness(options: {
  catalog?: MediaInspectionHandlers['catalog-metadata'];
  materialize?: (source: MediaEntity) => Promise<MediaMaterializationLease | null>;
  timers?: ManualTimers;
} = {}) {
  const timers = options.timers ?? new ManualTimers();
  const release = vi.fn();
  const materialize = options.materialize ?? vi.fn(async (source: MediaEntity) => ({
    entity: source,
    file: {} as File,
    release
  }));
  const pipeline = new MediaInspectionPipeline({
    maxConcurrency: 2,
    maxBackgroundConcurrency: 1,
    clock: timers,
    abortControllers: { create: () => new AbortController() },
    handlers: handlers(options.catalog),
    materialize,
    defaultTimeoutMs: 100
  });
  return { pipeline, release, materialize, timers };
}

async function turn(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('media inspection pipeline', () => {
  it('captures the durable source revision and releases the file lease after success', async () => {
    const owner = harness();
    const result = await owner.pipeline.inspect({
      kind: 'catalog-metadata',
      entity,
      generationId: 'generation-1',
      origin: 'hydration'
    }).result;

    expect(result).toEqual({
      kind: 'catalog-metadata',
      entityId: entity.id,
      generationId: 'generation-1',
      sourceRevision: getMediaSourceRevision(entity),
      value: { title: 'Track' }
    });
    expect(owner.release).toHaveBeenCalledOnce();
  });

  it('releases the lease after a reader failure', async () => {
    const failure = new Error('decode failed');
    const owner = harness({ catalog: async () => { throw failure; } });
    await expect(owner.pipeline.inspect({
      kind: 'catalog-metadata', entity, generationId: 'g', origin: 'import'
    }).result).rejects.toBe(failure);
    expect(owner.release).toHaveBeenCalledOnce();
  });

  it('supersedes an old generation without freeing its physical slot or leaking its lease', async () => {
    const gate = deferred<null>();
    const started: string[] = [];
    const owner = harness({
      catalog: async ({ generationId }) => {
        started.push(generationId);
        if (generationId === 'old') return gate.promise;
        return { title: 'New' };
      }
    });
    const old = owner.pipeline.inspect({
      kind: 'catalog-metadata', entity, generationId: 'old', origin: 'hydration'
    });
    await turn();
    const current = owner.pipeline.inspect({
      kind: 'catalog-metadata', entity, generationId: 'new', origin: 'playback'
    });
    await expect(old.result).rejects.toMatchObject({
      constructor: InspectionWorkCancelledError,
      reason: 'superseded'
    });
    expect(started).toEqual(['old', 'new']);
    await expect(current.result).resolves.toMatchObject({ value: { title: 'New' } });
    expect(owner.pipeline.counts.active).toBe(1);
    expect(owner.release).toHaveBeenCalledOnce();
    gate.resolve(null);
    await turn();
    expect(owner.release).toHaveBeenCalledTimes(2);
  });

  it('keeps a timed-out reader physically active until it settles and then releases', async () => {
    const gate = deferred<null>();
    const timers = new ManualTimers();
    const owner = harness({ catalog: () => gate.promise, timers });
    const ticket = owner.pipeline.inspect({
      kind: 'catalog-metadata', entity, generationId: 'g', origin: 'hydration'
    });
    await turn();
    timers.fireAll();
    await expect(ticket.result).rejects.toMatchObject({ reason: 'timeout' });
    expect(owner.pipeline.counts.active).toBe(1);
    expect(owner.release).not.toHaveBeenCalled();
    gate.resolve(null);
    await turn();
    expect(owner.pipeline.counts.active).toBe(0);
    expect(owner.release).toHaveBeenCalledOnce();
  });

  it('reports unavailable sources and disposes idempotently', async () => {
    const owner = harness({ materialize: vi.fn(async () => null) });
    await expect(owner.pipeline.inspect({
      kind: 'catalog-metadata', entity, generationId: 'g', origin: 'tool'
    }).result).rejects.toMatchObject({
      category: 'unavailable',
      code: 'media-inspection.source-unavailable'
    });
    const first = owner.pipeline.dispose();
    const second = owner.pipeline.dispose();
    expect(second).toBe(first);
    await first;
  });
});
