import type { KeyValueStorageChange, KeyValueStoragePort } from '$lib/runtime/ports';
import type { SettingsChannel, SettingsChannelPort } from './contracts';
import { createSettingsEngine } from './engine';
import { SettingsRegistry } from './registry';

interface BrowserSettingsTarget extends EventTarget {
  readonly localStorage?: Storage;
  readonly crypto?: Crypto;
  readonly BroadcastChannel?: typeof BroadcastChannel;
}

class MemoryStorage implements KeyValueStoragePort {
  readonly #values = new Map<string, string>();
  readonly #listeners = new Set<(change: KeyValueStorageChange) => void>();

  read(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  write(key: string, value: string): void {
    const oldValue = this.read(key);
    this.#values.set(key, value);
    for (const listener of this.#listeners) {
      listener({ key, oldValue, newValue: value, source: 'local' });
    }
  }

  remove(key: string): void {
    const oldValue = this.read(key);
    this.#values.delete(key);
    for (const listener of this.#listeners) {
      listener({ key, oldValue, newValue: null, source: 'local' });
    }
  }

  subscribe(listener: (change: KeyValueStorageChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

class BrowserSettingsStorage implements KeyValueStoragePort {
  readonly #listeners = new Set<(change: KeyValueStorageChange) => void>();
  readonly #storageListener: EventListener;
  #listening = false;

  constructor(private readonly target: BrowserSettingsTarget) {
    this.#storageListener = (event) => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key === null) return;
      this.#emit({
        key: storageEvent.key,
        oldValue: storageEvent.oldValue,
        newValue: storageEvent.newValue,
        source: 'external'
      });
    };
  }

  read(key: string): string | null {
    if (!this.target.localStorage) throw new DOMException('Storage is unavailable', 'NotSupportedError');
    return this.target.localStorage.getItem(key);
  }

  write(key: string, value: string): void {
    if (!this.target.localStorage) throw new DOMException('Storage is unavailable', 'NotSupportedError');
    const oldValue = this.target.localStorage.getItem(key);
    this.target.localStorage.setItem(key, value);
    this.#emit({ key, oldValue, newValue: value, source: 'local' });
  }

  remove(key: string): void {
    if (!this.target.localStorage) throw new DOMException('Storage is unavailable', 'NotSupportedError');
    const oldValue = this.target.localStorage.getItem(key);
    this.target.localStorage.removeItem(key);
    this.#emit({ key, oldValue, newValue: null, source: 'local' });
  }

  subscribe(listener: (change: KeyValueStorageChange) => void): () => void {
    this.#listeners.add(listener);
    if (!this.#listening) {
      this.target.addEventListener('storage', this.#storageListener);
      this.#listening = true;
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
      if (this.#listening && this.#listeners.size === 0) {
        this.target.removeEventListener('storage', this.#storageListener);
        this.#listening = false;
      }
    };
  }

  #emit(change: KeyValueStorageChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

class BrowserSettingsChannel implements SettingsChannel {
  constructor(private readonly channel: BroadcastChannel) {}

  post(message: unknown): void {
    this.channel.postMessage(message);
  }

  subscribe(listener: (message: unknown) => void): () => void {
    const handleMessage = (event: MessageEvent) => listener(event.data);
    this.channel.addEventListener('message', handleMessage);
    return () => this.channel.removeEventListener('message', handleMessage);
  }

  close(): void {
    this.channel.close();
  }
}

class BrowserSettingsChannels implements SettingsChannelPort {
  constructor(private readonly target: BrowserSettingsTarget | null) {}

  open(name: string): SettingsChannel | null {
    const Constructor = this.target?.BroadcastChannel;
    return Constructor ? new BrowserSettingsChannel(new Constructor(name)) : null;
  }
}

let fallbackId = 0;
const target = typeof window === 'undefined' ? null : window as unknown as BrowserSettingsTarget;
const storage = target ? new BrowserSettingsStorage(target) : new MemoryStorage();
export const settingsRegistry = new SettingsRegistry();
const browserEngine = createSettingsEngine({
  clock: { wallNow: () => Date.now() },
  ids: {
    create: () => target?.crypto?.randomUUID?.()
      ?? `settings-${Date.now().toString(36)}-${(++fallbackId).toString(36)}`
  },
  storage,
  channels: new BrowserSettingsChannels(target)
}, settingsRegistry);

export const createPersistentStore = browserEngine.createPersistentStore;
export const createSettingsStore = browserEngine.createSettingsStore;
