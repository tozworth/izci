import { describe, expect, it, vi } from 'vitest';
import {
  BoundedInspectionWorkQueue,
  InspectionWorkCancelledError,
  type InspectionCancellationReason
} from './inspection-work-queue';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class ManualTimers {
  #nextHandle = 0;
  readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void, _delayMs: number): unknown {
    const handle = ++this.#nextHandle;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  fireAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback();
    }
  }
}

function createQueue<TKey = string>(
  maxConcurrency = 2,
  maxBackgroundConcurrency = 1,
  timers = new ManualTimers(),
  maxQueued = 32
): BoundedInspectionWorkQueue<TKey> {
  return new BoundedInspectionWorkQueue<TKey>({
    maxConcurrency,
    maxBackgroundConcurrency,
    maxQueued,
    clock: timers,
    abortControllers: { create: () => new AbortController() }
  });
}

async function expectCancellation(
  result: Promise<unknown>,
  reason: InspectionCancellationReason
): Promise<void> {
  const error = await result.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(InspectionWorkCancelledError);
  expect(error).toMatchObject({ code: 'inspection-work-cancelled', reason });
}

async function turn(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

describe('BoundedInspectionWorkQueue', () => {
  it('enforces total and background physical caps while exposing current and peak counts', async () => {
    const queue = createQueue(3, 1);
    const work = Array.from({ length: 5 }, () => deferred<string>());
    const started: number[] = [];
    const ticket = (index: number, priority: 'interactive' | 'background') => queue.enqueue(
      async () => {
        started.push(index);
        return work[index].promise;
      },
      { priority }
    );

    const background = await Promise.all([
      ticket(0, 'background'),
      ticket(1, 'background'),
      ticket(2, 'background')
    ]);
    const interactive = await Promise.all([
      ticket(3, 'interactive'),
      ticket(4, 'interactive')
    ]);
    await turn();

    expect(started).toEqual([0, 3, 4]);
    expect(queue.counts).toMatchObject({
      active: 3,
      activeBackground: 1,
      activeInteractive: 2,
      queued: 2,
      peakActive: 3,
      peakActiveBackground: 1,
      peakActiveInteractive: 2,
      peakQueuedBackground: 2
    });

    work[3].resolve('interactive-1');
    work[4].resolve('interactive-2');
    await turn();
    expect(started).toEqual([0, 3, 4]);
    expect(queue.counts).toMatchObject({ active: 1, queuedBackground: 2 });

    work[0].resolve('background-1');
    await turn();
    expect(started).toEqual([0, 3, 4, 1]);
    work[1].resolve('background-2');
    await turn();
    work[2].resolve('background-3');
    await expect(Promise.all([...background, ...interactive].map(({ result }) => result))).resolves.toEqual([
      'background-1',
      'background-2',
      'background-3',
      'interactive-1',
      'interactive-2'
    ]);
    expect(queue.counts.active).toBe(0);
  });

  it('starts queued interactive work before older queued background work', async () => {
    const queue = createQueue(1, 1);
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: string[] = [];
    const enqueue = (name: string, gate: Deferred<void>, priority: 'interactive' | 'background') =>
      queue.enqueue(async () => {
        started.push(name);
        await gate.promise;
        return name;
      }, { priority });

    const first = await enqueue('background-1', gates[0], 'background');
    const second = await enqueue('background-2', gates[1], 'background');
    const interactive = await enqueue('interactive', gates[2], 'interactive');
    await turn();
    expect(started).toEqual(['background-1']);

    gates[0].resolve();
    await turn();
    expect(started).toEqual(['background-1', 'interactive']);
    gates[2].resolve();
    await turn();
    expect(started).toEqual(['background-1', 'interactive', 'background-2']);
    gates[1].resolve();
    await expect(Promise.all([first.result, second.result, interactive.result])).resolves.toEqual([
      'background-1',
      'background-2',
      'interactive'
    ]);
  });

  it('supersedes older keyed work whether it is queued or physically running', async () => {
    const queue = createQueue(1, 1);
    const runningGate = deferred<string>();
    const queuedWork = vi.fn(async () => 'stale-queued');
    const newestWork = vi.fn(async () => 'newest');
    const running = await queue.enqueue(
      () => runningGate.promise,
      { key: 'track', priority: 'background' }
    );
    await turn();

    const queued = await queue.enqueue(queuedWork, { key: 'track', priority: 'interactive' });
    const newest = await queue.enqueue(newestWork, { key: 'track', priority: 'interactive' });
    await expectCancellation(running.result, 'superseded');
    await expectCancellation(queued.result, 'superseded');
    expect(queue.counts).toMatchObject({ active: 1, queuedInteractive: 1 });
    expect(queuedWork).not.toHaveBeenCalled();
    expect(newestWork).not.toHaveBeenCalled();

    runningGate.resolve('late-stale-result');
    await expect(newest.result).resolves.toBe('newest');
    expect(newestWork).toHaveBeenCalledOnce();
    expect(queue.counts.active).toBe(0);
  });

  it('cancels queued and running tickets idempotently without freeing a physical slot early', async () => {
    const queue = createQueue(1, 1);
    const runningGate = deferred<string>();
    const queuedWork = vi.fn(async () => 'queued');
    let runningSignal: AbortSignal | undefined;
    const running = await queue.enqueue(({ signal }) => {
      runningSignal = signal;
      return runningGate.promise;
    }, { priority: 'background' });
    const queued = await queue.enqueue(queuedWork, { priority: 'interactive' });
    await turn();

    expect(queued.cancel()).toBe(true);
    expect(queued.cancel()).toBe(false);
    await expectCancellation(queued.result, 'cancelled');
    expect(queuedWork).not.toHaveBeenCalled();

    expect(running.cancel()).toBe(true);
    expect(running.cancel()).toBe(false);
    await expectCancellation(running.result, 'cancelled');
    expect(runningSignal?.aborted).toBe(true);
    expect(queue.counts).toMatchObject({ active: 1, queued: 0 });

    runningGate.resolve('ignored-late-result');
    await turn();
    expect(queue.counts.active).toBe(0);
  });

  it('supports external abort for queued and running work', async () => {
    const queue = createQueue(1, 1);
    const runningGate = deferred<void>();
    const runningAbort = new AbortController();
    const queuedAbort = new AbortController();
    const running = await queue.enqueue(() => runningGate.promise, { signal: runningAbort.signal });
    const queued = await queue.enqueue(async () => 'never', {
      priority: 'interactive',
      signal: queuedAbort.signal
    });
    await turn();

    queuedAbort.abort();
    runningAbort.abort();
    await expectCancellation(queued.result, 'aborted');
    await expectCancellation(running.result, 'aborted');
    expect(queue.counts).toMatchObject({ active: 1, queued: 0 });

    runningGate.resolve();
    await turn();
    expect(queue.counts.active).toBe(0);
  });

  it('times out logically while retaining the physical slot and suppressing late failure', async () => {
    const timers = new ManualTimers();
    const queue = createQueue(1, 1, timers, 0);
    const runningGate = deferred<string>();
    const nextWork = vi.fn(async () => 'next');
    const running = await queue.enqueue(() => runningGate.promise, { timeoutMs: 25 });
    const nextAdmission = queue.enqueue(nextWork, { priority: 'interactive' });
    await turn();

    timers.fireAll();
    await expectCancellation(running.result, 'timeout');
    expect(queue.counts).toMatchObject({
      active: 1,
      awaitingAdmissionInteractive: 1,
      queuedInteractive: 0
    });
    expect(nextWork).not.toHaveBeenCalled();

    runningGate.reject(new Error('ignored late failure'));
    const next = await nextAdmission;
    await expect(next.result).resolves.toBe('next');
    expect(nextWork).toHaveBeenCalledOnce();
    expect(queue.counts.active).toBe(0);
  });

  it('bounds the admitted queue and admits interactive waiters before background waiters', async () => {
    const queue = createQueue(1, 1, new ManualTimers(), 2);
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const started: number[] = [];
    const enqueue = (index: number, priority: 'interactive' | 'background') => queue.enqueue(
      async () => {
        started.push(index);
        await gates[index].promise;
        return index;
      },
      { priority }
    );

    const running = await enqueue(0, 'background');
    const firstQueued = await enqueue(1, 'background');
    const secondQueued = await enqueue(2, 'background');
    const backgroundAdmission = enqueue(3, 'background');
    const interactiveAdmission = enqueue(4, 'interactive');
    let backgroundAdmitted = false;
    let interactiveAdmitted = false;
    void backgroundAdmission.then(() => { backgroundAdmitted = true; });
    void interactiveAdmission.then(() => { interactiveAdmitted = true; });
    await turn();

    expect(started).toEqual([0]);
    expect(queue.counts).toMatchObject({
      active: 1,
      queued: 2,
      awaitingAdmission: 2,
      awaitingAdmissionBackground: 1,
      awaitingAdmissionInteractive: 1,
      peakQueued: 2,
      peakAwaitingAdmission: 2
    });

    gates[0].resolve();
    await turn();
    expect(started).toEqual([0, 1]);
    expect(interactiveAdmitted).toBe(true);
    expect(backgroundAdmitted).toBe(false);
    expect(queue.counts.queued).toBe(2);

    const interactive = await interactiveAdmission;
    gates[1].resolve();
    await turn();
    const lastBackground = await backgroundAdmission;
    expect(started).toEqual([0, 1, 4]);
    expect(queue.counts.queued).toBe(2);

    gates[4].resolve();
    await turn();
    gates[2].resolve();
    await turn();
    gates[3].resolve();
    await expect(Promise.all([
      running.result,
      firstQueued.result,
      secondQueued.result,
      lastBackground.result,
      interactive.result
    ])).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(queue.counts).toMatchObject({ active: 0, queued: 0, awaitingAdmission: 0 });
  });

  it('cancels admission deterministically and does not admit after logical running cancellation', async () => {
    const queue = createQueue(1, 1, new ManualTimers(), 0);
    const runningGate = deferred<void>();
    const nextWork = vi.fn(async () => 'next');
    const running = await queue.enqueue(() => runningGate.promise);
    const aborted = new AbortController();
    const abortedAdmission = queue.enqueue(async () => 'aborted', { signal: aborted.signal });
    const nextAdmission = queue.enqueue(nextWork, { priority: 'interactive' });
    await turn();
    expect(queue.counts).toMatchObject({ active: 1, queued: 0, awaitingAdmission: 2 });

    aborted.abort();
    await expectCancellation(abortedAdmission, 'aborted');
    expect(queue.counts.awaitingAdmission).toBe(1);

    expect(running.cancel()).toBe(true);
    await expectCancellation(running.result, 'cancelled');
    await turn();
    expect(nextWork).not.toHaveBeenCalled();
    expect(queue.counts).toMatchObject({ active: 1, queued: 0, awaitingAdmission: 1 });

    runningGate.resolve();
    const next = await nextAdmission;
    await expect(next.result).resolves.toBe('next');
    expect(nextWork).toHaveBeenCalledOnce();
  });

  it('disposes idempotently, cancels all logical results, and awaits physical settlement', async () => {
    const queue = createQueue(2, 1, new ManualTimers(), 0);
    const backgroundGate = deferred<void>();
    const interactiveGate = deferred<void>();
    const background = await queue.enqueue(
      () => backgroundGate.promise,
      { priority: 'background' }
    );
    const interactive = await queue.enqueue(
      () => interactiveGate.promise,
      { priority: 'interactive' }
    );
    const awaitingAdmission = queue.enqueue(async () => 'never', { priority: 'background' });
    await turn();

    const firstDispose = queue.dispose();
    const secondDispose = queue.dispose();
    expect(secondDispose).toBe(firstDispose);
    await Promise.all([
      expectCancellation(background.result, 'disposed'),
      expectCancellation(interactive.result, 'disposed'),
      expectCancellation(awaitingAdmission, 'disposed')
    ]);
    expect(queue.counts).toMatchObject({ active: 2, queued: 0, awaitingAdmission: 0 });

    let disposed = false;
    void firstDispose.then(() => { disposed = true; });
    await turn();
    expect(disposed).toBe(false);
    backgroundGate.resolve();
    await turn();
    expect(disposed).toBe(false);
    interactiveGate.resolve();
    await firstDispose;
    expect(disposed).toBe(true);
    expect(queue.counts.active).toBe(0);

    await expectCancellation(queue.enqueue(async () => 'never'), 'disposed');
    await expect(queue.dispose()).resolves.toBeUndefined();
  });

  it('validates physical and pending limits and execution timeouts', () => {
    const timers = new ManualTimers();
    expect(() => createQueue(0, 0, timers)).toThrow(RangeError);
    expect(() => createQueue(1, 2, timers)).toThrow(RangeError);
    expect(() => createQueue(1, 1, timers, -1)).toThrow(RangeError);
    const queue = createQueue(1, 0, timers);
    expect(() => queue.enqueue(async () => undefined, { timeoutMs: -1 })).toThrow(RangeError);
  });
});
