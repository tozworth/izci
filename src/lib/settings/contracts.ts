import type { Readable } from 'svelte/store';
import type { ClockPort, IdPort, KeyValueStoragePort } from '$lib/runtime/ports';
import type { DomainError } from '$lib/runtime/errors';

export interface SettingsSnapshot<T> {
  readonly value: T;
  readonly originId: string;
  readonly revision: number;
  readonly messageId: string;
  readonly writtenAt: number;
}

export interface SettingsChannel {
  post(message: unknown): void;
  subscribe(listener: (message: unknown) => void): () => void;
  close(): void;
}

export interface SettingsChannelPort {
  open(name: string): SettingsChannel | null;
}

export interface SettingsEnginePorts {
  readonly clock: Pick<ClockPort, 'wallNow'>;
  readonly ids: IdPort;
  readonly storage: KeyValueStoragePort;
  readonly channels: SettingsChannelPort;
}

export interface PersistentStoreOptions<T> {
  readonly storageKey: string;
  readonly channelName: string;
  readonly defaultValue: T;
  readonly normalize: (value: unknown) => T;
}

export type SettingsStoreState = 'ready' | 'degraded' | 'disposed';

export interface SettingsStoreStatus {
  readonly state: SettingsStoreState;
  readonly error: DomainError | null;
  readonly originId: string;
  readonly revision: number;
  readonly messageId: string | null;
  readonly hasPersistedValue: boolean;
}

export interface PersistentStoreController<T> extends Readable<T> {
  readonly storageKey: string;
  readonly channelName: string;
  readonly status: Readable<SettingsStoreStatus>;
  getSnapshot(): T;
  getStatus(): SettingsStoreStatus;
  set(nextValue: unknown): T;
  update(updater: (currentValue: T) => unknown): T;
  reset(): T;
  flush(): void;
  dispose(): void;
}

export type SettingsStoreController<T extends object> =
  Omit<PersistentStoreController<T>, 'update'> & {
    update(patch: Partial<T>): T;
  };

