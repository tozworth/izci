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

vi.mock('$platform', async importOriginal => ({
  ...await importOriginal<object>(),
  filesystem: { ...(await import('../../platform/web-filesystem')).filesystem, readFolder: restoreHarness.readDirectoryFiles }
}));

import { forgetPendingFolder, locatePendingFolder, pendingBackupRestore } from './backups';

describe('backup restore location', () => {
  beforeEach(() => {
    restoreHarness.reconcileFolder.mockReset();
    restoreHarness.readDirectoryFiles.mockReset();
    restoreHarness.rememberFolder.mockReset().mockResolvedValue({ id: 'music-root' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forgets only the selected folder and its pending tracks and favorites', async () => {
    const folder = { id: 'music-root', name: 'Music', addedAt: 1, libraryMode: 'launch' as const };
    const track = {
      id: 'track-1', name: 'Track.flac', extension: 'flac', kind: 'stream' as const,
      size: 123, lastModified: 456, sourceFolderId: folder.id
    };
    const otherFolder = { ...folder, id: 'other-root', name: 'Other' };
    const otherTrack = { ...track, id: 'other-track', sourceFolderId: otherFolder.id };
    const looseTrack = { ...track, id: 'loose-track', sourceFolderId: undefined };
    await pendingBackupRestore.replace({
      createdAt: '2026-08-23T00:00:00.000Z',
      sourceOrigin: 'https://example.test',
      folders: [folder, otherFolder],
      tracks: [track, otherTrack, looseTrack],
      favorites: [track, otherTrack, looseTrack]
    });

    await forgetPendingFolder(folder.id);

    expect(pendingBackupRestore.getSnapshot()).toMatchObject({
      createdAt: '2026-08-23T00:00:00.000Z',
      sourceOrigin: 'https://example.test',
      folders: [otherFolder],
      tracks: [otherTrack, looseTrack],
      favorites: [otherTrack, looseTrack]
    });
    expect(restoreHarness.reconcileFolder).not.toHaveBeenCalled();
    expect(restoreHarness.rememberFolder).not.toHaveBeenCalled();

    await forgetPendingFolder(otherFolder.id);
    expect(pendingBackupRestore.getSnapshot()).toMatchObject({
      folders: [], tracks: [looseTrack], favorites: [looseTrack]
    });
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

    await expect(locatePendingFolder('music-root', { name: handle.name, handle })).resolves.toMatchObject({
      status: 'success',
      matchedTracks: 0,
      remainingTracks: 0
    });
    expect(restoreHarness.rememberFolder).toHaveBeenCalledWith({ name: handle.name, handle }, {
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
