import { describe, expect, it } from 'vitest';
import {
  createLoggingRuntime,
  MAX_LOG_ENTRIES,
  type LoggingRuntime,
  type LoggingRuntimeOptions
} from './logging';

type MessageListener = (event: MessageEvent<unknown>) => void;

class FakeChannelHub {
  channels: FakeChannel[] = [];
  messages: unknown[] = [];

  create = (): FakeChannel => {
    const channel = new FakeChannel(this);
    this.channels.push(channel);
    return channel;
  };

  deliver(sender: FakeChannel | null, message: unknown): void {
    this.messages.push(message);
    for (const channel of [...this.channels]) {
      if (channel !== sender) channel.deliver(message);
    }
  }
}

class FakeChannel {
  listeners = new Set<MessageListener>();
  closed = false;
  constructor(private hub: FakeChannelHub) {}
  addEventListener(_type: 'message', listener: MessageListener): void { this.listeners.add(listener); }
  removeEventListener(_type: 'message', listener: MessageListener): void { this.listeners.delete(listener); }
  postMessage(message: unknown): void { this.hub.deliver(this, message); }
  deliver(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }
  close(): void { this.closed = true; this.listeners.clear(); }
}

function runtime(hub: FakeChannelHub, options: LoggingRuntimeOptions): LoggingRuntime {
  return createLoggingRuntime({
    channelFactory: hub.create,
    settings: () => ({ captureDebug: true, mirrorToConsole: false }),
    ...options
  });
}

describe('cross-context logging', () => {
  it('exchanges retention-limit history in one bounded batch per origin and deduplicates duplicates', () => {
    const hub = new FakeChannelHub();
    let time = 0;
    const first = runtime(hub, { context: 'main', instanceId: 'main', now: () => ++time });
    const second = runtime(hub, { context: 'editor', instanceId: 'editor', now: () => ++time });
    first.init();
    second.init();

    for (let index = 0; index < MAX_LOG_ENTRIES; index += 1) first.log('debug', 'system', `main ${index}`);
    for (let index = 0; index < MAX_LOG_ENTRIES; index += 1) second.log('debug', 'tools', `editor ${index}`);

    const scheduled: Array<() => void> = [];
    const logs = runtime(hub, {
      context: 'logs', instanceId: 'logs', now: () => ++time,
      scheduleNotification: (callback) => scheduled.push(callback)
    });
    logs.init();
    const snapshots: string[][] = [];
    logs.subscribe((entries) => snapshots.push(entries.map((entry) => entry.id)));

    const responses = hub.messages.filter((message): message is { type: string; entries: unknown[] } =>
      Boolean(message && typeof message === 'object' && (message as { type?: string }).type === 'history-response')
    );
    expect(responses).toHaveLength(2);
    expect(responses.every((response) => response.entries.length === MAX_LOG_ENTRIES)).toBe(true);
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();

    const entries = logs.getEntries();
    expect(entries).toHaveLength(MAX_LOG_ENTRIES);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    const beforeDuplicate = entries.map((entry) => entry.id);
    hub.deliver(null, responses[0]);
    expect(logs.getEntries().map((entry) => entry.id)).toEqual(beforeDuplicate);
    expect(snapshots).toHaveLength(2);
  });

  it('serves only originated entries and stops answering after destroy', () => {
    const hub = new FakeChannelHub();
    const first = runtime(hub, { context: 'main', instanceId: 'main' });
    const second = runtime(hub, { context: 'editor', instanceId: 'editor' });
    first.init();
    second.init();
    first.log('info', 'system', 'owned by main');
    second.log('info', 'tools', 'owned by editor');

    const requester = runtime(hub, { context: 'logs', instanceId: 'requester' });
    requester.subscribe(() => undefined);
    const responses = hub.messages.filter((message) =>
      message && typeof message === 'object' && (message as { type?: string }).type === 'history-response'
    ) as Array<{ responderId: string; entries: Array<{ context: string }> }>;
    expect(responses.find((response) => response.responderId === 'main')?.entries.every((entry) => entry.context === 'main')).toBe(true);
    expect(responses.find((response) => response.responderId === 'editor')?.entries.every((entry) => entry.context === 'editor')).toBe(true);

    first.destroy();
    const responseCount = responses.length;
    requester.requestHistory();
    const nextResponses = hub.messages.filter((message) =>
      message && typeof message === 'object' && (message as { type?: string }).type === 'history-response'
    );
    expect(nextResponses).toHaveLength(responseCount + 1);
  });
});
