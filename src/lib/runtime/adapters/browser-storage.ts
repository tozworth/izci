import { DomainError, toDomainError } from '../errors';
import type { KeyValueStorageChange, KeyValueStoragePort } from '../ports';

function storageError(cause: unknown, operation: string, code: string): DomainError {
  const error = toDomainError(cause, operation, code);
  if (error.category !== 'permission') return error;
  return new DomainError({
    category: 'blocked',
    code,
    operation,
    retryable: true,
    cause
  });
}

export class BrowserKeyValueStorage implements KeyValueStoragePort {
  #listeners = new Set<(change: KeyValueStorageChange) => void>();
  #listening = false;
  readonly #storageListener: EventListener;

  constructor(
    private readonly storage: () => Storage,
    private readonly eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  ) {
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
    try {
      return this.storage().getItem(key);
    } catch (cause) {
      throw storageError(cause, `read setting ${key}`, 'runtime.storage-read-failed');
    }
  }

  write(key: string, value: string): void {
    try {
      const storage = this.storage();
      const oldValue = storage.getItem(key);
      storage.setItem(key, value);
      this.#emit({ key, oldValue, newValue: value, source: 'local' });
    } catch (cause) {
      throw storageError(cause, `write setting ${key}`, 'runtime.storage-write-failed');
    }
  }

  remove(key: string): void {
    try {
      const storage = this.storage();
      const oldValue = storage.getItem(key);
      storage.removeItem(key);
      this.#emit({ key, oldValue, newValue: null, source: 'local' });
    } catch (cause) {
      throw storageError(cause, `remove setting ${key}`, 'runtime.storage-remove-failed');
    }
  }

  subscribe(listener: (change: KeyValueStorageChange) => void): () => void {
    this.#listeners.add(listener);
    if (!this.#listening && this.eventTarget) {
      this.eventTarget.addEventListener('storage', this.#storageListener);
      this.#listening = true;
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
      if (this.#listening && this.#listeners.size === 0) {
        this.eventTarget?.removeEventListener('storage', this.#storageListener);
        this.#listening = false;
      }
    };
  }

  #emit(change: KeyValueStorageChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}
