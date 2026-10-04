import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModuleDecoder } from './decoder';
import type { ModuleDecodeRequest, ModuleDecodeResponse } from './protocol';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<ModuleDecodeResponse>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.all.push(this); }
  respond(response: Omit<ModuleDecodeResponse, 'id'>): void {
    const request = this.postMessage.mock.lastCall![0] as ModuleDecodeRequest;
    this.onmessage?.({ data: { ...response, id: request.id } } as MessageEvent<ModuleDecodeResponse>);
  }
}

describe('reusable background decoder', () => {
  let decoder: ModuleDecoder;
  beforeEach(() => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.useFakeTimers();
    decoder = new ModuleDecoder();
  });
  afterEach(() => { decoder.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('serializes a bulk request with one worker and treats rejection as invalid', async () => {
    const first = decoder.verify(new ArrayBuffer(4));
    const second = decoder.verify(new ArrayBuffer(8));
    const worker = FakeWorker.all[0];
    expect(FakeWorker.all).toHaveLength(1);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    worker.respond({ accepted: true });
    expect(await first).toBe(true);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.respond({ error: 'invalid module' });
    expect(await second).toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it('terminates a stuck worker and continues queued work with a fresh heap', async () => {
    const first = decoder.verify(new ArrayBuffer(4));
    const failed = expect(first).rejects.toThrow('timed out');
    const next = decoder.inspect(new ArrayBuffer(8));
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(FakeWorker.all[0].terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.all).toHaveLength(2);
    const inspection = { metadata: { channels: 4 }, subsong: 0 };
    FakeWorker.all[1].respond({ accepted: true, inspection });
    expect(await next).toEqual(inspection);
  });

  it('cancels queued pattern work without interrupting active metadata', async () => {
    const first = decoder.inspect(new ArrayBuffer(4));
    const controller = new AbortController();
    const second = decoder.inspect(new ArrayBuffer(8), { patterns: true, signal: controller.signal });
    const canceled = expect(second).rejects.toThrow('canceled');
    controller.abort();
    await canceled;
    const worker = FakeWorker.all[0];
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.respond({ accepted: true, inspection: { metadata: {}, subsong: 0 } });
    await first;
    expect(worker.postMessage).toHaveBeenCalledOnce();
  });

  it('cancels active work, ignores stale responses and recovers from worker errors', async () => {
    const controller = new AbortController();
    const first = decoder.inspect(new ArrayBuffer(4), { signal: controller.signal });
    const canceled = expect(first).rejects.toThrow('canceled');
    const next = decoder.verify(new ArrayBuffer(8));
    const old = FakeWorker.all[0];
    controller.abort();
    await canceled;
    old.respond({ accepted: false });
    old.onerror?.();
    expect(FakeWorker.all[1].terminate).not.toHaveBeenCalled();
    FakeWorker.all[1].respond({ accepted: true });
    expect(await next).toBe(true);
    const third = decoder.verify(new ArrayBuffer(4));
    const failure = expect(third).rejects.toThrow('worker failed');
    FakeWorker.all[1].onerror?.();
    await failure;
    const recovery = decoder.verify(new ArrayBuffer(4));
    FakeWorker.all[2].respond({ accepted: true });
    expect(await recovery).toBe(true);
  });
});
