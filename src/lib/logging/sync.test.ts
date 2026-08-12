import { describe, expect, it, vi } from 'vitest';
import type { ClockPort, IdPort } from '$lib/runtime/ports';
import { ResourceScope } from '$lib/runtime/resource-scope';
import { MAX_LOG_ENTRIES, type LogEntry } from './contracts';
import { createLoggingRuntime, type LogChannel, type LoggingRuntime } from './runtime';

class FakeIds implements IdPort {
  next = 0;
  constructor(private readonly prefix: string) {}
  create(): string { return `${this.prefix}-${++this.next}`; }
}

class FakeClock implements ClockPort {
  monotonic = 0;
  microtasks: Array<() => void> = [];
  constructor(public wall: number) {}
  wallNow(): number { return ++this.wall; }
  monotonicNow(): number { return ++this.monotonic; }
  queueMicrotask(callback: () => void): void { this.microtasks.push(callback); }
  setTimeout(): unknown { return 1; }
  clearTimeout(): void {}
  setInterval(): unknown { return 1; }
  clearInterval(): void {}
  requestAnimationFrame(): unknown { return 1; }
  cancelAnimationFrame(): void {}
  flush(): void { for (const callback of this.microtasks.splice(0)) callback(); }
}

class FakeChannelHub {
  readonly channels = new Set<FakeChannel>();
  readonly messages: Array<{ sender: FakeChannel; message: unknown }> = [];
  readonly deferredResponses: Array<{ sender: FakeChannel; message: unknown }> = [];
  deferHistoryResponses = false;

  create = (): FakeChannel => {
    const channel = new FakeChannel(this);
    this.channels.add(channel);
    return channel;
  };

  post(sender: FakeChannel, message: unknown): void {
    this.messages.push({ sender, message });
    if (this.deferHistoryResponses && message && typeof message === 'object'
      && (message as { type?: unknown }).type === 'history-response') {
      this.deferredResponses.push({ sender, message });
      return;
    }
    this.deliver(sender, message);
  }

  deliver(sender: FakeChannel | null, message: unknown): void {
    for (const channel of [...this.channels]) if (channel !== sender) channel.deliver(message);
  }
}

class FakeChannel implements LogChannel {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  closed = false;
  constructor(private readonly hub: FakeChannelHub) {}
  postMessage(message: unknown): void { this.hub.post(this, message); }
  addEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void { this.listeners.add(listener); }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<unknown>) => void): void { this.listeners.delete(listener); }
  close(): void { this.closed = true; this.listeners.clear(); this.hub.channels.delete(this); }
  deliver(message: unknown): void {
    for (const listener of [...this.listeners]) listener({ data: message } as MessageEvent<unknown>);
  }
}

function createRuntime(hub: FakeChannelHub, context: string, startTime: number) {
  const ids = new FakeIds(context);
  const clock = new FakeClock(startTime);
  const scope = new ResourceScope(`${context} logging`, clock, ids);
  const runtime = createLoggingRuntime({
    context,
    scope,
    clock,
    ids,
    channels: { create: hub.create },
    settings: () => ({ captureDebug: true, mirrorToConsole: false })
  });
  runtime.init();
  return { clock, runtime };
}

describe('cross-context logging', () => {
  it('merges retention-limit history in bounded batches despite reversed and duplicate delivery', () => {
    const hub = new FakeChannelHub();
    const main = createRuntime(hub, 'main', 0);
    const editor = createRuntime(hub, 'editor', MAX_LOG_ENTRIES * 2);
    for (let index = 0; index < MAX_LOG_ENTRIES; index += 1) main.runtime.log('debug', 'system', `main ${index}`);
    for (let index = 0; index < MAX_LOG_ENTRIES; index += 1) editor.runtime.log('debug', 'tools', `editor ${index}`);

    hub.deferHistoryResponses = true;
    const logs = createRuntime(hub, 'logs', MAX_LOG_ENTRIES);
    const snapshots: LogEntry[][] = [];
    logs.runtime.subscribe((entries) => snapshots.push(entries));
    expect(hub.deferredResponses).toHaveLength(2);
    expect(hub.deferredResponses.every(({ message }) =>
      (message as { entries: unknown[] }).entries.length === MAX_LOG_ENTRIES
    )).toBe(true);

    const [first, second] = hub.deferredResponses;
    hub.deliver(second.sender, second.message);
    hub.deliver(first.sender, first.message);
    hub.deliver(first.sender, first.message);
    const replayWithNewMessageId = {
      ...(first.message as Record<string, unknown>),
      messageId: 'replayed-response-with-new-envelope-id'
    };
    hub.deliver(first.sender, replayWithNewMessageId);

    expect(logs.clock.microtasks).toHaveLength(1);
    logs.clock.flush();
    const entries = logs.runtime.getEntries();
    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(new Set(entries.map(({ id }) => id)).size).toBe(MAX_LOG_ENTRIES);
    expect(entries.every(({ context }) => context === 'editor')).toBe(true);
    expect(snapshots).toHaveLength(2);
  });

  it('answers a history request once with only its own bounded entries and ignores stale responses after clear', () => {
    const hub = new FakeChannelHub();
    const main = createRuntime(hub, 'main', 0);
    const editor = createRuntime(hub, 'editor', 100);
    main.runtime.log('info', 'system', 'owned by main');
    editor.runtime.log('info', 'tools', 'owned by editor');

    hub.deferHistoryResponses = true;
    const logs = createRuntime(hub, 'logs', 200);
    logs.runtime.subscribe(() => undefined);
    const responses = hub.deferredResponses.map(({ message }) => message as { originId: string; entries: LogEntry[] });
    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.entries.every((entry) => entry.originId === response.originId))).toBe(true);

    const request = hub.messages.find(({ message }) =>
      message && typeof message === 'object' && (message as { type?: string }).type === 'history-request'
    )?.message;
    expect(request).toBeDefined();
    hub.deliver(null, request);
    expect(hub.deferredResponses).toHaveLength(2);

    logs.runtime.clear();
    for (const response of hub.deferredResponses) hub.deliver(response.sender, response.message);
    expect(logs.runtime.getEntries()).toEqual([]);
  });

  it('stops receiving and answering after destroy even when channel close removes listeners', async () => {
    const hub = new FakeChannelHub();
    const main = createRuntime(hub, 'main', 0);
    const requester = createRuntime(hub, 'logs', 100);
    await main.runtime.destroy();
    const before = hub.messages.length;
    requester.runtime.requestHistory();
    const laterResponses = hub.messages.slice(before).filter(({ message }) =>
      message && typeof message === 'object' && (message as { type?: string }).type === 'history-response'
    );
    expect(laterResponses).toEqual([]);
  });
});

