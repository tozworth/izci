import { openBrowserDatabase } from '$lib/persistence/browser-indexed-db';
import { defineDatabase, defineStore, runTransaction } from '$lib/persistence/indexed-db';

export interface StoredMediaSource {
  readonly entityId: string;
  readonly fileHandle: FileSystemFileHandle;
  readonly owners?: readonly string[];
}

const DATABASE_NAME = 'izci-media-sources';
const DATABASE_VERSION = 2;
const STORE_NAME = 'sources';

export const mediaSourceDatabase = defineDatabase({
  name: DATABASE_NAME,
  version: DATABASE_VERSION,
  stores: {
    [STORE_NAME]: defineStore<StoredMediaSource, string>()({ keyPath: 'entityId' })
  }
});

function isFileHandle(value: unknown): value is FileSystemFileHandle {
  if (!value || typeof value !== 'object') return false;
  const handle = value as Partial<FileSystemFileHandle>;
  return handle.kind === 'file' && typeof handle.getFile === 'function';
}

function normalizeStoredMediaSource(value: unknown): StoredMediaSource | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<StoredMediaSource>;
  if (typeof source.entityId !== 'string' || !source.entityId || !isFileHandle(source.fileHandle)) return null;
  const owners = Array.isArray(source.owners)
    ? [...new Set(source.owners.filter((owner): owner is string => typeof owner === 'string' && owner.length > 0))]
    : [];
  return { entityId: source.entityId, fileHandle: source.fileHandle, ...(owners.length ? { owners } : {}) };
}

export async function readMediaSources(entityIds: readonly string[]): Promise<StoredMediaSource[]> {
  if (entityIds.length === 0) return [];
  const connection = await openBrowserDatabase(mediaSourceDatabase);
  try {
    return await runTransaction(connection, {
      stores: [STORE_NAME],
      mode: 'readonly',
      operation: 'read media source handles'
    }, async (transaction) => {
      const store = transaction.store(STORE_NAME);
      const values = await Promise.all([...new Set(entityIds)].map((entityId) => store.get(entityId)));
      return values
        .map(normalizeStoredMediaSource)
        .filter((source): source is StoredMediaSource => source !== null);
    });
  } finally {
    await connection.close();
  }
}

export async function persistMediaSources(sources: readonly StoredMediaSource[], ownerId?: string): Promise<void> {
  if (sources.length === 0) return;
  const connection = await openBrowserDatabase(mediaSourceDatabase);
  try {
    await runTransaction(connection, {
      stores: [STORE_NAME],
      mode: 'readwrite',
      operation: 'persist media source handles',
      durability: 'strict'
    }, async (transaction) => {
      const store = transaction.store(STORE_NAME);
      for (const source of sources) {
        if (!ownerId) {
          await store.put(source);
          continue;
        }
        const current = normalizeStoredMediaSource(await store.get(source.entityId));
        const owners = [...new Set([...(current?.owners ?? []), ownerId])];
        await store.put({ ...source, owners });
      }
    });
  } finally {
    await connection.close();
  }
}

export async function deleteMediaSources(entityIds: readonly string[], ownerId?: string): Promise<void> {
  if (entityIds.length === 0) return;
  const connection = await openBrowserDatabase(mediaSourceDatabase);
  try {
    await runTransaction(connection, {
      stores: [STORE_NAME],
      mode: 'readwrite',
      operation: 'delete media source handles',
      durability: 'strict'
    }, async (transaction) => {
      const store = transaction.store(STORE_NAME);
      for (const entityId of new Set(entityIds)) {
        if (!ownerId) {
          await store.delete(entityId);
          continue;
        }
        const current = normalizeStoredMediaSource(await store.get(entityId));
        if (!current) continue;
        const owners = (current.owners ?? []).filter((owner) => owner !== ownerId);
        if (owners.length === 0) await store.delete(entityId);
        else await store.put({ ...current, owners });
      }
    });
  } finally {
    await connection.close();
  }
}
