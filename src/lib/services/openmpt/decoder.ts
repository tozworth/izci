import type { ModuleDecodeRequest, ModuleDecodeResponse, OpenMptInspection } from './protocol';

interface DecodeJob {
  buffer: ArrayBuffer;
  mode: ModuleDecodeRequest['mode'];
  subsong: number;
  resolve(value: OpenMptInspection | boolean): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  abort?: () => void;
}

/** Bounded dispatch: buffers waiting in the queue stay on this side of the port. */
export class ModuleDecoder {
  #worker: Worker | undefined;
  #queue: DecodeJob[] = [];
  #active: DecodeJob | undefined;
  #id = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  verify(buffer: ArrayBuffer, signal?: AbortSignal): Promise<boolean> {
    return this.#request(buffer, 'verify', 0, signal) as Promise<boolean>;
  }

  inspect(buffer: ArrayBuffer, options: { patterns?: boolean; subsong?: number; signal?: AbortSignal } = {}): Promise<OpenMptInspection> {
    return this.#request(buffer, options.patterns ? 'patterns' : 'metadata', options.subsong ?? 0, options.signal) as Promise<OpenMptInspection>;
  }

  #request(buffer: ArrayBuffer, mode: DecodeJob['mode'], subsong: number, signal?: AbortSignal): Promise<OpenMptInspection | boolean> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Module inspection canceled.')); return; }
      const job: DecodeJob = { buffer, mode, subsong, resolve, reject, signal };
      job.abort = () => {
        if (this.#active === job) this.#fail(new Error('Module inspection canceled.'));
        else {
          this.#queue = this.#queue.filter((queued) => queued !== job);
          signal?.removeEventListener('abort', job.abort!);
          reject(new Error('Module inspection canceled.'));
        }
      };
      signal?.addEventListener('abort', job.abort, { once: true });
      this.#queue.push(job);
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#active || !this.#queue.length) return;
    const job = this.#queue.shift()!;
    this.#active = job;
    const id = ++this.#id;
    try {
      if (!this.#worker) {
        const worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
        this.#worker = worker;
        worker.onerror = () => { if (this.#worker === worker) this.#fail(new Error('The libopenmpt decoder worker failed.')); };
        worker.onmessageerror = () => { if (this.#worker === worker) this.#fail(new Error('The libopenmpt decoder response was unreadable.')); };
        worker.onmessage = (event: MessageEvent<ModuleDecodeResponse>) => {
          const response = event.data;
          if (this.#worker !== worker || !this.#active || response.id !== this.#id) return;
          const active = this.#active;
          if ('error' in response) {
            if (active.mode === 'verify') active.resolve(false);
            else active.reject(new Error(response.error));
          } else active.resolve(active.mode === 'verify' ? response.accepted : response.inspection!);
          this.#finish();
        };
      }
      this.#timer = setTimeout(() => this.#fail(new Error('Module inspection timed out.')), 15_000);
      // Ownership transfers to the worker. Callers retain a copy only when needed.
      this.#worker.postMessage({ id, buffer: job.buffer, mode: job.mode, subsong: job.subsong } satisfies ModuleDecodeRequest, [job.buffer]);
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error('Module inspection failed.'));
    }
  }

  #finish(): void {
    clearTimeout(this.#timer);
    const job = this.#active;
    if (job?.abort) job.signal?.removeEventListener('abort', job.abort);
    this.#active = undefined;
    this.#pump();
  }

  #fail(error: Error): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    this.#active?.reject(error);
    this.#finish();
  }

  dispose(): void {
    const queued = this.#queue.splice(0);
    for (const job of queued) {
      if (job.abort) job.signal?.removeEventListener('abort', job.abort);
      job.reject(new Error('Module decoder disposed.'));
    }
    this.#fail(new Error('Module decoder disposed.'));
  }
}

export const moduleDecoder = new ModuleDecoder();
