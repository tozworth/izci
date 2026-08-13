import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => ({
  openBrowserDatabase: vi.fn(),
  runTransaction: vi.fn()
}));

vi.mock('$lib/persistence/browser-indexed-db', () => ({
  openBrowserDatabase: persistenceMocks.openBrowserDatabase
}));

vi.mock('$lib/persistence/indexed-db', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/persistence/indexed-db')>(),
  runTransaction: persistenceMocks.runTransaction
}));

import { PersistenceError } from '$lib/persistence/indexed-db';
import {
  deleteMediaSources,
  mediaSourceDatabase,
  persistMediaSources,
  readMediaSources,
  type StoredMediaSource
} from './media-source-persistence';

function handle(name: string): FileSystemFileHandle {
  return { kind: 'file', name, getFile: vi.fn() } as unknown as FileSystemFileHandle;
}

describe('media source handle repository', () => {
  const close = vi.fn(async () => undefined);
  const connection = {
    spec: mediaSourceDatabase,
    closed: Promise.resolve({ status: 'closed' as const, reason: 'manual' as const }),
    state: () => ({ status: 'open' as const }),
    close
  };

  beforeEach(() => {
    close.mockClear();
    persistenceMocks.openBrowserDatabase.mockReset().mockResolvedValue(connection);
    persistenceMocks.runTransaction.mockReset();
  });

  it('owns handles in a dedicated clean schema keyed by entity ID', () => {
    expect(mediaSourceDatabase).toEqual({
      name: 'izci-media-sources',
      version: 1,
      stores: { sources: { keyPath: 'entityId' } }
    });
  });

  it('reads unique requested handles and rejects malformed records', async () => {
    const source: StoredMediaSource = { entityId: 'one', fileHandle: handle('one.mp3') };
    const get = vi.fn(async (id: string) => id === 'one' ? source : { entityId: id, fileHandle: null });
    persistenceMocks.runTransaction.mockImplementation(async (_connection, _options, work) =>
      await work({ mode: 'readonly', store: () => ({ get }) })
    );

    await expect(readMediaSources(['one', 'one', 'bad'])).resolves.toEqual([source]);
    expect(get.mock.calls.map(([id]) => id)).toEqual(['one', 'bad']);
    expect(close).toHaveBeenCalledOnce();
  });

  it('persists and deletes handles with strict typed transactions', async () => {
    const source: StoredMediaSource = { entityId: 'one', fileHandle: handle('one.mp3') };
    const put = vi.fn(async () => 'one');
    const remove = vi.fn(async () => undefined);
    persistenceMocks.runTransaction
      .mockImplementationOnce(async (_connection, options, work) => {
        expect(options).toMatchObject({ mode: 'readwrite', durability: 'strict' });
        return await work({ mode: 'readwrite', store: () => ({ put }) });
      })
      .mockImplementationOnce(async (_connection, options, work) => {
        expect(options).toMatchObject({ mode: 'readwrite', durability: 'strict' });
        return await work({ mode: 'readwrite', store: () => ({ delete: remove }) });
      });

    await persistMediaSources([source]);
    await deleteMediaSources(['one', 'one']);
    expect(put).toHaveBeenCalledWith(source);
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('one');
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('surfaces classified failures and still closes the scoped connection', async () => {
    const failure = new PersistenceError({
      category: 'quota',
      code: 'persistence.quota-exceeded',
      operation: 'persist media source handles',
      retryable: true
    });
    persistenceMocks.runTransaction.mockRejectedValue(failure);
    await expect(persistMediaSources([{ entityId: 'one', fileHandle: handle('one.mp3') }])).rejects.toBe(failure);
    expect(close).toHaveBeenCalledOnce();
  });

  it('does not open IndexedDB for empty work', async () => {
    await expect(readMediaSources([])).resolves.toEqual([]);
    await persistMediaSources([]);
    await deleteMediaSources([]);
    expect(persistenceMocks.openBrowserDatabase).not.toHaveBeenCalled();
  });
});

