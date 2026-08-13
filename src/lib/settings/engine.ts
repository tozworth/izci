import { writable } from 'svelte/store';
import { DomainError, toDomainError } from '$lib/runtime/errors';
import type { KeyValueStorageChange } from '$lib/runtime/ports';
import type {
  PersistentStoreController,
  PersistentStoreOptions,
  SettingsEnginePorts,
  SettingsSnapshot,
  SettingsStoreController,
  SettingsStoreStatus
} from './contracts';
import { SettingsRegistry } from './registry';

const SEEN_MESSAGE_LIMIT = 256;

class BoundedMessageIds {
  readonly #ids = new Set<string>();
  readonly #order: string[] = [];

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  add(id: string): void {
    if (this.#ids.has(id)) return;
    this.#ids.add(id);
    this.#order.push(id);
    if (this.#order.length <= SEEN_MESSAGE_LIMIT) return;
    const removed = this.#order.shift();
    if (removed !== undefined) this.#ids.delete(removed);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeSnapshot<T>(raw: unknown, normalize: (value: unknown) => T): SettingsSnapshot<T> | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.originId !== 'string' || raw.originId.length === 0) return null;
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) return null;
  if (typeof raw.messageId !== 'string' || raw.messageId.length === 0) return null;
  if (typeof raw.writtenAt !== 'number' || !Number.isFinite(raw.writtenAt)) return null;
  if (!('value' in raw)) return null;
  return {
    value: normalize(raw.value),
    originId: raw.originId,
    revision: raw.revision as number,
    messageId: raw.messageId,
    writtenAt: raw.writtenAt
  };
}

function parseSnapshot<T>(raw: string, normalize: (value: unknown) => T): SettingsSnapshot<T> | null {
  try {
    return decodeSnapshot(JSON.parse(raw) as unknown, normalize);
  } catch {
    return null;
  }
}

function compareSnapshots(first: SettingsSnapshot<unknown>, second: SettingsSnapshot<unknown>): number {
  if (first.revision !== second.revision) return first.revision - second.revision;
  const originOrder = first.originId.localeCompare(second.originId);
  if (originOrder !== 0) return originOrder;
  return first.messageId.localeCompare(second.messageId);
}

function sameValue(first: unknown, second: unknown): boolean {
  try {
    return JSON.stringify(first) === JSON.stringify(second);
  } catch {
    return false;
  }
}

function settingsError(cause: unknown, operation: string, code: string): DomainError {
  return toDomainError(cause, operation, code);
}

function corruptionError(operation: string): DomainError {
  return new DomainError({
    category: 'corruption',
    code: 'settings.invalid-snapshot',
    operation,
    retryable: false,
    message: 'The stored settings snapshot does not match the current schema'
  });
}

export interface SettingsEngine {
  createPersistentStore<T>(options: PersistentStoreOptions<T>): PersistentStoreController<T>;
  createSettingsStore<T extends object>(options: PersistentStoreOptions<T>): SettingsStoreController<T>;
}

export function createSettingsEngine(
  ports: SettingsEnginePorts,
  registry = new SettingsRegistry()
): SettingsEngine {
  function createPersistentStore<T>({
    storageKey,
    channelName,
    defaultValue,
    normalize
  }: PersistentStoreOptions<T>): PersistentStoreController<T> {
    const originId = ports.ids.create();
    const seenMessageIds = new BoundedMessageIds();
    let currentSnapshot: SettingsSnapshot<T> | null = null;
    let currentValue = normalize(defaultValue);
    let revision = 0;
    let disposed = false;
    let storageUnsubscribe: () => void = () => undefined;
    let channelUnsubscribe: () => void = () => undefined;
    let channel: ReturnType<SettingsEnginePorts['channels']['open']> = null;
    let unregister: () => void = () => undefined;

    let initialError: DomainError | null = null;
    try {
      const raw = ports.storage.read(storageKey);
      if (raw !== null) {
        const snapshot = parseSnapshot(raw, normalize);
        if (snapshot) {
          currentSnapshot = snapshot;
          currentValue = snapshot.value;
          revision = snapshot.revision;
          seenMessageIds.add(snapshot.messageId);
        } else {
          initialError = corruptionError(`read setting ${storageKey}`);
          try {
            const replacement: SettingsSnapshot<T> = {
              value: currentValue,
              originId,
              revision: 1,
              messageId: ports.ids.create(),
              writtenAt: ports.clock.wallNow()
            };
            ports.storage.write(storageKey, JSON.stringify(replacement));
            currentSnapshot = replacement;
            revision = replacement.revision;
            seenMessageIds.add(replacement.messageId);
          } catch (cause) {
            initialError = settingsError(
              cause,
              `replace incompatible setting ${storageKey}`,
              'settings.write-failed'
            );
          }
        }
      }
    } catch (cause) {
      initialError = settingsError(cause, `read setting ${storageKey}`, 'settings.read-failed');
    }

    const valueStore = writable(currentValue);
    let currentStatus: SettingsStoreStatus = {
      state: initialError ? 'degraded' : 'ready',
      error: initialError,
      originId,
      revision,
      messageId: currentSnapshot?.messageId ?? null,
      hasPersistedValue: currentSnapshot !== null
    };
    const statusStore = writable(currentStatus);

    function updateStatus(error: DomainError | null = null): void {
      currentStatus = {
        state: disposed ? 'disposed' : error ? 'degraded' : 'ready',
        error,
        originId,
        revision,
        messageId: currentSnapshot?.messageId ?? null,
        hasPersistedValue: currentSnapshot !== null
      };
      statusStore.set(currentStatus);
    }

    function assertActive(operation: string): void {
      if (!disposed) return;
      throw new DomainError({
        category: 'stale',
        code: 'settings.store-disposed',
        operation,
        retryable: false,
        message: `The settings owner for ${storageKey} has been disposed`
      });
    }

    function serialize(snapshot: SettingsSnapshot<T>): string {
      try {
        return JSON.stringify(snapshot);
      } catch (cause) {
        throw settingsError(cause, `serialize setting ${storageKey}`, 'settings.serialize-failed');
      }
    }

    function makeSnapshot(value: T): SettingsSnapshot<T> {
      revision += 1;
      return {
        value,
        originId,
        revision,
        messageId: ports.ids.create(),
        writtenAt: ports.clock.wallNow()
      };
    }

    function publish(snapshot: SettingsSnapshot<T>): void {
      if (!channel) return;
      try {
        channel.post(snapshot);
      } catch (cause) {
        updateStatus(settingsError(cause, `broadcast setting ${storageKey}`, 'settings.channel-post-failed'));
      }
    }

    function commit(snapshot: SettingsSnapshot<T>): void {
      const valueChanged = !sameValue(currentValue, snapshot.value);
      currentSnapshot = snapshot;
      currentValue = snapshot.value;
      revision = Math.max(revision, snapshot.revision);
      seenMessageIds.add(snapshot.messageId);
      if (valueChanged) valueStore.set(snapshot.value);
      updateStatus();
    }

    function reassertCurrentSnapshot(): void {
      if (!currentSnapshot || disposed) return;
      try {
        const serialized = serialize(currentSnapshot);
        if (ports.storage.read(storageKey) !== serialized) {
          ports.storage.write(storageKey, serialized);
        }
      } catch (cause) {
        updateStatus(settingsError(cause, `reassert setting ${storageKey}`, 'settings.reassert-failed'));
      }
    }

    function applyExternalSnapshot(snapshot: SettingsSnapshot<T>): void {
      if (disposed || seenMessageIds.has(snapshot.messageId)) return;
      seenMessageIds.add(snapshot.messageId);
      revision = Math.max(revision, snapshot.revision);

      if (!currentSnapshot || compareSnapshots(snapshot, currentSnapshot) > 0) {
        commit(snapshot);
      }
      reassertCurrentSnapshot();
    }

    function applyExternalValue(value: unknown, operation: string): void {
      let snapshot: SettingsSnapshot<T> | null;
      try {
        snapshot = decodeSnapshot(value, normalize);
      } catch (cause) {
        updateStatus(settingsError(cause, operation, 'settings.normalize-failed'));
        return;
      }
      if (!snapshot) {
        updateStatus(corruptionError(operation));
        return;
      }
      applyExternalSnapshot(snapshot);
    }

    function handleRemoval(): void {
      if (disposed) return;
      let normalized: T;
      try {
        normalized = normalize(defaultValue);
      } catch (cause) {
        updateStatus(settingsError(cause, `reset removed setting ${storageKey}`, 'settings.normalize-failed'));
        return;
      }
      const snapshot = makeSnapshot(normalized);
      try {
        ports.storage.write(storageKey, serialize(snapshot));
      } catch (cause) {
        revision -= 1;
        updateStatus(settingsError(cause, `reset removed setting ${storageKey}`, 'settings.write-failed'));
        return;
      }
      commit(snapshot);
      publish(snapshot);
    }

    function handleStorageChange(change: KeyValueStorageChange): void {
      if (disposed || change.source === 'local' || change.key !== storageKey) return;
      if (change.newValue === null) {
        handleRemoval();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(change.newValue) as unknown;
      } catch {
        updateStatus(corruptionError(`receive stored setting ${storageKey}`));
        return;
      }
      applyExternalValue(parsed, `receive stored setting ${storageKey}`);
    }

    function setValue(nextValue: unknown): T {
      assertActive(`write setting ${storageKey}`);
      let normalized: T;
      try {
        normalized = normalize(nextValue);
      } catch (cause) {
        const error = settingsError(cause, `normalize setting ${storageKey}`, 'settings.normalize-failed');
        updateStatus(error);
        throw error;
      }
      const previousRevision = revision;
      const snapshot = makeSnapshot(normalized);
      try {
        ports.storage.write(storageKey, serialize(snapshot));
      } catch (cause) {
        revision = previousRevision;
        const error = settingsError(cause, `write setting ${storageKey}`, 'settings.write-failed');
        updateStatus(error);
        throw error;
      }
      commit(snapshot);
      publish(snapshot);
      return normalized;
    }

    const controller: PersistentStoreController<T> = {
      storageKey,
      channelName,
      subscribe: valueStore.subscribe,
      status: { subscribe: statusStore.subscribe },
      getSnapshot: () => currentValue,
      getStatus: () => currentStatus,
      set: setValue,
      update: (updater) => setValue(updater(currentValue)),
      reset: () => setValue(defaultValue),
      flush: () => undefined,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        unregister();
        storageUnsubscribe();
        channelUnsubscribe();
        try {
          channel?.close();
          updateStatus();
        } catch (cause) {
          updateStatus(settingsError(cause, `close settings channel ${channelName}`, 'settings.channel-close-failed'));
        }
      }
    };

    unregister = registry.register(controller);

    try {
      storageUnsubscribe = ports.storage.subscribe(handleStorageChange);
    } catch (cause) {
      updateStatus(settingsError(cause, `subscribe to setting ${storageKey}`, 'settings.storage-subscribe-failed'));
    }

    try {
      channel = ports.channels.open(channelName);
      if (channel) {
        channelUnsubscribe = channel.subscribe((message) => {
          applyExternalValue(message, `receive broadcast setting ${storageKey}`);
        });
      }
    } catch (cause) {
      channel = null;
      updateStatus(settingsError(cause, `open settings channel ${channelName}`, 'settings.channel-open-failed'));
    }

    return controller;
  }

  return {
    createPersistentStore,
    createSettingsStore<T extends object>(options: PersistentStoreOptions<T>): SettingsStoreController<T> {
      const store = createPersistentStore(options);
      return { ...store, update: (patch) => store.update((value) => ({ ...value, ...patch })) };
    }
  };
}

export function samePersistentValue(first: unknown, second: unknown): boolean {
  return sameValue(first, second);
}
