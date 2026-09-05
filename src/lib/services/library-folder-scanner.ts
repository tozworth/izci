import { prepareImportedFiles } from '$lib/services/file-verification';
import {
  filesystemFolders,
  queryFilesystemFolderPermission,
  type FilesystemFolder,
  type LibraryFolderScanFailure
} from '$lib/services/filesystem-folders';
import { libraryStore } from '$lib/stores/queue';
import { trackSettings } from '$lib/stores/track-settings';
import { buildTrackItems, readDirectoryFiles } from '$lib/utils/files';

interface LibraryFolderScanResult {
  folderId: string;
  status: 'success' | 'permission-required' | 'error';
  trackCount: number;
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  failure?: LibraryFolderScanFailure;
}

const activeScans = new Map<string, Promise<LibraryFolderScanResult>>();

async function findFolder(folderId: string): Promise<FilesystemFolder | null> {
  await filesystemFolders.ready();
  await filesystemFolders.refresh();
  return filesystemFolders.getSnapshot().find((folder) => folder.id === folderId) ?? null;
}

function releaseScanObjectUrls(items: ReturnType<typeof buildTrackItems>): void {
  for (const item of items) {
    if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    item.file = undefined;
    item.objectUrl = undefined;
  }
}

async function performScan(folderId: string): Promise<LibraryFolderScanResult> {
  const folder = await findFolder(folderId);

  if (!folder || !folder.libraryMode) {
    return {
      folderId,
      status: 'error',
      trackCount: 0,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      failure: 'not-library-folder'
    };
  }

  const permission = await queryFilesystemFolderPermission(folder.handle, false);
  if (permission !== 'granted') {
    await filesystemFolders.updateScan(folderId, {
      lastScanStatus: 'permission-required',
      lastScanFailure: 'permission-required'
    });
    return {
      folderId,
      status: 'permission-required',
      trackCount: 0,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      failure: 'permission-required'
    };
  }

  await filesystemFolders.updateScan(folderId, {
    lastScanStatus: 'scanning',
    lastScanFailure: undefined
  });

  try {
    const discoveredFiles = await readDirectoryFiles(folder.handle, {
      maxDepth: trackSettings.getSnapshot().folderNestingLimit
    });
    const verifiedFiles = await prepareImportedFiles(discoveredFiles);
    const scannedItems = buildTrackItems(verifiedFiles).map((item) => ({
      ...item,
      sourceFolderId: folderId
    }));
    releaseScanObjectUrls(scannedItems);
    const currentFolder = await findFolder(folderId);
    if (!currentFolder?.libraryMode) {
      return {
        folderId,
        status: 'error',
        trackCount: 0,
        addedCount: 0,
        updatedCount: 0,
        removedCount: 0,
        failure: 'cancelled'
      };
    }
    const reconciliation = libraryStore.reconcileFolder(
      folderId,
      scannedItems,
      filesystemFolders.getSnapshot().map((candidate) => candidate.id)
    );
    const now = Date.now();

    await filesystemFolders.updateScan(folderId, {
      lastScanAt: now,
      lastScanStatus: 'success',
      lastScanTrackCount: scannedItems.length,
      lastScanFailure: undefined
    });

    return {
      folderId,
      status: 'success',
      trackCount: scannedItems.length,
      addedCount: reconciliation.addedItems.length,
      updatedCount: reconciliation.updatedItems.length,
      removedCount: reconciliation.removedItems.length
    };
  } catch (error) {
    console.warn('Library folder scan failed.', error);
    await filesystemFolders.updateScan(folderId, {
      lastScanAt: Date.now(),
      lastScanStatus: 'error',
      lastScanFailure: 'scan-failed'
    });
    return {
      folderId,
      status: 'error',
      trackCount: 0,
      addedCount: 0,
      updatedCount: 0,
      removedCount: 0,
      failure: 'scan-failed'
    };
  }
}

export function scanLibraryFolder(folderId: string): Promise<LibraryFolderScanResult> {
  const active = activeScans.get(folderId);
  if (active) return active;

  const scan = performScan(folderId).finally(() => activeScans.delete(folderId));
  activeScans.set(folderId, scan);
  return scan;
}

export async function scanLaunchLibraryFolders(): Promise<LibraryFolderScanResult[]> {
  await filesystemFolders.ready();
  await filesystemFolders.refresh();
  const folders = filesystemFolders.getSnapshot().filter((folder) => folder.libraryMode === 'launch');
  return await Promise.all(folders.map((folder) => scanLibraryFolder(folder.id)));
}
