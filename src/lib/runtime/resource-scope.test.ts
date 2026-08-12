import { describe, expect, it, vi } from 'vitest';
import type {
  AbortControllerPort,
  BroadcastChannelPort,
  ClockPort,
  IdPort,
  ObjectUrlPort,
  ViteWorkerConstructor,
  WorkerPort
} from './ports';
import { ResourceScope } from './resource-scope';
import {
  ownAbortController,
  ownAnimationFrame,
  ownBroadcastChannel,
  ownEventListener,
  ownInterval,
  ownObjectUrl,
  ownTimeout,
  ownWorker
} from './resources';

class FakeIds implements IdPort {
  #next = 0;
  create(): string { return `id-${++this.#next}`; }
}

class FakeClock implements ClockPort {
  time = 10;
  nextHandle = 0;
  timeouts = new Map<number, () => void>();
  intervals = new Map<number, () => void>();
  frames = new Map<number, (time: number) => void>();
  clearedTimeouts: unknown[] = [];
  clearedIntervals: unknown[] = [];
  cancelledFrames: unknown[] = [];

  wallNow(): number { return 1_000 + this.time++; }
  monotonicNow(): number { return this.time++; }
  queueMicrotask(callback: () => void): void { callback(); }
  setTimeout(callback: () => void): unknown {
    const handle = ++this.nextHandle;
    this.timeouts.set(handle, callback);
    return handle;
  }
  clearTimeout(handle: unknown): void { this.clearedTimeouts.push(handle); this.timeouts.delete(handle as number); }
  setInterval(callback: () => void): unknown {
    const handle = ++this.nextHandle;
    this.intervals.set(handle, callback);
    return handle;
  }
  clearInterval(handle: unknown): void { this.clearedIntervals.push(handle); this.intervals.delete(handle as number); }
  requestAnimationFrame(callback: (time: number) => void): unknown {
    const handle = ++this.nextHandle;
    this.frames.set(handle, callback);
    return handle;
  }
  cancelAnimationFrame(handle: unknown): void { this.cancelledFrames.push(handle); this.frames.delete(handle as number); }
}

function scope(label = 'page'): { scope: ResourceScope; clock: FakeClock } {
  const clock = new FakeClock();
  return { scope: new ResourceScope(label, clock, new FakeIds()), clock };
}

describe('ResourceScope', () => {
  it('begins releases in LIFO order and returns the identical promise and report repeatedly', async () => {
    const { scope: resources } = scope();
    const releases: string[] = [];
    resources.register({ kind: 'worker', label: 'first' }, () => { releases.push('first'); });
    resources.register({ kind: 'object-url', label: 'second' }, async () => { releases.push('second'); });
    resources.register({ kind: 'interval', label: 'third' }, () => { releases.push('third'); });

    const firstDisposal = resources.dispose();
    const repeatedDisposal = resources.dispose();
    expect(repeatedDisposal).toBe(firstDisposal);
    expect(releases).toEqual(['third', 'second', 'first']);
    const firstReport = await firstDisposal;
    const repeatedReport = await repeatedDisposal;

    expect(repeatedReport).toBe(firstReport);
    expect(firstReport).toMatchObject({ released: 3, failures: [] });
    expect(resources.diagnostic()).toMatchObject({
      state: 'disposed',
      counts: { active: 0, peak: 3, released: 3, acquisitionFailures: 0, releaseFailures: 0 }
    });
  });

  it('settles every release and reports errors instead of rejecting disposal', async () => {
    const { scope: resources } = scope();
    const laterRelease = vi.fn();
    resources.register({ kind: 'worker', label: 'still-released' }, laterRelease);
    resources.register({ kind: 'broadcast-channel', label: 'broken' }, () => {
      throw { name: 'InvalidStateError', message: 'already closed' };
    });

    const report = await resources.dispose();
    expect(laterRelease).toHaveBeenCalledOnce();
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.error).toMatchObject({
      category: 'blocked', code: 'runtime.release-failed', operation: 'release broadcast-channel:broken'
    });
    expect(report.resources.map((entry) => entry.state)).toEqual(['released', 'release-failed']);
  });

  it('cleans partial acquisition and keeps the acquisition failure inspectable', async () => {
    const { scope: resources } = scope();
    const releaseFirst = vi.fn();
    await resources.acquire(
      { kind: 'worker', label: 'first step' },
      () => ({ worker: 1 }),
      releaseFirst
    );
    await expect(resources.acquire(
      { kind: 'object-url', label: 'second step' },
      () => { throw { name: 'NotReadableError', message: 'disk disappeared' }; },
      () => undefined
    )).rejects.toMatchObject({ category: 'io', code: 'runtime.acquisition-failed' });

    const report = await resources.dispose();
    expect(releaseFirst).toHaveBeenCalledOnce();
    expect(report.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'second step', state: 'acquisition-failed' })
    ]));
    expect(resources.diagnostic().counts).toMatchObject({
      active: 0, peak: 1, released: 1, acquisitionFailures: 1
    });
  });

  it('disposes replaced child scopes before installing their replacements', async () => {
    const { scope: root } = scope('root');
    const first = root.createChild('scan');
    const released = vi.fn();
    first.register({ kind: 'worker', label: 'old scan worker' }, released);

    const replacement = await root.replaceChild(first, 'scan');
    expect(released).toHaveBeenCalledOnce();
    expect(first.diagnostic().state).toBe('disposed');
    expect(replacement.diagnostic().state).toBe('active');

    const rootReport = await root.dispose();
    expect(rootReport.failures).toEqual([]);
    expect(replacement.diagnostic().state).toBe('disposed');
  });

  it('releases a late acquisition when cancellation disposes its scope', async () => {
    const { scope: resources } = scope();
    let finish!: (value: object) => void;
    const pending = new Promise<object>((resolve) => { finish = resolve; });
    const release = vi.fn();
    const acquisition = resources.acquire(
      { kind: 'worker', label: 'pending' }, () => pending, release
    );

    const disposal = resources.dispose();
    finish({ worker: true });
    await expect(acquisition).rejects.toMatchObject({
      category: 'stale', code: 'runtime.scope-settled-during-acquisition'
    });
    await disposal;
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('typed resource ownership', () => {
  it('owns listeners, clock work, controllers, channels, workers, and object URLs', async () => {
    const { scope: resources, clock } = scope();
    const removeEventListener = vi.fn();
    const target = { addEventListener: vi.fn(), removeEventListener };
    const listener: EventListener = () => undefined;
    ownEventListener(resources, target, 'change', listener, { capture: true }, 'settings listener');
    ownTimeout(resources, clock, vi.fn(), 50, 'save debounce');
    ownInterval(resources, clock, vi.fn(), 50, 'meter poll');
    ownAnimationFrame(resources, clock, vi.fn(), 'render');

    const abort = vi.fn();
    const controllers: AbortControllerPort = {
      create: () => ({ abort } as unknown as AbortController)
    };
    ownAbortController(resources, controllers, 'scan cancellation');

    const close = vi.fn();
    const channels: BroadcastChannelPort = {
      create: () => ({ close } as unknown as BroadcastChannel)
    };
    ownBroadcastChannel(resources, channels, 'settings', 'settings channel');

    const terminate = vi.fn();
    const workers: WorkerPort = {
      create: <TWorker extends Worker>(_constructor: ViteWorkerConstructor<TWorker>) =>
        ({ terminate } as unknown as TWorker)
    };
    class IgnoredWorker {}
    ownWorker(resources, workers, IgnoredWorker as unknown as ViteWorkerConstructor, 'metadata worker');

    const revoke = vi.fn();
    const objectUrls: ObjectUrlPort = { create: () => 'blob:track', revoke };
    ownObjectUrl(resources, objectUrls, {} as Blob, 'track lease');

    const diagnostic = resources.diagnostic();
    expect(diagnostic.resources.map(({ kind, label }) => ({ kind, label }))).toEqual([
      { kind: 'event-listener', label: 'settings listener' },
      { kind: 'timeout', label: 'save debounce' },
      { kind: 'interval', label: 'meter poll' },
      { kind: 'animation-frame', label: 'render' },
      { kind: 'abort-controller', label: 'scan cancellation' },
      { kind: 'broadcast-channel', label: 'settings channel' },
      { kind: 'worker', label: 'metadata worker' },
      { kind: 'object-url', label: 'track lease' }
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain('blob:track');

    await resources.dispose();
    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(clock.clearedTimeouts).toHaveLength(1);
    expect(clock.clearedIntervals).toHaveLength(1);
    expect(clock.cancelledFrames).toHaveLength(1);
    expect(abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('cleans a resource acquired after its scope has settled', async () => {
    const { scope: resources } = scope();
    await resources.dispose();
    const revoke = vi.fn();
    const objectUrls: ObjectUrlPort = { create: () => 'blob:late', revoke };

    expect(() => ownObjectUrl(resources, objectUrls, {} as Blob, 'late lease'))
      .toThrowError(expect.objectContaining({ category: 'stale', code: 'runtime.scope-not-active' }));
    expect(revoke).toHaveBeenCalledWith('blob:late');
  });
});
