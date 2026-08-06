import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// NOTE: this file intentionally has NO static import of './logging' — the
// cross-window tests need genuinely separate module instances, which requires
// vi.resetModules() + dynamic imports. A static import would pin a module
// record and break instance separation.

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];

  static reset(): void {
    FakeBroadcastChannel.instances = [];
  }

  name: string;
  listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  postMessage(message: unknown): void {
    // Real BroadcastChannel never delivers to the sender; simulate that here.
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this) continue;
      for (const listener of instance.listeners) {
        listener({ data: message } as MessageEvent);
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((instance) => instance !== this);
  }
}

type LoggingModule = typeof import('./logging');

async function freshWindow(): Promise<LoggingModule> {
  vi.resetModules();
  return await import('./logging');
}

beforeEach(() => {
  FakeBroadcastChannel.reset();
  (globalThis as Record<string, unknown>).BroadcastChannel = FakeBroadcastChannel;
});

afterEach(() => {
  vi.resetModules();
});

describe('cross-window log sync', () => {
  it('shares entries between module instances without duplicates', async () => {
    const first = await freshWindow();
    const second = await freshWindow();

    // Both windows must have their channels open (as initLogging does at startup).
    first.initLogging();
    second.initLogging();

    first.logInfo('multiplayer', 'host started', { inviteCode: 'ABCD' });
    second.logInfo('freeplay', 'client joined');

    for (const instance of [first, second]) {
      const list = instance.getLogEntries();
      expect(list.some((entry) => entry.message === 'host started')).toBe(true);
      expect(list.some((entry) => entry.message === 'client joined')).toBe(true);
      const ids = list.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('serves buffered history to a window that requests it (Logs popup open)', async () => {
    const first = await freshWindow();
    const second = await freshWindow();

    // The main window logs while the popup is not open yet.
    first.logWarning('decode', 'probe failed');
    expect(second.getLogEntries()).toHaveLength(0);

    // The Logs popup opens: initLogging asks other windows for history.
    second.initLogging();
    const probeEntries = second.getLogEntries().filter((entry) => entry.message === 'probe failed');
    expect(probeEntries).toHaveLength(1);
    expect(second.getLogEntries()).toHaveLength(2); // own startup banner + requested history, no dupes
  });

  it('ignores malformed channel messages', async () => {
    const first = await freshWindow();
    const second = await freshWindow();
    first.initLogging();
    second.initLogging();

    const before = first.getLogEntries().length + second.getLogEntries().length;

    const malformed = [
      null,
      undefined,
      { type: 'entry' },
      { type: 'entry', entry: { message: 'no id' } },
      { type: 'entry', entry: { id: 'x:1', message: 42, level: 'info', source: 'system', timestamp: 1, window: 'main' } },
      { type: 'entry', entry: { id: 'x:1', message: 'unknown level', level: 'verbose', source: 'system', timestamp: 1, window: 'main' } },
      { type: 'bogus' }
    ];

    for (const message of malformed) {
      for (const instance of FakeBroadcastChannel.instances) {
        instance.listeners.forEach((listener) => {
          listener({ data: message } as MessageEvent);
        });
      }
    }

    expect(first.getLogEntries().length + second.getLogEntries().length).toBe(before);
  });
});
