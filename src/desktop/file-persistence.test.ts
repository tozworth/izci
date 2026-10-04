import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const platform = vi.hoisted(() => ({ enabled: true, materializeFile: vi.fn() }));
vi.mock('$platform', async () => {
  const { createNativeFilesystem } = await import('../platform/native-filesystem');
  const { filesystem: browser } = await import('../platform/web-filesystem');
  const native = createNativeFilesystem({ referenceScheme: 'file:', materializeFile: platform.materializeFile } as never, { accessModel: 'os-permissions' });
  return { get filesystem() { return platform.enabled ? native : browser; } };
});
import { restoreStoredItem, serializeItem } from '$lib/stores/queue-persistence';
import { materializeTrackItem } from '$lib/stores/queue-materialization';

describe('native file references', () => {
  const item: TrackItem = {
    id: 'native-song', name: 'şarkı.hvl', extension: 'hvl', kind: 'module', size: 42, lastModified: 3,
    path: 'C:/Music/şarkı.hvl', nativeFile: { uri: 'file:///C:/Music/%C5%9Fark%C4%B1.hvl' }
  };
  beforeEach(() => { platform.enabled = true; vi.resetAllMocks(); });
  afterEach(() => vi.restoreAllMocks());
  it('persists a canonical native path without blobs or synthetic browser handles', () => {
    const stored = serializeItem({ ...item, file: new File(['hively'], item.name) });
    expect(stored).toMatchObject({ path: item.path, nativeFile: item.nativeFile });
    expect(stored).not.toHaveProperty('file');
    expect(stored?.fileHandle).toBeUndefined();
    expect(restoreStoredItem(stored)).toMatchObject(item);
    expect(serializeItem({ ...item, nativeFile: undefined })).toBeNull();
  });
  it('does not admit native references into the browser persistence path', () => {
    platform.enabled = false;
    expect(serializeItem(item)).toBeNull();
    expect(restoreStoredItem(item)).toBeNull();
  });
  it('restores Hively and OpenMPT files without object URLs', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    for (const extension of ['hvl', 'xm']) {
      const file = new File(['module'], `song.${extension}`);
      platform.materializeFile.mockResolvedValue(file);
      const loaded = await materializeTrackItem({ ...item, extension });
      expect(loaded).toMatchObject({ id: item.id, file, kind: 'module', extension });
      expect(loaded?.objectUrl).toBeUndefined();
    }
    expect(objectUrl).not.toHaveBeenCalled();
  });
  it('restores streams and videos through disk-backed Files and object URLs', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media');
    for (const extension of ['flac', 'mkv']) {
      platform.materializeFile.mockResolvedValue(new File(['media'], `song.${extension}`));
      expect(await materializeTrackItem({ ...item, extension })).toMatchObject({ objectUrl: 'blob:media', extension });
    }
    expect(objectUrl).toHaveBeenCalledTimes(2);
  });
  it('rejects Android references and malformed local references in the desktop profile', () => {
    for (const uri of ['content://provider/document/song', 'https://example.com/song', 'file:relative', 'file:///C:/Music/song.flac#fragment']) {
      expect(serializeItem({ ...item, nativeFile: { uri } })).toBeNull();
      expect(restoreStoredItem({ ...item, nativeFile: { uri } })).toBeNull();
    }
  });
  it('retains unknown-extension modules accepted by the shared probe on reload', async () => {
    platform.materializeFile.mockResolvedValue(new File(['module'], 'song.unfamiliar'));
    expect(await materializeTrackItem({ ...item, extension: 'unfamiliar' })).toMatchObject({ kind: 'module', extension: 'unfamiliar' });
  });
});
