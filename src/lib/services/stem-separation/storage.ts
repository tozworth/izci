import { STEM_RESULT_SOFT_CAP_BYTES } from './types';
import type {
  StemResultRecord,
  StemRuntimeRecord,
  StemSourceRecord,
  StemStorageSummary
} from './types';

const DATABASE_NAME = 'izci-stem-separation';
const DATABASE_VERSION = 1;
const RUNTIME_STORE = 'runtime';
const RESULTS_STORE = 'results';
const SOURCES_STORE = 'sources';

interface StorageManagerWithDirectory extends StorageManager {
  getDirectory(): Promise<FileSystemDirectoryHandle>;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Stem cache database failed to open.'));
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RUNTIME_STORE)) {
        database.createObjectStore(RUNTIME_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(RESULTS_STORE)) {
        const results = database.createObjectStore(RESULTS_STORE, { keyPath: 'key' });
        results.createIndex('lastAccessed', 'lastAccessed');
      }
      if (!database.objectStoreNames.contains(SOURCES_STORE)) {
        database.createObjectStore(SOURCES_STORE, { keyPath: 'quickKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });

  return databasePromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Stem cache request failed.'));
  });
}

async function getRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestResult(transaction.objectStore(storeName).get(key)) as Promise<T | undefined>;
}

async function putRecord(storeName: string, value: unknown): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestResult(transaction.objectStore(storeName).put(value));
}

async function deleteRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readwrite');
  await requestResult(transaction.objectStore(storeName).delete(key));
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const database = await openDatabase();
  const transaction = database.transaction(storeName, 'readonly');
  return requestResult(transaction.objectStore(storeName).getAll()) as Promise<T[]>;
}

async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  const manager = navigator.storage as StorageManagerWithDirectory;
  if (typeof manager.getDirectory !== 'function') {
    throw new Error('Origin-private file storage is unavailable.');
  }
  return manager.getDirectory();
}

async function resolveParent(path: string, create: boolean): Promise<{
  directory: FileSystemDirectoryHandle;
  name: string;
}> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  if (!name) throw new Error('Invalid stem cache path.');

  let directory = await getOpfsRoot();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return { directory, name };
}

export async function writeOpfsFile(path: string, data: Blob | ArrayBuffer): Promise<number> {
  const { directory, name } = await resolveParent(path, true);
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
  return data instanceof Blob ? data.size : data.byteLength;
}

export async function readOpfsFile(path: string): Promise<File> {
  const { directory, name } = await resolveParent(path, false);
  const handle = await directory.getFileHandle(name);
  return handle.getFile();
}

export async function deleteOpfsFile(path: string): Promise<void> {
  try {
    const { directory, name } = await resolveParent(path, false);
    await directory.removeEntry(name);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    throw error;
  }
}

export async function getRuntimeRecord(): Promise<StemRuntimeRecord | undefined> {
  return getRecord<StemRuntimeRecord>(RUNTIME_STORE, 'current');
}

export async function putRuntimeRecord(record: StemRuntimeRecord): Promise<void> {
  await putRecord(RUNTIME_STORE, record);
}

export async function deleteRuntimeRecord(): Promise<void> {
  await deleteRecord(RUNTIME_STORE, 'current');
}

export async function findResultByQuickKey(quickKey: string): Promise<StemResultRecord | undefined> {
  const source = await getRecord<StemSourceRecord>(SOURCES_STORE, quickKey);
  if (!source) return undefined;
  const result = await getRecord<StemResultRecord>(RESULTS_STORE, source.resultKey);
  if (!result) await deleteRecord(SOURCES_STORE, quickKey);
  return result;
}

export async function getResult(key: string): Promise<StemResultRecord | undefined> {
  return getRecord<StemResultRecord>(RESULTS_STORE, key);
}

export async function commitResult(record: StemResultRecord): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([RESULTS_STORE, SOURCES_STORE], 'readwrite');
  transaction.objectStore(RESULTS_STORE).put(record);
  transaction.objectStore(SOURCES_STORE).put({
    quickKey: record.sourceQuickKey,
    resultKey: record.key
  } satisfies StemSourceRecord);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Stem result commit failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Stem result commit was aborted.'));
  });
}

export async function touchResult(record: StemResultRecord): Promise<StemResultRecord> {
  const touched = { ...record, lastAccessed: Date.now() };
  await putRecord(RESULTS_STORE, touched);
  return touched;
}

export async function deleteResult(record: StemResultRecord): Promise<void> {
  await deleteOpfsFile(record.opfsPath);
  await deleteRecord(RESULTS_STORE, record.key);
  const source = await getRecord<StemSourceRecord>(SOURCES_STORE, record.sourceQuickKey);
  if (source?.resultKey === record.key) await deleteRecord(SOURCES_STORE, record.sourceQuickKey);
}

export async function pruneResultCache(
  incomingBytes = 0,
  softCapBytes = STEM_RESULT_SOFT_CAP_BYTES
): Promise<void> {
  const records = await getAllRecords<StemResultRecord>(RESULTS_STORE);
  let total = records.reduce((sum, record) => sum + record.byteSize, 0);
  const oldestFirst = records.sort((left, right) => left.lastAccessed - right.lastAccessed);
  for (const record of oldestFirst) {
    if (total + incomingBytes <= softCapBytes) break;
    await deleteResult(record);
    total -= record.byteSize;
  }
}

export async function clearResultCache(): Promise<void> {
  const records = await getAllRecords<StemResultRecord>(RESULTS_STORE);
  for (const record of records) await deleteResult(record);
}

export async function sweepStemStorage(): Promise<void> {
  try {
    const root = await getOpfsRoot();
    const cache = await root.getDirectoryHandle('stem-cache');
    try {
      const temporary = await cache.getDirectoryHandle('tmp');
      for await (const entry of temporary.values()) {
        await temporary.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }

    const records = await getAllRecords<StemResultRecord>(RESULTS_STORE);
    const referencedNames = new Set(records.map((record) => record.opfsPath.split('/').at(-1)));
    try {
      const results = await cache.getDirectoryHandle('results');
      for await (const entry of results.values()) {
        if (!referencedNames.has(entry.name)) {
          await results.removeEntry(entry.name, { recursive: entry.kind === 'directory' });
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }

    for (const record of records) {
      try {
        await readOpfsFile(record.opfsPath);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          await deleteRecord(RESULTS_STORE, record.key);
          const source = await getRecord<StemSourceRecord>(SOURCES_STORE, record.sourceQuickKey);
          if (source?.resultKey === record.key) await deleteRecord(SOURCES_STORE, record.sourceQuickKey);
        } else {
          throw error;
        }
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
  }
}

export async function getStemStorageSummary(): Promise<StemStorageSummary> {
  const [runtime, results, estimate] = await Promise.all([
    getRuntimeRecord(),
    getAllRecords<StemResultRecord>(RESULTS_STORE),
    navigator.storage.estimate().catch((): StorageEstimate => ({}))
  ]);
  return {
    modelBytes: runtime?.modelBytes ?? 0,
    resultBytes: results.reduce((sum, record) => sum + record.byteSize, 0),
    resultCount: results.length,
    quota: estimate.quota,
    usage: estimate.usage
  };
}
