import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const restoreHarness = vi.hoisted(() => {
  return {
    reconcileFolder: vi.fn(),
    rememberFolder: vi.fn(),
    readDirectoryFiles: vi.fn()
  };
});

vi.mock('$lib/stores/queue', async () => {
  const { writable } = await import('svelte/store');
  return {
    libraryStore: {
      items: writable([]),
      ready: async () => {},
      reconcileFolder: restoreHarness.reconcileFolder,
      add: vi.fn(),
      updateMetadata: vi.fn(),
      updateRating: vi.fn()
    },
    favoritesStore: {
      items: writable([]),
      ready: async () => {},
      add: vi.fn(),
      updateMetadata: vi.fn(),
      updateRating: vi.fn()
    }
  };
});

vi.mock('$lib/services/filesystem-folders', () => ({
  filesystemFolders: {
    ready: async () => {},
    getSnapshot: () => [],
    remember: restoreHarness.rememberFolder,
    updateScan: vi.fn()
  }
}));

vi.mock('$lib/services/file-verification', () => ({
  prepareImportedFiles: vi.fn(async (files: File[]) => files)
}));

vi.mock('$lib/utils/files', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/utils/files')>(),
  readDirectoryFiles: restoreHarness.readDirectoryFiles
}));

import { locatePendingFolder, pendingBackupRestore } from './backups';

describe('backup restore location', () => {
  beforeEach(() => {
    restoreHarness.reconcileFolder.mockReset();
    restoreHarness.readDirectoryFiles.mockReset();
    restoreHarness.rememberFolder.mockReset().mockResolvedValue({ id: 'music-root' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not reconcile a managed folder against an empty pending track set', async () => {
    await pendingBackupRestore.replace({
      createdAt: '2026-08-23T00:00:00.000Z',
      sourceOrigin: 'https://example.test',
      folders: [{
        id: 'music-root',
        name: 'Music',
        addedAt: 1,
        libraryMode: 'launch'
      }],
      tracks: [],
      favorites: []
    });
    const handle = {
      kind: 'directory',
      name: 'Music',
      async *values() {}
    } as FileSystemDirectoryHandle;

    await expect(locatePendingFolder('music-root', handle)).resolves.toMatchObject({
      status: 'success',
      matchedTracks: 0,
      remainingTracks: 0
    });
    expect(restoreHarness.rememberFolder).toHaveBeenCalledWith(handle, {
      libraryMode: 'launch',
      preferredId: 'music-root'
    });
    expect(restoreHarness.readDirectoryFiles).not.toHaveBeenCalled();
    expect(restoreHarness.reconcileFolder).not.toHaveBeenCalled();
  });

  it('does not publish pending restore state when IndexedDB cannot persist it', async () => {
    const previous = pendingBackupRestore.getSnapshot();
    vi.stubGlobal('window', {
      indexedDB: {
        open: () => {
          const request: Partial<IDBOpenDBRequest> = {};
          queueMicrotask(() => {
            const onerror = request.onerror as ((event: Event) => unknown) | null | undefined;
            onerror?.(new Event('error'));
          });
          return request as IDBOpenDBRequest;
        }
      }
    });

    await expect(pendingBackupRestore.replace({
      createdAt: 'failed-write',
      sourceOrigin: 'https://other.test',
      folders: [],
      tracks: [],
      favorites: []
    })).rejects.toThrow('backup-restore-persistence-failed');
    expect(pendingBackupRestore.getSnapshot()).toEqual(previous);
  });
});
