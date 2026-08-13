import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorageChange, KeyValueStoragePort } from '$lib/runtime/ports';
import type { SettingsChannel, SettingsChannelPort } from './contracts';
import { createSettingsEngine } from './engine';
import { SettingsRegistry } from './registry';

interface TestSettings {
  enabled: boolean;
  label: string;
}

const DEFAULTS: TestSettings = { enabled: false, label: 'default' };

function normalize(value: unknown): TestSettings {
  const source = value && typeof value === 'object' ? value as Partial<TestSettings> : {};
  return {
    enabled: source.enabled === true,
    label: typeof source.label === 'string' ? source.label : DEFAULTS.label
  };
}

class StorageDouble implements KeyValueStoragePort {
  readonly values = new Map<string, string>();
  readonly listeners = new Set<(change: KeyValueStorageChange) => void>();
  readError: unknown;
  writeError: unknown;

  read(key: string): string | null {
    if (this.readError) throw this.readError;
    return this.values.get(key) ?? null;
  }

  write(key: string, value: string): void {
    if (this.writeError) throw this.writeError;
    const oldValue = this.read(key);
    this.values.set(key, value);
    this.emit({ key, oldValue, newValue: value, source: 'local' });
  }

  remove(key: string): void {
    const oldValue = this.read(key);
    this.values.delete(key);
    this.emit({ key, oldValue, newValue: null, source: 'local' });
  }

  subscribe(listener: (change: KeyValueStorageChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  external(key: string, newValue: string | null): void {
    const oldValue = this.read(key);
    if (newValue === null) this.values.delete(key);
    else this.values.set(key, newValue);
    this.emit({ key, oldValue, newValue, source: 'external' });
  }

  private emit(change: KeyValueStorageChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

class DeferredChannels implements SettingsChannelPort {
  readonly peers = new Map<string, Set<ChannelDouble>>();
  readonly deliveries: Array<() => void> = [];
  postError: unknown;

  open(name: string): SettingsChannel {
    const channel = new ChannelDouble(name, this);
    const peers = this.peers.get(name) ?? new Set<ChannelDouble>();
    peers.add(channel);
    this.peers.set(name, peers);
    return channel;
  }

  deliverAll(): void {
    while (this.deliveries.length > 0) this.deliveries.shift()?.();
  }
}

class ChannelDouble implements SettingsChannel {
  readonly listeners = new Set<(message: unknown) => void>();
  closed = false;

  constructor(readonly name: string, private readonly owner: DeferredChannels) {}

  post(message: unknown): void {
    if (this.owner.postError) throw this.owner.postError;
    for (const peer of this.owner.peers.get(this.name) ?? []) {
      if (peer === this || peer.closed) continue;
      this.owner.deliveries.push(() => {
        for (const listener of [...peer.listeners]) listener(message);
      });
    }
  }

  subscribe(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.owner.peers.get(this.name)?.delete(this);
  }
}

function ids(...values: string[]) {
  let index = 0;
  return { create: () => values[index++] ?? `id-${index}` };
}

function makeStore(
  storage: StorageDouble,
  channels: DeferredChannels,
  idValues: string[],
  registry = new SettingsRegistry()
) {
  const engine = createSettingsEngine({
    storage,
    channels,
    ids: ids(...idValues),
    clock: { wallNow: () => 123 }
  }, registry);
  return engine.createPersistentStore({
    storageKey: 'test.settings',
    channelName: 'test-settings',
    defaultValue: DEFAULTS,
    normalize
  });
}

describe('settings engine', () => {
  it('commits memory only after the durable write succeeds and exposes quota failure', () => {
    const storage = new StorageDouble();
    const store = makeStore(storage, new DeferredChannels(), ['origin', 'message']);
    storage.writeError = new DOMException('full', 'QuotaExceededError');

    expect(() => store.set({ enabled: true, label: 'lost' })).toThrow();
    expect(store.getSnapshot()).toEqual(DEFAULTS);
    expect(store.getStatus()).toMatchObject({ state: 'degraded', revision: 0 });
    expect(store.getStatus().error?.category).toBe('quota');
  });

  it('starts with normalized defaults and observable status when storage is unavailable', () => {
    const storage = new StorageDouble();
    storage.readError = new DOMException('disabled', 'NotSupportedError');

    const store = makeStore(storage, new DeferredChannels(), ['origin']);

    expect(store.getSnapshot()).toEqual(DEFAULTS);
    expect(store.getStatus().state).toBe('degraded');
    expect(store.getStatus().error?.category).toBe('unavailable');
    expect(store.getStatus().hasPersistedValue).toBe(false);
  });

  it('scorches an incompatible pre-envelope value into the current normalized schema', () => {
    const storage = new StorageDouble();
    storage.values.set('test.settings', JSON.stringify({ enabled: true, label: 'legacy' }));
    const store = makeStore(storage, new DeferredChannels(), ['origin', 'replacement']);

    expect(store.getSnapshot()).toEqual(DEFAULTS);
    expect(store.getStatus()).toMatchObject({
      state: 'degraded',
      revision: 1,
      messageId: 'replacement',
      hasPersistedValue: true
    });
    expect(store.getStatus().error?.code).toBe('settings.invalid-snapshot');
    expect(JSON.parse(storage.read('test.settings')!)).toMatchObject({
      originId: 'origin',
      messageId: 'replacement',
      value: DEFAULTS
    });
  });

  it('converges simultaneous crossed writers by revision, origin, and message order', () => {
    const storage = new StorageDouble();
    const channels = new DeferredChannels();
    const first = makeStore(storage, channels, ['a-origin', 'a-message'], new SettingsRegistry());
    const second = makeStore(storage, channels, ['z-origin', 'z-message'], new SettingsRegistry());

    first.set({ enabled: true, label: 'first' });
    second.set({ enabled: false, label: 'second' });
    channels.deliverAll();

    expect(first.getSnapshot()).toEqual({ enabled: false, label: 'second' });
    expect(second.getSnapshot()).toEqual(first.getSnapshot());
    expect(JSON.parse(storage.read('test.settings')!)).toMatchObject({
      originId: 'z-origin',
      messageId: 'z-message',
      value: { enabled: false, label: 'second' }
    });
  });

  it('suppresses duplicate channel and storage delivery', () => {
    const storage = new StorageDouble();
    const channels = new DeferredChannels();
    const first = makeStore(storage, channels, ['a', 'a-write'], new SettingsRegistry());
    const second = makeStore(storage, channels, ['b'], new SettingsRegistry());
    const snapshots: TestSettings[] = [];
    second.subscribe((value) => snapshots.push(value));

    first.set({ enabled: true, label: 'shared' });
    const raw = storage.read('test.settings')!;
    channels.deliverAll();
    storage.external('test.settings', raw);

    expect(snapshots).toEqual([DEFAULTS, { enabled: true, label: 'shared' }]);
  });

  it('turns external removal into a normalized, synchronized reset snapshot', () => {
    const storage = new StorageDouble();
    const channels = new DeferredChannels();
    const store = makeStore(storage, channels, ['origin', 'write', 'reset']);
    store.set({ enabled: true, label: 'custom' });

    storage.external('test.settings', null);

    expect(store.getSnapshot()).toEqual(DEFAULTS);
    expect(JSON.parse(storage.read('test.settings')!)).toMatchObject({
      revision: 2,
      messageId: 'reset',
      value: DEFAULTS
    });
  });

  it('keeps the accepted stored write while surfacing a channel transport failure', () => {
    const storage = new StorageDouble();
    const channels = new DeferredChannels();
    channels.postError = new Error('channel failed');
    const store = makeStore(storage, channels, ['origin', 'write']);

    expect(store.set({ enabled: true, label: 'stored' })).toEqual({ enabled: true, label: 'stored' });
    expect(storage.read('test.settings')).not.toBeNull();
    expect(store.getStatus()).toMatchObject({ state: 'degraded', revision: 1 });
    expect(store.getStatus().error?.code).toBe('settings.channel-post-failed');
  });

  it('disposes subscriptions and channels exactly once', () => {
    const storage = new StorageDouble();
    const channels = new DeferredChannels();
    const store = makeStore(storage, channels, ['origin']);
    const channel = [...channels.peers.get('test-settings')!][0];

    store.dispose();
    store.dispose();
    storage.external('test.settings', JSON.stringify({
      value: { enabled: true, label: 'late' },
      originId: 'other', revision: 1, messageId: 'late', writtenAt: 1
    }));

    expect(store.getStatus().state).toBe('disposed');
    expect(store.getSnapshot()).toEqual(DEFAULTS);
    expect(storage.listeners.size).toBe(0);
    expect(channel.closed).toBe(true);
    expect(() => store.reset()).toThrow(/disposed/);
  });

  it('registers live owners for export, restore, reset, flush, and disposal', () => {
    const registry = new SettingsRegistry();
    const store = makeStore(new StorageDouble(), new DeferredChannels(), ['origin', 'restore', 'reset'], registry);
    const flush = vi.spyOn(store, 'flush');

    expect(registry.list()).toEqual([{ storageKey: 'test.settings', channelName: 'test-settings' }]);
    registry.restore('test.settings', { enabled: true, label: 'restored' });
    expect(registry.exportValues()).toEqual({
      'test.settings': { enabled: true, label: 'restored' }
    });
    registry.flushAll();
    expect(flush).toHaveBeenCalledOnce();
    registry.reset('test.settings');
    expect(store.getSnapshot()).toEqual(DEFAULTS);
    registry.disposeAll();
    expect(registry.list()).toEqual([]);
  });
});
