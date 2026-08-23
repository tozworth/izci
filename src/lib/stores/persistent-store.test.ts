import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPersistentStore, samePersistentValue } from './persistent-store';

interface TestSettings {
  enabled: boolean;
  label: string;
}

type StorageListener = (event: Pick<StorageEvent, 'key' | 'newValue'>) => void;
type MessageListener = (event: Pick<MessageEvent, 'data'>) => void;

class DeferredBroadcastChannel {
  static channels: DeferredBroadcastChannel[] = [];
  static deliveries: Array<() => void> = [];

  readonly name: string;
  private readonly listeners: MessageListener[] = [];

  constructor(name: string) {
    this.name = name;
    DeferredBroadcastChannel.channels.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type === 'message' && typeof listener === 'function') {
      this.listeners.push(listener as unknown as MessageListener);
    }
  }

  postMessage(data: unknown): void {
    for (const channel of DeferredBroadcastChannel.channels) {
      if (channel === this || channel.name !== this.name) continue;
      DeferredBroadcastChannel.deliveries.push(() => {
        for (const listener of channel.listeners) listener({ data });
      });
    }
  }

  static deliverNext(): void {
    DeferredBroadcastChannel.deliveries.shift()?.();
  }

  static reset(): void {
    DeferredBroadcastChannel.channels.length = 0;
    DeferredBroadcastChannel.deliveries.length = 0;
  }
}

function installWindowHarness() {
  const values = new Map<string, string>();
  const storageListeners: StorageListener[] = [];
  const localStorage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value))
  };

  vi.stubGlobal('window', {
    localStorage,
    BroadcastChannel: DeferredBroadcastChannel,
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === 'storage') storageListeners.push(listener);
    }
  });
  vi.stubGlobal('BroadcastChannel', DeferredBroadcastChannel);

  return {
    localStorage,
    dispatchStorage(key: string, newValue: string | null) {
      for (const listener of storageListeners) listener({ key, newValue });
    }
  };
}

const defaults: TestSettings = { enabled: false, label: 'default' };

function normalizeSettings(value: unknown): TestSettings {
  const source = value && typeof value === 'object' ? value as Partial<TestSettings> : {};
  return {
    enabled: source.enabled === true,
    label: typeof source.label === 'string' ? source.label : defaults.label
  };
}

function createTestStore() {
  return createPersistentStore({
    storageKey: 'test.settings',
    channelName: 'test-settings',
    defaultValue: defaults,
    normalize: normalizeSettings
  });
}

afterEach(() => {
  DeferredBroadcastChannel.reset();
  vi.unstubAllGlobals();
});

describe('samePersistentValue', () => {
  it('treats separately normalized copies as the same persisted value', () => {
    const first = { enabled: true, effects: [{ id: 'eq', gains: [0, -2.5] }] };
    const second = JSON.parse(JSON.stringify(first));

    expect(samePersistentValue(first, second)).toBe(true);
    expect(samePersistentValue(first, { ...second, enabled: false })).toBe(false);
  });
});

describe('persistent store cross-window characterization', () => {
  it('hydrates the initial store and snapshot from one storage read', () => {
    const windowHarness = installWindowHarness();
    windowHarness.localStorage.getItem.mockReturnValue(JSON.stringify({
      enabled: true,
      label: 'stored'
    }));

    const store = createTestStore();
    const snapshots: TestSettings[] = [];
    store.subscribe((value) => snapshots.push(value));

    expect(windowHarness.localStorage.getItem).toHaveBeenCalledOnce();
    expect(snapshots).toEqual([{ enabled: true, label: 'stored' }]);
    expect(store.getSnapshot()).toEqual({ enabled: true, label: 'stored' });
  });

  it('delivers a local update once when BroadcastChannel and storage carry the same value', () => {
    const windowHarness = installWindowHarness();
    const first = createTestStore();
    const second = createTestStore();
    const firstSnapshots: TestSettings[] = [];
    const secondSnapshots: TestSettings[] = [];
    first.subscribe((value) => firstSnapshots.push(value));
    second.subscribe((value) => secondSnapshots.push(value));

    first.set({ enabled: true, label: 'shared' });
    DeferredBroadcastChannel.deliverNext();
    windowHarness.dispatchStorage(
      'test.settings',
      JSON.stringify({ enabled: true, label: 'shared' })
    );

    expect(firstSnapshots).toEqual([
      defaults,
      { enabled: true, label: 'shared' }
    ]);
    expect(secondSnapshots).toEqual([
      defaults,
      { enabled: true, label: 'shared' }
    ]);
    expect(windowHarness.localStorage.setItem).toHaveBeenCalledOnce();
  });

  it('exposes divergent whole-object state when simultaneous writers receive crossed broadcasts', () => {
    installWindowHarness();
    const first = createTestStore();
    const second = createTestStore();

    first.set({ enabled: true, label: 'first' });
    second.set({ enabled: false, label: 'second' });

    expect(first.getSnapshot()).toEqual({ enabled: true, label: 'first' });
    expect(second.getSnapshot()).toEqual({ enabled: false, label: 'second' });

    DeferredBroadcastChannel.deliverNext();
    DeferredBroadcastChannel.deliverNext();

    expect(first.getSnapshot()).toEqual({ enabled: false, label: 'second' });
    expect(second.getSnapshot()).toEqual({ enabled: true, label: 'first' });
  });
});
