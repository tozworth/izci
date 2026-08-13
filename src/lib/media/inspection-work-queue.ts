import type { AbortControllerPort, ClockPort } from '../runtime/ports';

export type InspectionPriority = 'interactive' | 'background';

export type InspectionCancellationReason =
  | 'aborted'
  | 'cancelled'
  | 'disposed'
  | 'superseded'
  | 'timeout';

export class InspectionWorkCancelledError<TKey = unknown> extends Error {
  readonly code = 'inspection-work-cancelled';

  constructor(
    readonly reason: InspectionCancellationReason,
    readonly key?: TKey
  ) {
    super(`Inspection work was ${reason}.`);
    this.name = 'InspectionWorkCancelledError';
  }
}

export interface InspectionWorkContext {
  readonly signal: AbortSignal;
  readonly priority: InspectionPriority;
}

export interface InspectionWorkOptions<TKey> {
  readonly key?: TKey;
  readonly priority?: InspectionPriority;
  readonly signal?: AbortSignal;
  /** Execution timeout. Queueing time is not included. */
  readonly timeoutMs?: number;
}

export interface InspectionWorkTicket<TResult> {
  readonly result: Promise<TResult>;
  /** Returns true only for the call that first cancels unsettled work. */
  cancel(): boolean;
}

export interface InspectionWorkQueueCounts {
  readonly active: number;
  readonly activeBackground: number;
  readonly activeInteractive: number;
  readonly awaitingAdmission: number;
  readonly awaitingAdmissionBackground: number;
  readonly awaitingAdmissionInteractive: number;
  readonly queued: number;
  readonly queuedBackground: number;
  readonly queuedInteractive: number;
  readonly peakActive: number;
  readonly peakActiveBackground: number;
  readonly peakActiveInteractive: number;
  readonly peakAwaitingAdmission: number;
  readonly peakAwaitingAdmissionBackground: number;
  readonly peakAwaitingAdmissionInteractive: number;
  readonly peakQueued: number;
  readonly peakQueuedBackground: number;
  readonly peakQueuedInteractive: number;
}

export interface BoundedInspectionWorkQueueOptions {
  readonly maxConcurrency: number;
  readonly maxBackgroundConcurrency: number;
  /** Maximum work retained after admission but before execution. */
  readonly maxQueued: number;
  readonly clock: Pick<ClockPort, 'clearTimeout' | 'setTimeout'>;
  readonly abortControllers: Pick<AbortControllerPort, 'create'>;
}

type InspectionWork<TResult> = (context: InspectionWorkContext) => PromiseLike<TResult> | TResult;

interface WorkItem<TKey> {
  readonly key: TKey | undefined;
  readonly priority: InspectionPriority;
  readonly timeoutMs: number | undefined;
  readonly controller: AbortController;
  readonly work: InspectionWork<unknown>;
  readonly admit: (ticket: InspectionWorkTicket<unknown>) => void;
  readonly rejectAdmission: (error: unknown) => void;
  readonly externalSignal: AbortSignal | undefined;
  readonly externalAbortListener: (() => void) | undefined;
  state: 'awaiting-admission' | 'queued' | 'running' | 'finished';
  logicalSettled: boolean;
  resolve: ((value: unknown | PromiseLike<unknown>) => void) | undefined;
  reject: ((error: unknown) => void) | undefined;
  timeoutHandle: unknown;
  physicalCompletion: Promise<void> | undefined;
}

function assertLimit(name: string, value: number, allowZero = false): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}.`);
  }
}

function assertTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new RangeError('timeoutMs must be a finite number greater than or equal to 0.');
  }
}

export class BoundedInspectionWorkQueue<TKey = string> {
  readonly #maxConcurrency: number;
  readonly #maxBackgroundConcurrency: number;
  readonly #maxQueued: number;
  readonly #clock: Pick<ClockPort, 'clearTimeout' | 'setTimeout'>;
  readonly #abortControllers: Pick<AbortControllerPort, 'create'>;
  readonly #interactiveQueue: WorkItem<TKey>[] = [];
  readonly #backgroundQueue: WorkItem<TKey>[] = [];
  readonly #interactiveAdmissionQueue: WorkItem<TKey>[] = [];
  readonly #backgroundAdmissionQueue: WorkItem<TKey>[] = [];
  readonly #running = new Set<WorkItem<TKey>>();
  readonly #latestByKey = new Map<TKey, WorkItem<TKey>>();
  #activeBackground = 0;
  #activeInteractive = 0;
  #peakActive = 0;
  #peakActiveBackground = 0;
  #peakActiveInteractive = 0;
  #peakAwaitingAdmission = 0;
  #peakAwaitingAdmissionBackground = 0;
  #peakAwaitingAdmissionInteractive = 0;
  #peakQueued = 0;
  #peakQueuedBackground = 0;
  #peakQueuedInteractive = 0;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;

  constructor(options: BoundedInspectionWorkQueueOptions) {
    assertLimit('maxConcurrency', options.maxConcurrency);
    assertLimit('maxBackgroundConcurrency', options.maxBackgroundConcurrency, true);
    assertLimit('maxQueued', options.maxQueued, true);
    if (options.maxBackgroundConcurrency > options.maxConcurrency) {
      throw new RangeError('maxBackgroundConcurrency cannot exceed maxConcurrency.');
    }
    this.#maxConcurrency = options.maxConcurrency;
    this.#maxBackgroundConcurrency = options.maxBackgroundConcurrency;
    this.#maxQueued = options.maxQueued;
    this.#clock = options.clock;
    this.#abortControllers = options.abortControllers;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get counts(): InspectionWorkQueueCounts {
    const awaitingAdmissionInteractive = this.#interactiveAdmissionQueue.length;
    const awaitingAdmissionBackground = this.#backgroundAdmissionQueue.length;
    const queuedInteractive = this.#interactiveQueue.length;
    const queuedBackground = this.#backgroundQueue.length;
    return {
      active: this.#running.size,
      activeBackground: this.#activeBackground,
      activeInteractive: this.#activeInteractive,
      awaitingAdmission: awaitingAdmissionInteractive + awaitingAdmissionBackground,
      awaitingAdmissionBackground,
      awaitingAdmissionInteractive,
      queued: queuedInteractive + queuedBackground,
      queuedBackground,
      queuedInteractive,
      peakActive: this.#peakActive,
      peakActiveBackground: this.#peakActiveBackground,
      peakActiveInteractive: this.#peakActiveInteractive,
      peakAwaitingAdmission: this.#peakAwaitingAdmission,
      peakAwaitingAdmissionBackground: this.#peakAwaitingAdmissionBackground,
      peakAwaitingAdmissionInteractive: this.#peakAwaitingAdmissionInteractive,
      peakQueued: this.#peakQueued,
      peakQueuedBackground: this.#peakQueuedBackground,
      peakQueuedInteractive: this.#peakQueuedInteractive
    };
  }

  enqueue<TResult>(
    work: InspectionWork<TResult>,
    options: InspectionWorkOptions<TKey> = {}
  ): Promise<InspectionWorkTicket<TResult>> {
    assertTimeout(options.timeoutMs);
    const controller = this.#abortControllers.create();
    const priority = options.priority ?? 'background';
    let item!: WorkItem<TKey>;
    const externalAbortListener = options.signal === undefined
      ? undefined
      : () => { this.#cancel(item, 'aborted'); };
    const admission = new Promise<InspectionWorkTicket<TResult>>((admit, rejectAdmission) => {
      item = {
        key: options.key,
        priority,
        timeoutMs: options.timeoutMs,
        controller,
        work,
        admit: (ticket) => { admit(ticket as InspectionWorkTicket<TResult>); },
        rejectAdmission,
        externalSignal: options.signal,
        externalAbortListener,
        state: 'awaiting-admission',
        logicalSettled: false,
        resolve: undefined,
        reject: undefined,
        timeoutHandle: undefined,
        physicalCompletion: undefined
      };
    });

    if (this.#disposed) {
      this.#cancel(item, 'disposed', false);
      return admission;
    }
    if (options.signal?.aborted) {
      this.#cancel(item, 'aborted', false);
      return admission;
    }

    options.signal?.addEventListener('abort', externalAbortListener!, { once: true });
    if (options.signal?.aborted) {
      this.#cancel(item, 'aborted', false);
      return admission;
    }

    if (options.key !== undefined) {
      const previous = this.#latestByKey.get(options.key);
      if (previous !== undefined) {
        this.#cancel(previous, 'superseded', false);
      }
      this.#latestByKey.set(options.key, item);
    }

    this.#admissionQueueFor(priority).push(item);
    this.#pump();
    this.#updateAdmissionPeaks();
    return admission;
  }

  dispose(): Promise<void> {
    if (this.#disposePromise !== undefined) {
      return this.#disposePromise;
    }
    this.#disposed = true;
    for (const item of [
      ...this.#interactiveAdmissionQueue,
      ...this.#backgroundAdmissionQueue
    ]) {
      this.#cancel(item, 'disposed', false);
    }
    for (const item of [...this.#interactiveQueue, ...this.#backgroundQueue]) {
      this.#cancel(item, 'disposed', false);
    }
    const physicalCompletions = [...this.#running].map((item) => {
      this.#cancel(item, 'disposed', false);
      return item.physicalCompletion!;
    });
    this.#disposePromise = Promise.all(physicalCompletions).then(() => undefined);
    return this.#disposePromise;
  }

  #queueFor(priority: InspectionPriority): WorkItem<TKey>[] {
    return priority === 'interactive' ? this.#interactiveQueue : this.#backgroundQueue;
  }

  #admissionQueueFor(priority: InspectionPriority): WorkItem<TKey>[] {
    return priority === 'interactive'
      ? this.#interactiveAdmissionQueue
      : this.#backgroundAdmissionQueue;
  }

  #cancel(
    item: WorkItem<TKey>,
    reason: InspectionCancellationReason,
    shouldDrain = true
  ): boolean {
    if (item.logicalSettled) {
      return false;
    }
    item.logicalSettled = true;
    const cancellation = new InspectionWorkCancelledError(reason, item.key);
    if (item.state === 'awaiting-admission') {
      const admissionQueue = this.#admissionQueueFor(item.priority);
      const index = admissionQueue.indexOf(item);
      if (index >= 0) {
        admissionQueue.splice(index, 1);
      }
      item.state = 'finished';
      this.#releaseKey(item);
      this.#cleanupLogicalResources(item);
      item.controller.abort();
      item.rejectAdmission(cancellation);
    } else if (item.state === 'queued') {
      const queue = this.#queueFor(item.priority);
      const index = queue.indexOf(item);
      if (index >= 0) {
        queue.splice(index, 1);
      }
      item.state = 'finished';
      this.#releaseKey(item);
      this.#cleanupLogicalResources(item);
      item.controller.abort();
      item.reject!(cancellation);
    } else {
      this.#clearExecutionTimeout(item);
      this.#removeExternalAbortListener(item);
      item.controller.abort();
      item.reject!(cancellation);
    }
    if (shouldDrain && !this.#disposed) {
      this.#pump();
    }
    return true;
  }

  #drain(): void {
    while (!this.#disposed && this.#running.size < this.#maxConcurrency) {
      let item = this.#interactiveQueue.shift();
      if (item === undefined && this.#activeBackground < this.#maxBackgroundConcurrency) {
        item = this.#backgroundQueue.shift();
      }
      if (item === undefined) {
        return;
      }
      this.#start(item);
    }
  }

  #pump(): void {
    if (this.#disposed) return;
    this.#drain();
    while (true) {
      let item: WorkItem<TKey> | undefined;
      if (
        this.#interactiveAdmissionQueue.length > 0
        && this.#canAdmit('interactive')
      ) {
        item = this.#interactiveAdmissionQueue.shift();
      } else if (
        this.#backgroundAdmissionQueue.length > 0
        && this.#canAdmit('background')
      ) {
        item = this.#backgroundAdmissionQueue.shift();
      }
      if (item === undefined) return;
      this.#admit(item);
      if (
        this.#interactiveQueue.length + this.#backgroundQueue.length
        <= this.#maxQueued
      ) {
        this.#updateQueuedPeaks();
      }
      this.#drain();
    }
  }

  #canAdmit(priority: InspectionPriority): boolean {
    const queued = this.#interactiveQueue.length + this.#backgroundQueue.length;
    if (queued < this.#maxQueued) return true;
    if (this.#running.size >= this.#maxConcurrency) return false;
    if (priority === 'interactive') {
      return this.#interactiveQueue.length === 0;
    }
    return this.#interactiveQueue.length === 0
      && this.#backgroundQueue.length === 0
      && this.#activeBackground < this.#maxBackgroundConcurrency;
  }

  #admit(item: WorkItem<TKey>): void {
    let resolve!: (value: unknown | PromiseLike<unknown>) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<unknown>((resolveResult, rejectResult) => {
      resolve = resolveResult;
      reject = rejectResult;
    });
    item.resolve = resolve;
    item.reject = reject;
    item.state = 'queued';
    this.#queueFor(item.priority).push(item);
    item.admit({
      result,
      cancel: () => this.#cancel(item, 'cancelled')
    });
  }

  #start(item: WorkItem<TKey>): void {
    item.state = 'running';
    this.#running.add(item);
    if (item.priority === 'background') {
      this.#activeBackground += 1;
    } else {
      this.#activeInteractive += 1;
    }
    this.#updateActivePeaks();
    if (item.timeoutMs !== undefined) {
      item.timeoutHandle = this.#clock.setTimeout(() => {
        item.timeoutHandle = undefined;
        this.#cancel(item, 'timeout');
      }, item.timeoutMs);
    }

    const execution = Promise.resolve().then(() => item.work({
      signal: item.controller.signal,
      priority: item.priority
    }));
    item.physicalCompletion = execution.then(
      (value) => {
        const shouldResolve = !item.logicalSettled;
        if (shouldResolve) {
          item.logicalSettled = true;
          this.#cleanupLogicalResources(item);
        }
        this.#finishPhysical(item);
        if (shouldResolve) {
          item.resolve!(value);
        }
      },
      (error: unknown) => {
        const shouldReject = !item.logicalSettled;
        if (shouldReject) {
          item.logicalSettled = true;
          this.#cleanupLogicalResources(item);
        }
        this.#finishPhysical(item);
        if (shouldReject) {
          item.reject!(error);
        }
      }
    );
    void item.physicalCompletion.catch(() => undefined);
  }

  #finishPhysical(item: WorkItem<TKey>): void {
    this.#running.delete(item);
    if (item.priority === 'background') {
      this.#activeBackground -= 1;
    } else {
      this.#activeInteractive -= 1;
    }
    item.state = 'finished';
    this.#cleanupLogicalResources(item);
    this.#releaseKey(item);
    if (!this.#disposed) {
      this.#pump();
    }
  }

  #cleanupLogicalResources(item: WorkItem<TKey>): void {
    this.#clearExecutionTimeout(item);
    this.#removeExternalAbortListener(item);
  }

  #clearExecutionTimeout(item: WorkItem<TKey>): void {
    if (item.timeoutHandle !== undefined) {
      this.#clock.clearTimeout(item.timeoutHandle);
      item.timeoutHandle = undefined;
    }
  }

  #removeExternalAbortListener(item: WorkItem<TKey>): void {
    if (item.externalSignal !== undefined && item.externalAbortListener !== undefined) {
      item.externalSignal.removeEventListener('abort', item.externalAbortListener);
    }
  }

  #releaseKey(item: WorkItem<TKey>): void {
    if (item.key !== undefined && this.#latestByKey.get(item.key) === item) {
      this.#latestByKey.delete(item.key);
    }
  }

  #updateActivePeaks(): void {
    this.#peakActive = Math.max(this.#peakActive, this.#running.size);
    this.#peakActiveBackground = Math.max(this.#peakActiveBackground, this.#activeBackground);
    this.#peakActiveInteractive = Math.max(this.#peakActiveInteractive, this.#activeInteractive);
  }

  #updateQueuedPeaks(): void {
    this.#peakQueuedInteractive = Math.max(
      this.#peakQueuedInteractive,
      this.#interactiveQueue.length
    );
    this.#peakQueuedBackground = Math.max(
      this.#peakQueuedBackground,
      this.#backgroundQueue.length
    );
    this.#peakQueued = Math.max(
      this.#peakQueued,
      this.#interactiveQueue.length + this.#backgroundQueue.length
    );
  }

  #updateAdmissionPeaks(): void {
    this.#peakAwaitingAdmissionInteractive = Math.max(
      this.#peakAwaitingAdmissionInteractive,
      this.#interactiveAdmissionQueue.length
    );
    this.#peakAwaitingAdmissionBackground = Math.max(
      this.#peakAwaitingAdmissionBackground,
      this.#backgroundAdmissionQueue.length
    );
    this.#peakAwaitingAdmission = Math.max(
      this.#peakAwaitingAdmission,
      this.#interactiveAdmissionQueue.length + this.#backgroundAdmissionQueue.length
    );
  }
}
