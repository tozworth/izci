import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import {
  createFilesystemFoldersStore,
  queryFilesystemFolderPermission,
  type FilesystemFoldersPersistence,
  type StoredFilesystemFoldersState
} from './filesystem-folders';
import {
  planLibraryFolderReconciliation,
  type LibraryFolderReconciliationPlan,
  type ScannedLibraryFolderEntry
} from './library-folder-plan';
import {
  createBoundedLibraryFolderDiscovery,
  createLibraryFolderScanner,
  type LibraryFolderCatalog
} from './library-folder-scanner';

function directoryHandle(overrides: Partial<FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'Music',
    queryPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    async *values() {},
    ...overrides
  } as FileSystemDirectoryHandle;
}

function fileHandle(name = 'Track.flac'): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => new File(['audio'], name, { lastModified: 2 })
  } as FileSystemFileHandle;
}

function entity(id: string, overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id,
    path: 'Music/Track.flac',
    name: 'Track.flac',
    format: 'flac',
    kind: 'stream',
    size: 5,
    lastModified: 2,
    sourceFolderId: 'music',
    ...overrides
  };
}

function memoryPersistence(
  handle: FileSystemDirectoryHandle,
  mode: 'manual' | 'launch' = 'launch'
): FilesystemFoldersPersistence {
  let state: StoredFilesystemFoldersState = {
    folderSetRevision: 1,
    folders: [{
      id: 'music',
      name: handle.name,
      handle,
      addedAt: 1,
      definitionRevision: 1,
      scanGeneration: 0,
      libraryMode: mode,
      lastScanStatus: 'never'
    }]
  };
  return {
    read: async () => state,
    write: async (next) => {
      state = {
        folderSetRevision: next.folderSetRevision,
        folders: next.folders.map((folder) => ({ ...folder }))
      };
    }
  };
}

function catalogHarness(initial: readonly MediaEntity[] = [], revision = 0): {
  readonly catalog: LibraryFolderCatalog;
  readonly apply: ReturnType<typeof vi.fn>;
  getEntities(): readonly MediaEntity[];
} {
  let entities = initial;
  let catalogRevision = revision;
  const apply = vi.fn(async (
    expected: number,
    plan: LibraryFolderReconciliationPlan
  ): Promise<{ status: 'applied' } | { status: 'conflict'; actualCatalogRevision: number }> => {
    if (expected !== catalogRevision) {
      return { status: 'conflict', actualCatalogRevision: catalogRevision };
    }
    entities = plan.nextCatalog;
    catalogRevision += 1;
    return { status: 'applied' };
  });
  return {
    catalog: {
      getCatalogSnapshot: () => ({ entities, catalogRevision }),
      applyCatalogIfRevision: apply
    },
    apply,
    getEntities: () => entities
  };
}

describe('library folder scanner orchestration', () => {
  it('bounds physical file reads across a folder discovery', async () => {
    let activeReads = 0;
    let peakReads = 0;
    const releases: Array<() => void> = [];
    const handles = Array.from({ length: 9 }, (_, index) => ({
      kind: 'file',
      name: `Track ${index}.flac`,
      getFile: async () => {
        activeReads += 1;
        peakReads = Math.max(peakReads, activeReads);
        await new Promise<void>((resolve) => releases.push(resolve));
        activeReads -= 1;
        return new File(['audio'], `Track ${index}.flac`, { lastModified: index });
      }
    } as FileSystemFileHandle));
    const handle = directoryHandle({
      async *values() {
        for (const file of handles) yield file;
        return undefined;
      }
    });
    const discovery = createBoundedLibraryFolderDiscovery();
    const token = {
      folderId: 'music',
      definitionRevision: 1,
      folderSetRevision: 1,
      generation: 1,
      handle,
      libraryMode: 'launch' as const
    };

    const result = discovery.discover(token, 5, new AbortController().signal);
    let released = 0;
    while (released < handles.length) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(released));
      releases[released]?.();
      released += 1;
    }

    await expect(result).resolves.toHaveLength(9);
    expect(peakReads).toBe(4);
    await discovery.dispose();
  });

  it('launch-scans with query-only permission checks and commits the accepted plan', async () => {
    const handle = directoryHandle();
    const folders = createFilesystemFoldersStore({
      persistence: memoryPersistence(handle),
      initialize: true,
      createChannel: () => null
    });
    await folders.ready();
    const requestPermission = vi.mocked(handle.requestPermission!);
    const permissionProbes: boolean[] = [];
    const scanned: ScannedLibraryFolderEntry[] = [{ entity: entity('scan'), fileHandle: fileHandle() }];
    const catalog = catalogHarness();
    const scanner = createLibraryFolderScanner({
      folders,
      catalog: catalog.catalog,
      queryPermission: async (candidate, probe) => {
        permissionProbes.push(probe);
        return await queryFilesystemFolderPermission(candidate, probe);
      },
      discover: async () => scanned,
      createId: () => 'replacement-id',
      now: () => 42
    });

    await expect(scanner.scanLaunchFolders()).resolves.toEqual([{
      folderId: 'music',
      status: 'success',
      trackCount: 1,
      addedCount: 1,
      updatedCount: 0,
      removedCount: 0
    }]);
    expect(permissionProbes.length).toBeGreaterThanOrEqual(3);
    expect(permissionProbes.every((probe) => probe === false)).toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(catalog.getEntities()).toEqual([entity('scan')]);
    expect(folders.getSnapshot()[0]).toMatchObject({
      lastScanAt: 42,
      lastScanStatus: 'success',
      lastScanTrackCount: 1
    });
    await scanner.dispose();
    await folders.dispose();
  });

  it('replans once from the same discovered facts after a catalog revision conflict', async () => {
    const handle = directoryHandle();
    const folders = createFilesystemFoldersStore({
      persistence: memoryPersistence(handle),
      initialize: true,
      createChannel: () => null
    });
    await folders.ready();
    const scanned: ScannedLibraryFolderEntry[] = [{ entity: entity('scan'), fileHandle: fileHandle() }];
    let catalogRevision = 3;
    let entities: readonly MediaEntity[] = [];
    let applyCount = 0;
    const apply = vi.fn(async (_expected: number, reconciliation: LibraryFolderReconciliationPlan) => {
      applyCount += 1;
      if (applyCount === 1) {
        catalogRevision += 1;
        entities = [entity('external', {
          path: 'Other/External.flac',
          sourceFolderId: undefined
        })];
        return { status: 'conflict' as const, actualCatalogRevision: catalogRevision };
      }
      entities = reconciliation.nextCatalog;
      catalogRevision += 1;
      return { status: 'applied' as const };
    });
    const plan = vi.fn(planLibraryFolderReconciliation);
    const scanner = createLibraryFolderScanner({
      folders,
      catalog: {
        getCatalogSnapshot: () => ({ entities, catalogRevision }),
        applyCatalogIfRevision: apply
      },
      queryPermission: async () => 'granted',
      discover: async () => scanned,
      plan,
      createId: () => 'replacement-id'
    });

    await expect(scanner.scan('music')).resolves.toMatchObject({
      status: 'success',
      trackCount: 1,
      addedCount: 1
    });
    expect(plan).toHaveBeenCalledTimes(2);
    expect(plan.mock.calls[0]?.[0].scanned).toBe(scanned);
    expect(plan.mock.calls[1]?.[0].scanned).toBe(scanned);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(entities.map((item) => item.id)).toEqual(['external', 'scan']);
    await scanner.dispose();
    await folders.dispose();
  });

  it('does not plan or apply after the folder definition changes during discovery', async () => {
    const handle = directoryHandle();
    const folders = createFilesystemFoldersStore({
      persistence: memoryPersistence(handle, 'manual'),
      initialize: true,
      createChannel: () => null
    });
    await folders.ready();
    const catalog = catalogHarness();
    const plan = vi.fn(planLibraryFolderReconciliation);
    const scanner = createLibraryFolderScanner({
      folders,
      catalog: catalog.catalog,
      queryPermission: async () => 'granted',
      discover: async () => {
        await folders.setLibraryMode('music', 'launch');
        return [{ entity: entity('scan'), fileHandle: fileHandle() }];
      },
      plan
    });

    await expect(scanner.scan('music')).resolves.toMatchObject({
      status: 'error',
      failure: 'cancelled'
    });
    expect(plan).not.toHaveBeenCalled();
    expect(catalog.apply).not.toHaveBeenCalled();
    expect(folders.getSnapshot()[0]).toMatchObject({
      libraryMode: 'launch',
      lastScanStatus: 'error',
      lastScanFailure: 'cancelled'
    });
    await scanner.dispose();
    await folders.dispose();
  });

  it('aborts and settles active work during scanner disposal without applying a catalog', async () => {
    const handle = directoryHandle();
    const folders = createFilesystemFoldersStore({
      persistence: memoryPersistence(handle),
      initialize: true,
      createChannel: () => null
    });
    await folders.ready();
    const catalog = catalogHarness();
    let signal!: AbortSignal;
    let started!: () => void;
    const discoveryStarted = new Promise<void>((resolve) => { started = resolve; });
    const scanner = createLibraryFolderScanner({
      folders,
      catalog: catalog.catalog,
      queryPermission: async () => 'granted',
      discover: async (_token, _depth, activeSignal) => {
        signal = activeSignal;
        started();
        return await new Promise<never>((_resolve, reject) => {
          activeSignal.addEventListener('abort', () => {
            reject(new DOMException('Cancelled', 'AbortError'));
          }, { once: true });
        });
      }
    });

    const scanning = scanner.scan('music');
    expect(scanner.scan('music')).toBe(scanning);
    await discoveryStarted;
    const disposing = scanner.dispose();
    expect(signal.aborted).toBe(true);
    await expect(scanning).resolves.toMatchObject({ status: 'error', failure: 'cancelled' });
    await disposing;
    expect(catalog.apply).not.toHaveBeenCalled();
    expect(folders.getSnapshot()[0]).toMatchObject({
      lastScanStatus: 'error',
      lastScanFailure: 'cancelled'
    });
    await expect(scanner.scan('music')).resolves.toMatchObject({ failure: 'cancelled' });
    await folders.dispose();
  });
});
