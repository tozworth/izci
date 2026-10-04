import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesystemFolder } from './filesystem-folders';
const calls = vi.hoisted(() => ({
  folders: [] as FilesystemFolder[], ready: vi.fn(), refresh: vi.fn(), access: vi.fn(), update: vi.fn(),
  read: vi.fn(), reconcile: vi.fn()
}));
vi.mock('./filesystem-folders', () => ({
  filesystemFolders: { ready: calls.ready, refresh: calls.refresh, getSnapshot: () => calls.folders, updateScan: calls.update },
  queryFilesystemFolderAccess: calls.access
}));
vi.mock('./filesystem-folder-files', () => ({ readFilesystemFolderFiles: calls.read }));
vi.mock('$lib/stores/queue', () => ({ libraryStore: { reconcileFolder: calls.reconcile } }));
vi.mock('$lib/stores/track-settings', () => ({ trackSettings: { getSnapshot: () => ({ folderNestingLimit: 8 }) } }));
import { scanLaunchLibraryFolders } from './library-folder-scanner';

beforeEach(() => {
  vi.resetAllMocks();
  calls.folders = [{ id: 'native-root', name: 'Music', nativeFolder: { uri: 'file:///C:/Music', name: 'Music' }, addedAt: 1, permission: 'granted', libraryMode: 'launch', lastScanStatus: 'never' }];
  calls.access.mockResolvedValue('granted');
  calls.reconcile.mockReturnValue({ addedItems: [], updatedItems: [], removedItems: [] });
});

describe('managed native folder launch scans', () => {
  it('uses the existing depth and reconciles only the selected folder', async () => {
    calls.read.mockResolvedValue([new File(['module'], 'song.xm')]);
    expect(await scanLaunchLibraryFolders()).toMatchObject([{ folderId: 'native-root', status: 'success', trackCount: 1 }]);
    expect(calls.read).toHaveBeenCalledWith(calls.folders[0], 8);
    expect(calls.reconcile).toHaveBeenCalledWith('native-root', [expect.objectContaining({ sourceFolderId: 'native-root', name: 'song.xm' })], ['native-root']);
  });
  it('retains the library when a native scan fails partway through', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    calls.read.mockRejectedValue(new Error('A subdirectory is unavailable'));
    expect(await scanLaunchLibraryFolders()).toMatchObject([{ status: 'error', failure: 'scan-failed' }]);
    expect(calls.reconcile).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it('does not enumerate or reconcile unavailable roots at launch', async () => {
    calls.access.mockResolvedValue('unavailable');
    expect(await scanLaunchLibraryFolders()).toMatchObject([{ status: 'permission-required' }]);
    expect(calls.read).not.toHaveBeenCalled();
    expect(calls.reconcile).not.toHaveBeenCalled();
  });
});
