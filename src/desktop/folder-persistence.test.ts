import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
const native = vi.hoisted(() => ({ referenceScheme: 'file:', queryFolderPermission: vi.fn(), requestFolderPermission: vi.fn(), pickFolder: vi.fn() }));
vi.mock('$platform', () => ({ nativeFilesystem: native }));
vi.mock('$lib/services/logging', () => ({ logInfo: vi.fn(), logWarning: vi.fn(), logError: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubGlobal('window', { indexedDB: new IDBFactory() });
  native.queryFolderPermission.mockResolvedValue('granted');
});
afterEach(() => vi.unstubAllGlobals());

describe('native Windows managed-folder persistence', () => {
  it('restores scan settings and deduplicates the root without prompting on restart', async () => {
    const first = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    const root = { uri: 'file:///C:/Music', name: 'Music' };
    const folder = await first.remember(root, { libraryMode: 'launch' });
    await first.updateScan(folder.id, { lastScanStatus: 'success', lastScanTrackCount: 10 });
    vi.resetModules();
    const restarted = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    await restarted.ready();
    expect(restarted.getSnapshot()).toMatchObject([{ id: folder.id, nativeFolder: root, libraryMode: 'launch', lastScanTrackCount: 10 }]);
    expect((await restarted.remember({ uri: 'file:///c:/music', name: 'music' })).id).toBe(folder.id);
    expect(restarted.getSnapshot()).toHaveLength(1);
    expect(native.pickFolder).not.toHaveBeenCalled();
    expect(native.requestFolderPermission).not.toHaveBeenCalled();
  });
  it('retains disconnected roots and rejects SAF roots in the desktop profile', async () => {
    const folders = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    const folder = await folders.remember({ uri: 'file://nas/Music', name: 'Music' });
    native.queryFolderPermission.mockResolvedValue('unavailable');
    await folders.refresh();
    expect(folders.getSnapshot()).toMatchObject([{ id: folder.id, permission: 'unavailable' }]);
    await expect(folders.remember({ uri: 'content://provider/tree/Music', name: 'Music' })).rejects.toThrow();
  });
});
