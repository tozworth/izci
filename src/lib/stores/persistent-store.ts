import { writable, type Readable } from 'svelte/store';

interface PersistentStoreOptions<T> {
  storageKey: string;
  channelName: string;
  defaultValue: T;
  normalize: (value: unknown) => T;
}

export interface PersistentStoreController<T> extends Readable<T> {
  getSnapshot(): T;
  set(nextValue: unknown): T;
  update(updater: (currentValue: T) => unknown): T;
  reset(): T;
}

export type SettingsStoreController<T extends object> = Omit<PersistentStoreController<T>, 'update'> & {
  update(patch: Partial<T>): T;
};

export function createSettingsStore<T extends object>(options: PersistentStoreOptions<T>): SettingsStoreController<T> {
  const store = createPersistentStore(options);
  return { ...store, update: (patch) => store.update((value) => ({ ...value, ...patch })) };
}

export function createPersistentStore<T>({
  storageKey,
  channelName,
  defaultValue,
  normalize
}: PersistentStoreOptions<T>): PersistentStoreController<T> {
  let broadcastChannel: BroadcastChannel | null = null;

  function readStoredValue(): T {
    if (typeof window === 'undefined') {
      return defaultValue;
    }

    try {
      const rawValue = window.localStorage.getItem(storageKey);
      return rawValue ? normalize(JSON.parse(rawValue)) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  const store = writable<T>(readStoredValue());
  let currentValue = readStoredValue();

  store.subscribe((value) => {
    currentValue = value;
  });

  function persist(value: T): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(value));
    broadcastChannel?.postMessage(value);
  }

  function setValue(nextValue: unknown): T {
    const normalized = normalize(nextValue);
    store.set(normalized);
    persist(normalized);
    return normalized;
  }

  function setExternalValue(nextValue: unknown): void {
    const normalized = normalize(nextValue);
    if (samePersistentValue(currentValue, normalized)) return;
    store.set(normalized);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== storageKey || !event.newValue) {
        return;
      }

      try {
        setExternalValue(JSON.parse(event.newValue));
      } catch {
        setExternalValue(defaultValue);
      }
    });

    if ('BroadcastChannel' in window) {
      broadcastChannel = new BroadcastChannel(channelName);
      broadcastChannel.addEventListener('message', (event) => {
        setExternalValue(event.data);
      });
    }
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => currentValue,
    set: setValue,
    update: (updater) => setValue(updater(currentValue)),
    reset: () => setValue(defaultValue)
  };
}

export function samePersistentValue(first: unknown, second: unknown): boolean {
  try {
    return JSON.stringify(first) === JSON.stringify(second);
  } catch {
    return false;
  }
}
