import {
  filesystemFolders,
  queryFilesystemFolderPermission,
  type FilesystemFolder,
  type LibraryFolderScanProgress
} from '$lib/services/filesystem-folders';
import {
  enumerateSupportedFiles,
  type IndexedFileDescriptor,
  type LibraryFolderIndexError
} from '$lib/services/library-folder-index';
import { libraryStore } from '$lib/stores/playlist';
import { trackSettings } from '$lib/stores/track-settings';
import type { PlaylistItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

export interface LibraryFolderScanResult {
  folderId: string;
  status: 'success' | 'partial' | 'permission-required' | 'cancelled' | 'error';
  trackCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  message?: string;
}

interface ActiveScan {
  controller: AbortController;
  generation: string;
  promise: Promise<LibraryFolderScanResult>;
}

const SCAN_BATCH_SIZE = 200;
const MAX_BATCH_INTERVAL_MS = 250;
const activeScans = new Map<string, ActiveScan>();
let scanQueue: Promise<unknown> = Promise.resolve();

async function findFolder(folderId: string): Promise<FilesystemFolder | null> {
  await filesystemFolders.ready();
  await filesystemFolders.refresh();
  return filesystemFolders.getSnapshot().find((folder) => folder.id === folderId) ?? null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function scanResult(
  folderId: string,
  status: LibraryFolderScanResult['status'],
  counts: Partial<Omit<LibraryFolderScanResult, 'folderId' | 'status' | 'message'>> = {},
  message?: string
): LibraryFolderScanResult {
  return {
    folderId,
    status,
    trackCount: counts.trackCount ?? 0,
    addedCount: counts.addedCount ?? 0,
    updatedCount: counts.updatedCount ?? 0,
    removedCount: counts.removedCount ?? 0,
    message
  };
}

function toPlaylistItem(descriptor: IndexedFileDescriptor, folderId: string): PlaylistItem {
  return {
    id: crypto.randomUUID(),
    sourceFolderId: folderId,
    path: descriptor.path,
    name: descriptor.name,
    extension: descriptor.extension,
    kind: descriptor.kind,
    size: null,
    lastModified: null
  };
}

async function yieldToMainThread(): Promise<void> {
  if (typeof window === 'undefined') return;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function performScan(
  folderId: string,
  generation: string,
  signal: AbortSignal
): Promise<LibraryFolderScanResult> {
  const folder = await findFolder(folderId);

  if (!folder || !folder.libraryMode) {
    return scanResult(folderId, 'error', {}, 'Folder is no longer registered as a library folder.');
  }

  if (signal.aborted) {
    return scanResult(folderId, 'cancelled', {}, 'Folder scan cancelled.');
  }

  const permission = await queryFilesystemFolderPermission(folder.handle, false);
  if (permission !== 'granted') {
    await filesystemFolders.updateScan(folderId, {
      lastScanStatus: 'permission-required',
      lastScanMessage: 'Check folder access in Tracks > Folders before scanning.'
    });
    return scanResult(folderId, 'permission-required', {}, 'Folder access is required.');
  }

  await filesystemFolders.updateScan(folderId, {
    lastScanStatus: 'enumerating',
    lastScanTrackCount: undefined,
    lastScanMessage: undefined
  });

  const progress: LibraryFolderScanProgress = {
    discoveredTrackCount: 0,
    visitedDirectoryCount: 0,
    skippedFileCount: 0,
    errorCount: 0,
    currentPath: folder.name
  };
  filesystemFolders.updateScanProgress(folderId, { ...progress });

  const errors: LibraryFolderIndexError[] = [];
  const seenIdentities = new Set<string>();
  let batch: PlaylistItem[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let lastPublishedAt = performance.now();
  libraryStore.beginBulkUpdate();

  const isCurrentGeneration = () => activeScans.get(folderId)?.generation === generation;
  const publishBatch = async () => {
    if (batch.length === 0 || signal.aborted || !isCurrentGeneration()) return;
    const published = libraryStore.upsertFolderIndexBatch(
      folderId,
      batch,
      filesystemFolders.getSnapshot().map((candidate) => candidate.id)
    );
    addedCount += published.addedItems.length;
    updatedCount += published.updatedItems.length;
    batch = [];
    lastPublishedAt = performance.now();
    filesystemFolders.updateScanProgress(folderId, { ...progress });
    await yieldToMainThread();
  };

  try {
    for await (const descriptor of enumerateSupportedFiles(folder.handle, {
      maxDepth: trackSettings.getSnapshot().folderNestingLimit,
      signal,
      onDirectory: (path) => {
        progress.visitedDirectoryCount += 1;
        progress.currentPath = path;
      },
      onSkippedFile: () => {
        progress.skippedFileCount += 1;
      },
      onError: (error) => {
        errors.push(error);
        progress.errorCount += 1;
      }
    })) {
      if (!isCurrentGeneration()) {
        throw new DOMException('The folder scan was superseded.', 'AbortError');
      }

      const item = toPlaylistItem(descriptor, folderId);
      seenIdentities.add(getTrackIdentity(item));
      batch.push(item);
      progress.discoveredTrackCount = seenIdentities.size;

      if (
        batch.length >= SCAN_BATCH_SIZE ||
        performance.now() - lastPublishedAt >= MAX_BATCH_INTERVAL_MS
      ) {
        await publishBatch();
      }
    }

    await publishBatch();

    if (signal.aborted || !isCurrentGeneration()) {
      throw new DOMException('The folder scan was cancelled.', 'AbortError');
    }

    if (errors.length > 0) {
      const message = `Partial scan: ${seenIdentities.size.toLocaleString()} tracks found; ${errors.length.toLocaleString()} folder${errors.length === 1 ? '' : 's'} could not be read.`;
      await filesystemFolders.updateScan(folderId, {
        lastScanAt: Date.now(),
        lastScanStatus: 'partial',
        lastScanTrackCount: seenIdentities.size,
        lastScanMessage: message
      });
      return scanResult(
        folderId,
        'partial',
        { trackCount: seenIdentities.size, addedCount, updatedCount },
        message
      );
    }

    const reconciliation = libraryStore.finalizeFolderIndex(folderId, seenIdentities);
    await filesystemFolders.updateScan(folderId, {
      lastScanAt: Date.now(),
      lastScanStatus: 'indexed',
      lastScanTrackCount: seenIdentities.size,
      lastScanMessage: undefined
    });
    return scanResult(folderId, 'success', {
      trackCount: seenIdentities.size,
      addedCount,
      updatedCount,
      removedCount: reconciliation.removedItems.length
    });
  } catch (error) {
    const cancelled = signal.aborted || isAbortError(error) || !isCurrentGeneration();
    const message = cancelled
      ? `Scan cancelled after ${seenIdentities.size.toLocaleString()} tracks.`
      : error instanceof Error
        ? error.message
        : 'The folder could not be scanned.';

    if (isCurrentGeneration()) {
      await filesystemFolders.updateScan(folderId, {
        lastScanAt: Date.now(),
        lastScanStatus: cancelled ? 'cancelled' : 'error',
        lastScanTrackCount: seenIdentities.size,
        lastScanMessage: message
      });
    }

    return scanResult(
      folderId,
      cancelled ? 'cancelled' : 'error',
      { trackCount: seenIdentities.size, addedCount, updatedCount },
      message
    );
  } finally {
    libraryStore.endBulkUpdate();
  }
}

export function scanLibraryFolder(folderId: string): Promise<LibraryFolderScanResult> {
  const active = activeScans.get(folderId);
  if (active) return active.promise;

  const controller = new AbortController();
  const generation = crypto.randomUUID();
  const promise = scanQueue
    .catch(() => undefined)
    .then(() => performScan(folderId, generation, controller.signal))
    .finally(() => {
      if (activeScans.get(folderId)?.generation === generation) activeScans.delete(folderId);
    });

  activeScans.set(folderId, { controller, generation, promise });
  scanQueue = promise;
  return promise;
}

export function cancelLibraryFolderScan(folderId: string): boolean {
  const active = activeScans.get(folderId);
  if (!active) return false;
  active.controller.abort();
  return true;
}

export async function registerAndScanLibraryFolders(
  handles: FileSystemDirectoryHandle[]
): Promise<LibraryFolderScanResult[]> {
  const folders: FilesystemFolder[] = [];
  for (const handle of handles) {
    folders.push(await filesystemFolders.remember(handle, { libraryMode: 'manual' }));
  }
  return await Promise.all(folders.map((folder) => scanLibraryFolder(folder.id)));
}

export async function scanLaunchLibraryFolders(): Promise<LibraryFolderScanResult[]> {
  await filesystemFolders.ready();
  await filesystemFolders.refresh();
  const folders = filesystemFolders.getSnapshot().filter((folder) => folder.libraryMode === 'launch');
  return await Promise.all(folders.map((folder) => scanLibraryFolder(folder.id)));
}
