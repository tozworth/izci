import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { PersistenceError } from '$lib/persistence/indexed-db';
import {
  createFilesystemFoldersStore,
  filesystemFoldersDatabase,
  getDroppedDirectoryHandles,
  queryFilesystemFolderPermission,
  resolveFilesystemFileLocation,
  type FilesystemFolder,
  type FilesystemFoldersPersistence,
  type StoredFilesystemFolder
} from './filesystem-folders';

function directoryHandle(overrides: Partial<FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'Music',
    async *values() {},
    ...overrides
  } as FileSystemDirectoryHandle;
}

function rememberedFolder(
  id: string,
  name: string,
  handle: FileSystemDirectoryHandle
): FilesystemFolder {
  return {
    id,
    name,
    handle,
    addedAt: 1,
    permission: 'granted',
    libraryMode: null,
    lastScanStatus: 'never'
  };
}

function storedFolder(
  id: string,
  handle: FileSystemDirectoryHandle
): StoredFilesystemFolder {
  return {
    id,
    name: handle.name,
    handle,
    addedAt: 1,
    libraryMode: null,
    lastScanStatus: 'never'
  };
}

function persistenceFailure(category: 'quota' | 'io' = 'quota'): PersistenceError {
  return new PersistenceError({
    category,
    code: category === 'quota' ? 'persistence.quota-exceeded' : 'persistence.io-failed',
    operation: 'test folder persistence',
    retryable: true
  });
}

describe('filesystem folder helpers', () => {
  it('preserves the filesystem-folder database, store, version, and out-of-line key layout', () => {
    expect(filesystemFoldersDatabase).toEqual({
      name: 'izci-filesystem',
      version: 1,
      stores: { folders: {} }
    });
  });

  it('reports permission state without probing folders that are not granted', async () => {
    const values = vi.fn(() => ({ next: async () => ({ done: true, value: undefined }) }));
    const handle = directoryHandle({
      queryPermission: async () => 'prompt',
      values: values as unknown as FileSystemDirectoryHandle['values']
    });

    await expect(queryFilesystemFolderPermission(handle)).resolves.toBe('prompt');
    expect(values).not.toHaveBeenCalled();
  });

  it('marks granted handles unavailable when their directory cannot be enumerated', async () => {
    const handle = directoryHandle({
      queryPermission: async () => 'granted',
      values: (() => ({
        next: async () => {
          throw new DOMException('Missing', 'NotFoundError');
        }
      })) as unknown as FileSystemDirectoryHandle['values']
    });

    await expect(queryFilesystemFolderPermission(handle)).resolves.toBe('unavailable');
  });

  it('does not wait indefinitely for an unavailable directory probe', async () => {
    const handle = directoryHandle({
      queryPermission: async () => 'granted',
      values: (() => ({
        next: () => new Promise(() => {})
      })) as unknown as FileSystemDirectoryHandle['values']
    });

    await expect(queryFilesystemFolderPermission(handle, true, 10)).resolves.toBe('unavailable');
  });

  it('collects only reusable directory handles from a drop', async () => {
    const folder = directoryHandle();
    const file = { kind: 'file', name: 'Track.flac', getFile: async () => new File([], 'Track.flac') };
    const dataTransfer = {
      items: [
        { getAsFileSystemHandle: async () => folder },
        { getAsFileSystemHandle: async () => file },
        { getAsFileSystemHandle: async () => null }
      ]
    } as unknown as DataTransfer;

    await expect(getDroppedDirectoryHandles(dataTransfer)).resolves.toEqual([folder]);
  });

  it('resolves a launched file to its unique remembered folder and canonical path', async () => {
    const track = {
      kind: 'file',
      name: 'Track.flac',
      getFile: async () => new File([], 'Track.flac')
    } as FileSystemFileHandle;
    const music = rememberedFolder('music-id', 'Music', directoryHandle({
      resolve: async (candidate) => candidate === track ? ['Artist', 'Track.flac'] : null
    }));
    const other = rememberedFolder('other-id', 'Other', directoryHandle({
      name: 'Other',
      resolve: async () => null
    }));

    await expect(resolveFilesystemFileLocation(track, [music, other])).resolves.toEqual({
      folderId: 'music-id',
      path: 'Music/Artist/Track.flac'
    });
  });

  it('does not guess when a launched file belongs to multiple remembered roots', async () => {
    const track = {
      kind: 'file',
      name: 'Track.flac',
      getFile: async () => new File([], 'Track.flac')
    } as FileSystemFileHandle;
    const parent = rememberedFolder('parent-id', 'Music', directoryHandle({
      resolve: async () => ['Album', 'Track.flac']
    }));
    const nested = rememberedFolder('nested-id', 'Album', directoryHandle({
      name: 'Album',
      resolve: async () => ['Track.flac']
    }));

    await expect(resolveFilesystemFileLocation(track, [parent, nested])).resolves.toBeNull();
  });
});

describe('filesystem folder persistence lifecycle', () => {
  it('keeps the last good snapshot and exposes typed read failures instead of replacing them with empty state', async () => {
    const folder = directoryHandle();
    const failure = persistenceFailure('io');
    const read = vi.fn<FilesystemFoldersPersistence['read']>()
      .mockResolvedValueOnce([storedFolder('music', folder)])
      .mockRejectedValueOnce(failure);
    const persistence: FilesystemFoldersPersistence = { read, write: vi.fn() };
    const folders = createFilesystemFoldersStore({ persistence, initialize: true, createChannel: () => null });

    await folders.ready();
    expect(folders.getSnapshot()).toEqual([
      expect.objectContaining({ id: 'music', permission: 'granted' })
    ]);
    await expect(folders.refresh()).rejects.toBe(failure);
    expect(folders.getSnapshot()).toEqual([
      expect.objectContaining({ id: 'music', permission: 'granted' })
    ]);
    expect(get(folders.persistenceState)).toEqual({ status: 'error', error: failure });
    await expect(folders.dispose()).rejects.toBe(failure);
  });

  it('does not publish a managed-folder mutation until its strict persistence write succeeds', async () => {
    const folder = directoryHandle();
    const failure = persistenceFailure();
    const write = vi.fn<FilesystemFoldersPersistence['write']>().mockRejectedValue(failure);
    const folders = createFilesystemFoldersStore({
      persistence: { read: async () => [], write },
      initialize: true,
      createChannel: () => null,
      createId: () => 'folder-id',
      now: () => 42
    });
    await folders.ready();

    await expect(folders.remember(folder)).rejects.toBe(failure);
    expect(write).toHaveBeenCalledWith([
      {
        id: 'folder-id',
        name: 'Music',
        handle: folder,
        addedAt: 42,
        libraryMode: null,
        lastScanStatus: 'never'
      }
    ]);
    expect(folders.getSnapshot()).toEqual([]);
    expect(get(folders.persistenceState)).toEqual({ status: 'error', error: failure });
  });

  it('keeps permission requesting directly on user activation before the next IndexedDB read', async () => {
    const calls: string[] = [];
    const folder = directoryHandle({
      requestPermission: async () => {
        calls.push('request-permission');
        return 'granted';
      }
    });
    const persistence: FilesystemFoldersPersistence = {
      read: async () => {
        calls.push('read-persistence');
        return [storedFolder('music', folder)];
      },
      write: async () => { calls.push('write-persistence'); }
    };
    const folders = createFilesystemFoldersStore({ persistence, initialize: true, createChannel: () => null });
    await folders.ready();
    calls.length = 0;

    await folders.requestPermission('music');

    expect(calls).toEqual(['request-permission', 'read-persistence', 'write-persistence']);
  });

  it('flushes pending writes and disposes its channel listener exactly once', async () => {
    let finishWrite!: () => void;
    const writePending = new Promise<void>((resolve) => { finishWrite = resolve; });
    const write = vi.fn<FilesystemFoldersPersistence['write']>(() => writePending);
    const removeEventListener = vi.fn();
    const close = vi.fn();
    const channel = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener,
      close
    };
    const folders = createFilesystemFoldersStore({
      persistence: { read: async () => [], write },
      initialize: true,
      createChannel: () => channel,
      createId: () => 'folder-id'
    });
    await folders.ready();
    const remembering = folders.remember(directoryHandle());
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    let flushed = false;
    const flushing = folders.flush().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);

    finishWrite();
    await remembering;
    await flushing;
    const firstDispose = folders.dispose();
    const repeatedDispose = folders.dispose();
    expect(repeatedDispose).toBe(firstDispose);
    await firstDispose;

    expect(removeEventListener).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(get(folders.persistenceState)).toEqual({ status: 'disposed' });
    await expect(folders.refresh()).rejects.toMatchObject({
      category: 'closed',
      code: 'persistence.connection-closed'
    });
  });
});
