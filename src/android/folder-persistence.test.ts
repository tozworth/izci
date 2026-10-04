import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

const native = vi.hoisted(() => ({ referenceScheme: 'content:',
  pickFolder: vi.fn(), queryFolderPermission: vi.fn(), requestFolderPermission: vi.fn(), readFolder: vi.fn()
}));
vi.mock('$platform', async () => {
  const { createNativeFilesystem } = await import('../platform/native-filesystem');
  return { filesystem: createNativeFilesystem(native as never, { accessModel: 'persisted-grants' }) };
});
vi.mock('$lib/services/logging', () => ({ logInfo: vi.fn(), logWarning: vi.fn(), logError: vi.fn() }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubGlobal('window', { indexedDB: new IDBFactory() });
  native.queryFolderPermission.mockResolvedValue('granted');
});
afterEach(() => vi.unstubAllGlobals());

describe('SAF managed folders in IndexedDB', () => {
  it('retains the root, scan preferences and stable ID after a fresh service instance without requesting permission', async () => {
    const first = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    await first.ready();
    const root = { uri: 'content://provider/tree/Music', name: 'Music' };
    const folder = await first.remember(root, { libraryMode: 'launch' });
    await first.updateScan(folder.id, { lastScanStatus: 'success', lastScanTrackCount: 3, lastScanAt: 10 });
    vi.resetModules();
    const restarted = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    await restarted.ready();
    expect(restarted.getSnapshot()).toMatchObject([{ id: folder.id, nativeFolder: root, libraryMode: 'launch', permission: 'granted', lastScanTrackCount: 3 }]);
    expect(restarted.getSnapshot()[0].handle).toBeUndefined();
    expect((await restarted.remember(root)).id).toBe(folder.id);
    expect(restarted.getSnapshot()).toHaveLength(1);
    expect(native.pickFolder).not.toHaveBeenCalled();
    expect(native.requestFolderPermission).not.toHaveBeenCalled();
  });
  it('keeps unavailable roots on restart and recovers access only through the explicit action', async () => {
    const first = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    await first.ready();
    const folder = await first.remember({ uri: 'content://provider/tree/Music', name: 'Music' }, { libraryMode: 'launch' });
    native.queryFolderPermission.mockResolvedValue('prompt');
    vi.resetModules();
    const restarted = (await import('$lib/services/filesystem-folders')).filesystemFolders;
    await restarted.ready();
    expect(restarted.getSnapshot()).toMatchObject([{ id: folder.id, permission: 'prompt', libraryMode: 'launch' }]);
    expect(native.requestFolderPermission).not.toHaveBeenCalled();
    native.requestFolderPermission.mockResolvedValue('denied');
    expect(await restarted.requestPermission(folder.id)).toBe('denied');
    expect(restarted.getSnapshot()[0].permission).toBe('denied');
    native.requestFolderPermission.mockResolvedValue('granted');
    expect(await restarted.requestPermission(folder.id)).toBe('granted');
    expect(restarted.getSnapshot()[0].id).toBe(folder.id);
    await restarted.forget(folder.id);
    expect(restarted.getSnapshot()).toEqual([]);
  });
});
