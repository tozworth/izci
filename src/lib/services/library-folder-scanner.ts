import type { MediaEntity } from '$lib/contracts/catalog';
import {
  BoundedInspectionWorkQueue,
  InspectionWorkCancelledError,
  type InspectionWorkTicket
} from '$lib/media/inspection-work-queue';
import { inferMediaExtension, inferTrackKind } from '$lib/media/format-policy';
import { mediaSources } from '$lib/media/media-source';
import { logError, logWarning } from '$lib/logging/api';
import {
  filesystemFolders,
  queryFilesystemFolderPermission,
  type FilesystemFolderPermission,
  type FilesystemFoldersStore,
  type LibraryFolderScanFailure,
  type LibraryFolderScanToken
} from '$lib/services/filesystem-folders';
import {
  planLibraryFolderReconciliation,
  type CurrentMediaSourceHandle,
  type LibraryFolderReconciliationPlan,
  type ScannedLibraryFolderEntry
} from '$lib/collections/library-folder-plan';
import { prepareImportedFiles } from '$lib/services/file-verification';
import { libraryStore } from '$lib/stores/playlist';
import { trackSettings } from '$lib/stores/track-settings';
import { discoverDirectoryFiles } from '$lib/utils/files';

export interface LibraryFolderScanResult {
  folderId: string;
  status: 'success' | 'permission-required' | 'error';
  trackCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  failure?: LibraryFolderScanFailure;
}

export interface LibraryFolderCatalogSnapshot {
  readonly entities: readonly MediaEntity[];
  readonly catalogRevision: number;
}

export interface LibraryFolderCatalog {
  getCatalogSnapshot(): LibraryFolderCatalogSnapshot;
  applyCatalogIfRevision(
    expectedCatalogRevision: number,
    plan: LibraryFolderReconciliationPlan
  ): Promise<{
    readonly status: 'applied' | 'conflict';
    readonly actualCatalogRevision?: number;
  }>;
}

export interface LibraryFolderScannerOptions {
  readonly folders: FilesystemFoldersStore;
  readonly catalog: LibraryFolderCatalog;
  readonly queryPermission: (
    handle: FileSystemDirectoryHandle,
    probe: boolean
  ) => Promise<FilesystemFolderPermission>;
  readonly discover: (
    token: LibraryFolderScanToken,
    maxDepth: number,
    signal: AbortSignal
  ) => Promise<readonly ScannedLibraryFolderEntry[]>;
  readonly plan?: typeof planLibraryFolderReconciliation;
  readonly currentSourceHandles?: (
    catalog: readonly MediaEntity[]
  ) => readonly CurrentMediaSourceHandle[];
  readonly createAbortController?: () => AbortController;
  readonly createId?: () => string;
  readonly getFolderNestingLimit?: () => number;
  readonly maxLaunchConcurrency?: number;
  readonly now?: () => number;
}

export interface LibraryFolderScanner {
  scan(folderId: string): Promise<LibraryFolderScanResult>;
  scanLaunchFolders(): Promise<LibraryFolderScanResult[]>;
  dispose(): Promise<void>;
}

interface ActiveScan {
  readonly controller: AbortController;
  readonly result: Promise<LibraryFolderScanResult>;
}

const EMPTY_COUNTS = {
  trackCount: 0,
  addedCount: 0,
  updatedCount: 0,
  removedCount: 0
} as const;

function failedResult(
  folderId: string,
  failure: LibraryFolderScanFailure,
  status: LibraryFolderScanResult['status'] = 'error'
): LibraryFolderScanResult {
  return { folderId, status, ...EMPTY_COUNTS, failure };
}

function isCancellation(error: unknown): boolean {
  return error instanceof InspectionWorkCancelledError
    || (error instanceof DOMException && error.name === 'AbortError');
}

function activeFolderIds(folders: FilesystemFoldersStore): string[] {
  return folders.getSnapshot()
    .filter((folder) => folder.libraryMode !== null)
    .map((folder) => folder.id);
}

function defaultCurrentSourceHandles(
  catalog: readonly MediaEntity[]
): CurrentMediaSourceHandle[] {
  const handles: CurrentMediaSourceHandle[] = [];
  for (const entity of catalog) {
    const fileHandle = mediaSources.get(entity.id)?.fileHandle;
    if (fileHandle) handles.push({ entityId: entity.id, fileHandle });
  }
  return handles;
}

async function finishFailure(
  folders: FilesystemFoldersStore,
  token: LibraryFolderScanToken,
  failure: LibraryFolderScanFailure,
  now: () => number,
  status: LibraryFolderScanResult['status'] = 'error'
): Promise<LibraryFolderScanResult> {
  await folders.finishScan(token, {
    lastScanAt: now(),
    lastScanStatus: status === 'permission-required' ? 'permission-required' : 'error',
    lastScanFailure: failure
  });
  return failedResult(token.folderId, failure, status);
}

export function createLibraryFolderScanner(
  options: LibraryFolderScannerOptions
): LibraryFolderScanner {
  const plan = options.plan ?? planLibraryFolderReconciliation;
  const getCurrentSourceHandles = options.currentSourceHandles ?? defaultCurrentSourceHandles;
  const createAbortController = options.createAbortController ?? (() => new AbortController());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const getFolderNestingLimit = options.getFolderNestingLimit
    ?? (() => trackSettings.getSnapshot().folderNestingLimit);
  const maxLaunchConcurrency = Math.max(1, Math.trunc(options.maxLaunchConcurrency ?? 2));
  const now = options.now ?? Date.now;
  const activeScans = new Map<string, ActiveScan>();
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  async function revalidate(token: LibraryFolderScanToken): Promise<'current' | 'permission-required' | 'cancelled'> {
    await options.folders.refresh({ probe: false });
    if (!options.folders.isScanCurrent(token)) return 'cancelled';
    const permission = await options.queryPermission(token.handle, false);
    if (!options.folders.isScanCurrent(token)) return 'cancelled';
    if (permission !== 'granted') return 'permission-required';
    return 'current';
  }

  async function performScan(folderId: string, signal: AbortSignal): Promise<LibraryFolderScanResult> {
    await options.folders.ready();
    await options.folders.refresh({ probe: false });
    if (signal.aborted || disposed) return failedResult(folderId, 'cancelled');

    const token = await options.folders.beginScan(folderId);
    if (!token) return failedResult(folderId, 'not-library-folder');

    const initialPermission = await options.queryPermission(token.handle, false);
    if (initialPermission !== 'granted') {
      return await finishFailure(
        options.folders,
        token,
        'permission-required',
        now,
        'permission-required'
      );
    }

    try {
      const scanned = await options.discover(token, getFolderNestingLimit(), signal);
      if (signal.aborted || disposed) {
        return await finishFailure(options.folders, token, 'cancelled', now);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const validity = await revalidate(token);
        if (validity === 'permission-required') {
          return await finishFailure(
            options.folders,
            token,
            'permission-required',
            now,
            'permission-required'
          );
        }
        if (validity === 'cancelled' || signal.aborted || disposed) {
          return await finishFailure(options.folders, token, 'cancelled', now);
        }

        const snapshot = options.catalog.getCatalogSnapshot();
        const reconciliation = await plan({
          catalog: snapshot.entities,
          folderId,
          activeFolderIds: activeFolderIds(options.folders),
          scanned,
          currentSourceHandles: getCurrentSourceHandles(snapshot.entities),
          createId
        });

        const beforeApply = await revalidate(token);
        if (beforeApply === 'permission-required') {
          return await finishFailure(
            options.folders,
            token,
            'permission-required',
            now,
            'permission-required'
          );
        }
        if (beforeApply === 'cancelled' || signal.aborted || disposed) {
          return await finishFailure(options.folders, token, 'cancelled', now);
        }

        const applied = await options.catalog.applyCatalogIfRevision(
          snapshot.catalogRevision,
          reconciliation
        );
        if (applied.status === 'conflict') {
          if (attempt === 0) continue;
          logWarning('library', 'Managed-folder scan could not commit after a catalog conflict', {
            folderId,
            expectedCatalogRevision: snapshot.catalogRevision,
            actualCatalogRevision: applied.actualCatalogRevision
          });
          return await finishFailure(options.folders, token, 'cancelled', now);
        }

        const finished = await options.folders.finishScan(token, {
          lastScanAt: now(),
          lastScanStatus: 'success',
          lastScanTrackCount: scanned.length,
          lastScanFailure: undefined
        });
        if (!finished) return failedResult(folderId, 'cancelled');
        if (reconciliation.duplicates.length > 0) {
          logWarning('library', 'Managed-folder scan discarded duplicate paths', {
            folderId,
            duplicates: reconciliation.duplicates
          });
        }
        return {
          folderId,
          status: 'success',
          trackCount: scanned.length,
          addedCount: reconciliation.addedItems.length,
          updatedCount: reconciliation.updatedItems.length,
          removedCount: reconciliation.removedItems.length
        };
      }
    } catch (error) {
      if (signal.aborted || disposed || isCancellation(error)) {
        return await finishFailure(options.folders, token, 'cancelled', now);
      }
      logError('library', 'Managed-folder scan failed', { folderId, error });
      return await finishFailure(options.folders, token, 'scan-failed', now);
    }

    return await finishFailure(options.folders, token, 'cancelled', now);
  }

  const api: LibraryFolderScanner = {
    scan(folderId) {
      if (disposed) return Promise.resolve(failedResult(folderId, 'cancelled'));
      const active = activeScans.get(folderId);
      if (active) return active.result;
      const controller = createAbortController();
      const result = performScan(folderId, controller.signal).finally(() => {
        const current = activeScans.get(folderId);
        if (current?.result === result) activeScans.delete(folderId);
      });
      activeScans.set(folderId, { controller, result });
      return result;
    },
    async scanLaunchFolders() {
      if (disposed) return [];
      await options.folders.ready();
      await options.folders.refresh({ probe: false });
      const folders = options.folders.getSnapshot()
        .filter((folder) => folder.libraryMode === 'launch');
      const results = new Array<LibraryFolderScanResult>(folders.length);
      let index = 0;
      const workers = Array.from({
        length: Math.min(maxLaunchConcurrency, folders.length)
      }, async () => {
        while (index < folders.length) {
          const currentIndex = index++;
          results[currentIndex] = await api.scan(folders[currentIndex]!.id);
        }
      });
      await Promise.all(workers);
      return results;
    },
    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      const scans = [...activeScans.values()];
      for (const scan of scans) scan.controller.abort();
      disposePromise = Promise.allSettled(scans.map((scan) => scan.result)).then(() => undefined);
      return disposePromise;
    }
  };
  return api;
}

export function createBoundedLibraryFolderDiscovery(): {
  readonly discover: LibraryFolderScannerOptions['discover'];
  dispose(): Promise<void>;
} {
  const queue = new BoundedInspectionWorkQueue<string>({
    maxConcurrency: 4,
    maxBackgroundConcurrency: 4,
    maxQueued: 16,
    maxAwaitingAdmission: 4,
    clock: {
      setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
    },
    abortControllers: { create: () => new AbortController() }
  });

  return {
    async discover(token, maxDepth, signal) {
      const discovered = await discoverDirectoryFiles(token.handle, { maxDepth, signal });
      if (signal.aborted) throw new DOMException('Folder scan cancelled.', 'AbortError');
      const tickets: InspectionWorkTicket<ScannedLibraryFolderEntry | null>[] = [];
      const outcomes: Array<Promise<
        | { readonly status: 'fulfilled'; readonly value: ScannedLibraryFolderEntry | null }
        | { readonly status: 'rejected'; readonly reason: unknown }
      >> = [];
      try {
        for (const source of discovered) {
          const ticket = await queue.enqueue(async ({ signal: workSignal }) => {
            if (workSignal.aborted) {
              throw new DOMException('Folder scan cancelled.', 'AbortError');
            }
            const file = await source.fileHandle.getFile();
            if (workSignal.aborted) {
              throw new DOMException('Folder scan cancelled.', 'AbortError');
            }
            const accepted = await prepareImportedFiles([file]);
            if (accepted.length === 0) return null;
            const format = inferMediaExtension(file.name);
            const entity: MediaEntity = {
              id: crypto.randomUUID(),
              path: source.path,
              name: file.name,
              format,
              kind: inferTrackKind(format) ?? 'module',
              size: file.size,
              lastModified: file.lastModified,
              sourceFolderId: token.folderId
            };
            return { entity, fileHandle: source.fileHandle };
          }, {
            key: `${token.folderId}:${token.generation}:${source.path}`,
            priority: 'background',
            signal,
            timeoutMs: 20_000
          });
          tickets.push(ticket);
          outcomes.push(ticket.result.then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason })
          ));
        }
        const results = await Promise.all(outcomes);
        const rejection = results.find((result) => result.status === 'rejected');
        if (rejection?.status === 'rejected') throw rejection.reason;
        return results.flatMap((result) => (
          result.status === 'fulfilled' && result.value !== null ? [result.value] : []
        ));
      } catch (error) {
        for (const ticket of tickets) ticket.cancel();
        throw error;
      }
    },
    dispose: () => queue.dispose()
  };
}

const boundedFolderDiscovery = createBoundedLibraryFolderDiscovery();
const browserLibraryFolderScanner = createLibraryFolderScanner({
  folders: filesystemFolders,
  catalog: libraryStore,
  queryPermission: (handle, probe) => queryFilesystemFolderPermission(handle, probe),
  discover: boundedFolderDiscovery.discover
});

export function scanLibraryFolder(folderId: string): Promise<LibraryFolderScanResult> {
  return browserLibraryFolderScanner.scan(folderId);
}

export function scanLaunchLibraryFolders(): Promise<LibraryFolderScanResult[]> {
  return browserLibraryFolderScanner.scanLaunchFolders();
}

export async function disposeLibraryFolderScanner(): Promise<void> {
  await browserLibraryFolderScanner.dispose();
  await boundedFolderDiscovery.dispose();
}
