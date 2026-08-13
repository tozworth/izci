import { beforeEach, describe, expect, it, vi } from 'vitest';

const indexedDbMocks = vi.hoisted(() => ({
  openBrowserDatabase: vi.fn(),
  registerBrowserPersistenceOwner: vi.fn(() => () => undefined),
  runTransaction: vi.fn()
}));

vi.mock('$lib/persistence/browser-indexed-db', () => ({
  openBrowserDatabase: indexedDbMocks.openBrowserDatabase,
  registerBrowserPersistenceOwner: indexedDbMocks.registerBrowserPersistenceOwner
}));

vi.mock('$lib/persistence/indexed-db', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/persistence/indexed-db')>(),
  runTransaction: indexedDbMocks.runTransaction
}));

import { PersistenceError } from '$lib/persistence/indexed-db';
import {
  filesystemFoldersDatabase,
  readStoredFilesystemFolders,
  writeStoredFilesystemFolders,
  type StoredFilesystemFolder
} from './filesystem-folders';

function directoryHandle(): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'Music',
    async *values() {}
  } as FileSystemDirectoryHandle;
}

function storedFolder(): StoredFilesystemFolder {
  return {
    id: 'music',
    name: 'Music',
    handle: directoryHandle(),
    addedAt: 1,
    definitionRevision: 3,
    scanGeneration: 4,
    libraryMode: 'launch',
    lastScanStatus: 'success',
    lastScanTrackCount: 12
  };
}

describe('filesystem folder typed IndexedDB repository', () => {
  const close = vi.fn(async () => undefined);
  const connection = {
    spec: filesystemFoldersDatabase,
    closed: Promise.resolve({ status: 'closed' as const, reason: 'manual' as const }),
    state: () => ({ status: 'open' as const }),
    close
  };

  beforeEach(() => {
    close.mockClear();
    indexedDbMocks.openBrowserDatabase.mockReset().mockResolvedValue(connection);
    indexedDbMocks.runTransaction.mockReset();
  });

  it('reads the existing out-of-line state key and filters invalid records after the transaction commits', async () => {
    const folder = storedFolder();
    const get = vi.fn(async () => ({
      folderSetRevision: 7,
      folders: [folder, { id: 'invalid' }]
    }));
    indexedDbMocks.runTransaction.mockImplementation(async (_connection, _options, work) =>
      await work({ mode: 'readonly', store: () => ({ get }) })
    );

    await expect(readStoredFilesystemFolders()).resolves.toEqual({
      folderSetRevision: 7,
      folders: [folder]
    });

    expect(indexedDbMocks.openBrowserDatabase).toHaveBeenCalledWith(filesystemFoldersDatabase);
    expect(indexedDbMocks.runTransaction).toHaveBeenCalledWith(
      connection,
      {
        stores: ['folders'],
        mode: 'readonly',
        operation: 'read remembered filesystem folders'
      },
      expect.any(Function)
    );
    expect(get).toHaveBeenCalledWith('state');
    expect(close).toHaveBeenCalledOnce();
  });

  it('writes the same state key with strict durability and closes the scoped connection', async () => {
    const state = { folderSetRevision: 7, folders: [storedFolder()] };
    const put = vi.fn(async () => 'state');
    indexedDbMocks.runTransaction.mockImplementation(async (_connection, _options, work) =>
      await work({ mode: 'readwrite', store: () => ({ put }) })
    );

    await writeStoredFilesystemFolders(state);

    expect(indexedDbMocks.runTransaction).toHaveBeenCalledWith(
      connection,
      {
        stores: ['folders'],
        mode: 'readwrite',
        operation: 'persist remembered filesystem folders',
        durability: 'strict'
      },
      expect.any(Function)
    );
    expect(put).toHaveBeenCalledWith(state, 'state');
    expect(close).toHaveBeenCalledOnce();
  });

  it('preserves typed transaction failures instead of translating them to an empty result', async () => {
    const failure = new PersistenceError({
      category: 'quota',
      code: 'persistence.quota-exceeded',
      operation: 'read remembered filesystem folders',
      retryable: true
    });
    indexedDbMocks.runTransaction.mockRejectedValue(failure);

    await expect(readStoredFilesystemFolders()).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });
});
