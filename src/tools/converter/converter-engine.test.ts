import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONVERTER_SETTINGS } from './converter-options';
import { convertMediaFile, runConcurrent, type ConverterProgress } from './converter-engine';

class WorkerDouble {
  static instances: WorkerDouble[] = [];

  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() {
    WorkerDouble.instances.push(this);
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }
}

function latestWorker(): WorkerDouble {
  const instance = WorkerDouble.instances.at(-1);
  if (!instance) throw new Error('Expected a conversion worker.');
  return instance;
}

describe('converter worker cancellation', () => {
  beforeEach(() => {
    WorkerDouble.instances = [];
    vi.stubGlobal('Worker', WorkerDouble);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('terminates without posting work when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const conversion = convertMediaFile(
      new File(['audio'], 'track.mp3'),
      DEFAULT_CONVERTER_SETTINGS,
      controller.signal
    );
    const currentWorker = latestWorker();

    await expect(conversion).rejects.toMatchObject({ name: 'AbortError' });
    expect(currentWorker.postMessage).not.toHaveBeenCalled();
    expect(currentWorker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates a running worker, rejects, and ignores later worker messages', async () => {
    const controller = new AbortController();
    const progress: ConverterProgress[] = [];
    const conversion = convertMediaFile(
      new File(['audio'], 'track.mp3'),
      DEFAULT_CONVERTER_SETTINGS,
      controller.signal,
      (value) => progress.push(value)
    );
    const currentWorker = latestWorker();
    currentWorker.emit({ type: 'progress', progress: 0.5 });

    controller.abort();
    await expect(conversion).rejects.toMatchObject({ name: 'AbortError' });
    currentWorker.emit({
      type: 'complete',
      buffer: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'audio/flac'
    });

    expect(progress).toEqual([{ phase: 'converting', progress: 0.5 }]);
    expect(currentWorker.terminate).toHaveBeenCalledOnce();
  });

  it('removes cancellation ownership after a late successful completion', async () => {
    const controller = new AbortController();
    const conversion = convertMediaFile(
      new File(['audio'], 'track.mp3'),
      DEFAULT_CONVERTER_SETTINGS,
      controller.signal
    );
    const currentWorker = latestWorker();
    currentWorker.emit({
      type: 'complete',
      buffer: new Uint8Array([1, 2, 3]).buffer,
      mimeType: 'audio/flac'
    });

    await expect(conversion).resolves.toMatchObject({ size: 3, type: 'audio/flac' });
    controller.abort();

    expect(currentWorker.terminate).toHaveBeenCalledOnce();
  });

  it('terminates and rejects when the worker itself fails', async () => {
    const conversion = convertMediaFile(
      new File(['audio'], 'track.mp3'),
      DEFAULT_CONVERTER_SETTINGS,
      new AbortController().signal
    );
    const currentWorker = latestWorker();
    currentWorker.fail();

    await expect(conversion).rejects.toThrow('failed to start');
    expect(currentWorker.terminate).toHaveBeenCalledOnce();
  });
});

describe('converter concurrency pool', () => {
  it('honors the requested parallel job limit', async () => {
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await runConcurrent([0, 1, 2, 3, 4], 2, new AbortController().signal, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    });
    expect(maximumActive).toBe(2);
    expect(completed.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not start work after cancellation', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await runConcurrent([0, 1, 2], 1, controller.signal, async (item) => {
      started.push(item);
      controller.abort();
    });
    expect(started).toEqual([0]);
  });

  it('lets already-started work settle after cancellation without dequeuing more items', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const releases: Array<() => void> = [];
    const running = runConcurrent([0, 1, 2, 3], 2, controller.signal, async (item) => {
      started.push(item);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    await vi.waitFor(() => expect(started).toEqual([0, 1]));
    controller.abort();
    releases.splice(0).forEach((release) => release());
    await running;

    expect(started).toEqual([0, 1]);
  });
});
