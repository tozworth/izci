import { DomainError } from '$lib/runtime/errors';
import type { PersistentStoreController } from './contracts';

export interface SettingsDescriptor {
  readonly storageKey: string;
  readonly channelName: string;
}

export interface RegisteredSettingsController extends SettingsDescriptor {
  getSnapshot(): unknown;
  set(value: unknown): unknown;
  reset(): unknown;
  flush(): void;
  dispose(): void;
}

function cloneJsonValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export class SettingsRegistry {
  readonly #controllers = new Map<string, RegisteredSettingsController>();

  register<T>(controller: PersistentStoreController<T>): () => void {
    const existing = this.#controllers.get(controller.storageKey);
    if (existing) {
      throw new DomainError({
        category: 'conflict',
        code: 'settings.duplicate-owner',
        operation: `register setting ${controller.storageKey}`,
        retryable: false,
        message: `A live settings owner already controls ${controller.storageKey}`
      });
    }

    this.#controllers.set(controller.storageKey, controller);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#controllers.get(controller.storageKey) === controller) {
        this.#controllers.delete(controller.storageKey);
      }
    };
  }

  list(): SettingsDescriptor[] {
    return Array.from(this.#controllers.values(), ({ storageKey, channelName }) => ({
      storageKey,
      channelName
    })).sort((left, right) => left.storageKey.localeCompare(right.storageKey));
  }

  get(storageKey: string): RegisteredSettingsController | null {
    return this.#controllers.get(storageKey) ?? null;
  }

  exportValues(): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const descriptor of this.list()) {
      values[descriptor.storageKey] = cloneJsonValue(
        this.#controllers.get(descriptor.storageKey)?.getSnapshot()
      );
    }
    return values;
  }

  restore(storageKey: string, value: unknown): unknown {
    const controller = this.require(storageKey, 'restore');
    return controller.set(cloneJsonValue(value));
  }

  reset(storageKey: string): unknown {
    return this.require(storageKey, 'reset').reset();
  }

  flushAll(): void {
    for (const controller of this.#controllers.values()) controller.flush();
  }

  disposeAll(): void {
    for (const controller of Array.from(this.#controllers.values())) controller.dispose();
  }

  #requireMessage(storageKey: string, operation: string): DomainError {
    return new DomainError({
      category: 'unavailable',
      code: 'settings.owner-not-found',
      operation: `${operation} setting ${storageKey}`,
      retryable: false,
      message: `No live settings owner controls ${storageKey}`
    });
  }

  private require(storageKey: string, operation: string): RegisteredSettingsController {
    const controller = this.#controllers.get(storageKey);
    if (!controller) throw this.#requireMessage(storageKey, operation);
    return controller;
  }
}

