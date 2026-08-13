import { writable, type Readable } from 'svelte/store';
import type {
  BackupManifest,
  BackupRestoreResult,
  LocateRestoreResult,
  PendingBackupRestore
} from '$lib/contracts/backup';

export const BACKUP_COORDINATION_CHANNEL_NAME = 'izci-backup-owner-v1';
export const BACKUP_OWNERSHIP_LOCK_NAME = 'izci-backup-owner-v1';
export const BACKUP_FILE_EXTENSION = '.izci';

const PROTOCOL_VERSION = 1;
const DEFAULT_DISCOVERY_TIMEOUT_MS = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;

export const EMPTY_PENDING_BACKUP_RESTORE: PendingBackupRestore = {
  createdAt: '',
  sourceOrigin: '',
  folders: [],
  tracks: [],
  favorites: []
};

export interface BackupCreationResult {
  readonly blob: Blob;
  readonly fileName: string;
  readonly manifest: BackupManifest;
}

export type BackupOwnerCommand =
  | { readonly operation: 'create' }
  | { readonly operation: 'restore'; readonly file: File }
  | { readonly operation: 'locate-files'; readonly handles: FileSystemFileHandle[] }
  | {
      readonly operation: 'locate-folder';
      readonly folderId: string;
      readonly handle: FileSystemDirectoryHandle;
    };

export type BackupOwnerCommandResult =
  | BackupCreationResult
  | BackupRestoreResult
  | LocateRestoreResult;

export interface BackupOwnerOperations {
  /** Settles accepted writes so the following snapshot or response is durable. */
  flushState(): Promise<void>;
  createBackup(): Promise<BackupCreationResult>;
  restoreBackup(file: File): Promise<BackupRestoreResult>;
  locateFiles(handles: FileSystemFileHandle[]): Promise<LocateRestoreResult>;
  locateFolder(folderId: string, handle: FileSystemDirectoryHandle): Promise<LocateRestoreResult>;
  getPendingRestore(): PendingBackupRestore;
  subscribePendingRestore(listener: (pending: PendingBackupRestore) => void): () => void;
  /** Standalone realms close the catalog owners before releasing their lease. */
  disposeState?(): Promise<void>;
}

export interface SerializedBackupOwner {
  execute(command: BackupOwnerCommand): Promise<BackupOwnerCommandResult>;
  getPendingRestore(): PendingBackupRestore;
  subscribePendingRestore(listener: (pending: PendingBackupRestore) => void): () => void;
  flush(): Promise<void>;
}

let realmBackupOwner: SerializedBackupOwner | null = null;

export function getRealmBackupOwner(): SerializedBackupOwner | null {
  return realmBackupOwner;
}

export function registerRealmBackupOwner(owner: SerializedBackupOwner): () => void {
  if (realmBackupOwner && realmBackupOwner !== owner) {
    throw new Error('backup-owner-already-registered');
  }
  realmBackupOwner = owner;
  return () => {
    if (realmBackupOwner === owner) realmBackupOwner = null;
  };
}

export interface BackupCoordinationChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface BackupOwnerLease {
  release(): void | Promise<void>;
}

export interface BackupCoordinationClient extends Readable<PendingBackupRestore> {
  ready(): Promise<void>;
  createBackup(): Promise<BackupCreationResult>;
  restoreBackup(file: File): Promise<BackupRestoreResult>;
  locateFiles(handles: FileSystemFileHandle[]): Promise<LocateRestoreResult>;
  locateFolder(folderId: string, handle: FileSystemDirectoryHandle): Promise<LocateRestoreResult>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

interface BackupRequestMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'request';
  readonly ownerId: string;
  readonly clientId: string;
  readonly requestId: string;
  readonly command: BackupOwnerCommand;
}

interface BackupResponseMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'response';
  readonly ownerId: string;
  readonly clientId: string;
  readonly requestId: string;
  readonly result?: BackupOwnerCommandResult;
  readonly error?: { readonly name: string; readonly message: string };
}

interface BackupDiscoverMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'discover';
  readonly clientId: string;
  readonly requestId: string;
}

interface BackupAvailableMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'available';
  readonly ownerId: string;
  readonly clientId: string;
  readonly requestId: string;
  readonly pending: PendingBackupRestore;
}

interface BackupPendingMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'pending';
  readonly ownerId: string;
  readonly pending: PendingBackupRestore;
}

interface BackupReleasedMessage {
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly type: 'released';
  readonly ownerId: string;
}

type BackupCoordinationMessage =
  | BackupRequestMessage
  | BackupResponseMessage
  | BackupDiscoverMessage
  | BackupAvailableMessage
  | BackupPendingMessage
  | BackupReleasedMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isCoordinationMessage(value: unknown): value is BackupCoordinationMessage {
  if (!isRecord(value) || value.protocol !== PROTOCOL_VERSION || typeof value.type !== 'string') {
    return false;
  }
  return value.type === 'request'
    || value.type === 'response'
    || value.type === 'discover'
    || value.type === 'available'
    || value.type === 'pending'
    || value.type === 'released';
}

function serializeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: 'backup-operation-failed' };
}

function deserializeError(error: { readonly name: string; readonly message: string }): Error {
  const restored = new Error(error.message);
  restored.name = error.name;
  return restored;
}

/**
 * The owner queue is the backup/catalog transaction boundary. Creates settle
 * accepted writes before reading their snapshot; mutations settle their writes
 * before callers are told that the operation completed.
 */
export function createSerializedBackupOwner(
  operations: BackupOwnerOperations
): SerializedBackupOwner {
  let queue = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    execute(command) {
      return enqueue(async () => {
        if (command.operation === 'create') {
          await operations.flushState();
          return operations.createBackup();
        }

        const result = command.operation === 'restore'
          ? await operations.restoreBackup(command.file)
          : command.operation === 'locate-files'
            ? await operations.locateFiles(command.handles)
            : await operations.locateFolder(command.folderId, command.handle);
        await operations.flushState();
        return result;
      });
    },
    getPendingRestore: () => operations.getPendingRestore(),
    subscribePendingRestore: (listener) => operations.subscribePendingRestore(listener),
    flush: () => queue
  };
}

export function serveBackupOwner(options: {
  readonly ownerId: string;
  readonly channel: BackupCoordinationChannel;
  readonly owner: SerializedBackupOwner;
}): () => Promise<void> {
  const { ownerId, channel, owner } = options;
  let disposed = false;

  const postPending = (pending: PendingBackupRestore): void => {
    channel.postMessage({
      protocol: PROTOCOL_VERSION,
      type: 'pending',
      ownerId,
      pending
    } satisfies BackupPendingMessage);
  };
  const unsubscribePending = owner.subscribePendingRestore(postPending);

  const handleMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (!isCoordinationMessage(message) || disposed) return;

    if (message.type === 'discover') {
      channel.postMessage({
        protocol: PROTOCOL_VERSION,
        type: 'available',
        ownerId,
        clientId: message.clientId,
        requestId: message.requestId,
        pending: owner.getPendingRestore()
      } satisfies BackupAvailableMessage);
      return;
    }

    if (message.type !== 'request' || message.ownerId !== ownerId) return;
    void owner.execute(message.command).then(
      (result) => channel.postMessage({
        protocol: PROTOCOL_VERSION,
        type: 'response',
        ownerId,
        clientId: message.clientId,
        requestId: message.requestId,
        result
      } satisfies BackupResponseMessage),
      (error) => channel.postMessage({
        protocol: PROTOCOL_VERSION,
        type: 'response',
        ownerId,
        clientId: message.clientId,
        requestId: message.requestId,
        error: serializeError(error)
      } satisfies BackupResponseMessage)
    );
  };
  channel.addEventListener('message', handleMessage);

  return async () => {
    if (disposed) return;
    disposed = true;
    channel.removeEventListener('message', handleMessage);
    unsubscribePending();
    await owner.flush();
    channel.postMessage({
      protocol: PROTOCOL_VERSION,
      type: 'released',
      ownerId
    } satisfies BackupReleasedMessage);
    channel.close();
  };
}

export function createBackupCoordinationClient(options: {
  readonly clientId: string;
  readonly createChannel: () => BackupCoordinationChannel | null;
  readonly createStandaloneOperations: () => Promise<BackupOwnerOperations>;
  readonly acquireStandaloneLease: () => Promise<BackupOwnerLease | null>;
  readonly getRealmOwner?: () => SerializedBackupOwner | null;
  readonly createId: () => string;
  readonly scheduler: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  readonly discoveryTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}): BackupCoordinationClient {
  const pendingStore = writable(EMPTY_PENDING_BACKUP_RESTORE);
  const channel = options.createChannel();
  const discoveryTimeoutMs = options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const schedule = options.scheduler.setTimeout;
  const cancel = options.scheduler.clearTimeout;
  const pendingDiscoveries = new Map<string, (ownerId: string | null) => void>();
  const pendingRequests = new Map<string, {
    readonly ownerId: string;
    readonly resolve: (value: BackupOwnerCommandResult) => void;
    readonly reject: (error: unknown) => void;
    readonly timeout: unknown;
  }>();
  const readyWaiters = new Set<() => void>();
  let ownerId: string | null = null;
  let disposed = false;
  let standaloneOwner: SerializedBackupOwner | null = null;
  let standaloneOperations: BackupOwnerOperations | null = null;
  let standaloneLease: BackupOwnerLease | null = null;
  let standaloneServerDispose: (() => Promise<void>) | null = null;
  let standaloneUnsubscribe: (() => void) | null = null;
  let standalonePromise: Promise<SerializedBackupOwner> | null = null;
  let readyPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let realmOwnerSubscription: SerializedBackupOwner | null = null;
  let realmOwnerUnsubscribe: (() => void) | null = null;

  function createRequestId(): string {
    return options.createId();
  }

  function wakeReadyWaiters(): void {
    for (const wake of [...readyWaiters]) wake();
  }

  function waitForOwnerRetry(): Promise<void> {
    if (disposed || ownerId) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timeout: unknown;
      const finish = (): void => {
        cancel(timeout);
        readyWaiters.delete(finish);
        resolve();
      };
      readyWaiters.add(finish);
      timeout = schedule(finish, discoveryTimeoutMs);
      if (disposed || ownerId) finish();
    });
  }

  const handleMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (!isCoordinationMessage(message) || disposed) return;

    if (
      message.type === 'available'
      && message.clientId === options.clientId
    ) {
      ownerId = message.ownerId;
      pendingStore.set(message.pending);
      pendingDiscoveries.get(message.requestId)?.(message.ownerId);
      wakeReadyWaiters();
      return;
    }

    if (message.type === 'pending' && (!ownerId || message.ownerId === ownerId)) {
      ownerId = message.ownerId;
      pendingStore.set(message.pending);
      return;
    }

    if (message.type === 'released' && message.ownerId === ownerId) {
      ownerId = null;
      for (const [requestId, request] of pendingRequests) {
        if (request.ownerId !== message.ownerId) continue;
        cancel(request.timeout);
        request.reject(new Error('backup-owner-released'));
        pendingRequests.delete(requestId);
      }
      return;
    }

    if (
      message.type !== 'response'
      || message.clientId !== options.clientId
      || message.ownerId !== ownerId
    ) {
      return;
    }
    const request = pendingRequests.get(message.requestId);
    if (!request) return;
    pendingRequests.delete(message.requestId);
    cancel(request.timeout);
    if (message.error) request.reject(deserializeError(message.error));
    else if (message.result) request.resolve(message.result);
    else request.reject(new Error('backup-owner-invalid-response'));
  };
  channel?.addEventListener('message', handleMessage);

  async function discoverOwner(): Promise<string | null> {
    if (!channel || disposed) return null;
    const requestId = createRequestId();
    return new Promise<string | null>((resolve) => {
      let timeout: unknown;
      const finish = (result: string | null): void => {
        cancel(timeout);
        pendingDiscoveries.delete(requestId);
        resolve(result);
      };
      pendingDiscoveries.set(requestId, finish);
      timeout = schedule(() => finish(null), discoveryTimeoutMs);
      channel.postMessage({
        protocol: PROTOCOL_VERSION,
        type: 'discover',
        clientId: options.clientId,
        requestId
      } satisfies BackupDiscoverMessage);
    });
  }

  function currentRealmOwner(): SerializedBackupOwner | null {
    const owner = options.getRealmOwner?.() ?? null;
    if (owner === realmOwnerSubscription) return owner;
    realmOwnerUnsubscribe?.();
    realmOwnerSubscription = owner;
    realmOwnerUnsubscribe = owner?.subscribePendingRestore((pending) => pendingStore.set(pending)) ?? null;
    if (owner) pendingStore.set(owner.getPendingRestore());
    return owner;
  }

  async function ensureStandaloneOwner(): Promise<SerializedBackupOwner> {
    if (standaloneOwner) return standaloneOwner;
    if (standalonePromise) return standalonePromise;
    standalonePromise = (async () => {
      const lease = await options.acquireStandaloneLease();
      if (!lease) {
        const discovered = await discoverOwner();
        if (discovered) throw new Error('backup-owner-appeared');
        throw new Error('backup-owner-busy');
      }
      standaloneLease = lease;
      if (disposed) {
        await lease.release();
        standaloneLease = null;
        throw new Error('backup-coordination-disposed');
      }

      // A main owner may have appeared while this realm waited for the lock.
      // Re-check before importing collection-owning backup modules.
      const discovered = await discoverOwner();
      if (discovered) {
        await lease.release();
        standaloneLease = null;
        throw new Error('backup-owner-appeared');
      }

      const operations = await options.createStandaloneOperations();
      standaloneOperations = operations;
      const owner = createSerializedBackupOwner(operations);
      standaloneOwner = owner;
      pendingStore.set(owner.getPendingRestore());
      standaloneUnsubscribe = owner.subscribePendingRestore((pending) => pendingStore.set(pending));
      if (channel) {
        const localOwnerId = `standalone:${options.clientId}`;
        ownerId = localOwnerId;
        standaloneServerDispose = serveBackupOwner({ ownerId: localOwnerId, channel, owner });
      }
      return owner;
    })().finally(() => {
      standalonePromise = null;
    });
    return standalonePromise;
  }

  async function remoteExecute(
    targetOwnerId: string,
    command: BackupOwnerCommand
  ): Promise<BackupOwnerCommandResult> {
    if (!channel) throw new Error('backup-owner-unavailable');
    const requestId = createRequestId();
    return new Promise<BackupOwnerCommandResult>((resolve, reject) => {
      const timeout = schedule(() => {
        pendingRequests.delete(requestId);
        if (ownerId === targetOwnerId) ownerId = null;
        reject(new Error('backup-owner-timeout'));
      }, requestTimeoutMs);
      pendingRequests.set(requestId, { ownerId: targetOwnerId, resolve, reject, timeout });
      channel.postMessage({
        protocol: PROTOCOL_VERSION,
        type: 'request',
        ownerId: targetOwnerId,
        clientId: options.clientId,
        requestId,
        command
      } satisfies BackupRequestMessage);
    });
  }

  async function execute(command: BackupOwnerCommand): Promise<BackupOwnerCommandResult> {
    if (disposed) throw new Error('backup-coordination-disposed');
    const realmOwner = currentRealmOwner();
    if (realmOwner) return realmOwner.execute(command);
    if (standaloneOwner) return standaloneOwner.execute(command);

    const discoveredOwner = ownerId ?? await discoverOwner();
    if (discoveredOwner) return remoteExecute(discoveredOwner, command);

    try {
      return await (await ensureStandaloneOwner()).execute(command);
    } catch (error) {
      if (error instanceof Error && error.message === 'backup-owner-appeared' && ownerId) {
        return remoteExecute(ownerId, command);
      }
      throw error;
    }
  }

  return {
    subscribe: pendingStore.subscribe,
    ready() {
      readyPromise ??= (async () => {
        while (!disposed) {
          if (currentRealmOwner()) return;
          if (ownerId || await discoverOwner()) return;
          try {
            await ensureStandaloneOwner();
            return;
          } catch (error) {
            if (
              !(error instanceof Error)
              || (error.message !== 'backup-owner-appeared' && error.message !== 'backup-owner-busy')
            ) {
              throw error;
            }
            if (ownerId) return;
            await waitForOwnerRetry();
          }
        }
      })();
      return readyPromise;
    },
    createBackup: () => execute({ operation: 'create' }) as Promise<BackupCreationResult>,
    restoreBackup: (file) => execute({ operation: 'restore', file }) as Promise<BackupRestoreResult>,
    locateFiles: (handles) => execute({ operation: 'locate-files', handles }) as Promise<LocateRestoreResult>,
    locateFolder: (folderId, handle) => execute({
      operation: 'locate-folder',
      folderId,
      handle
    }) as Promise<LocateRestoreResult>,
    stop() {
      stopPromise ??= (async () => {
        if (disposed) return;
        disposed = true;
        channel?.removeEventListener('message', handleMessage);
        for (const finish of pendingDiscoveries.values()) finish(null);
        pendingDiscoveries.clear();
        wakeReadyWaiters();
        for (const request of pendingRequests.values()) {
          cancel(request.timeout);
          request.reject(new Error('backup-coordination-disposed'));
        }
        pendingRequests.clear();
        await standalonePromise?.catch(() => undefined);
        standaloneUnsubscribe?.();
        standaloneUnsubscribe = null;
        realmOwnerUnsubscribe?.();
        realmOwnerUnsubscribe = null;
        realmOwnerSubscription = null;
        await standaloneServerDispose?.();
        standaloneServerDispose = null;
        await standaloneOwner?.flush();
        standaloneOwner = null;
        channel?.close();
        await standaloneOperations?.disposeState?.();
        standaloneOperations = null;
      })();
      return stopPromise;
    },
    dispose() {
      disposePromise ??= (async () => {
        await this.stop();
        await standaloneLease?.release();
        standaloneLease = null;
      })();
      return disposePromise;
    }
  };
}
