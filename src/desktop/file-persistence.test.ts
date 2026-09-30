import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const platform = vi.hoisted(() => ({ desktop: true, materializePlatformFile: vi.fn() }));
vi.mock('$platform', () => ({ get isDesktop() { return platform.desktop; }, materializePlatformFile: platform.materializePlatformFile }));
import { restoreStoredItem, serializeItem } from '$lib/stores/queue-persistence';
import { materializeTrackItem } from '$lib/stores/queue-materialization';

describe('native file references', () => {
  const item: TrackItem = {
    id: 'native-song', name: 'şarkı.hvl', extension: 'hvl', kind: 'module', size: 42, lastModified: 3,
    path: 'C:/Music/şarkı.hvl', desktopFile: true
  };
  beforeEach(() => { platform.desktop = true; vi.resetAllMocks(); });
  afterEach(() => vi.restoreAllMocks());
  it('persists a canonical native path without blobs or synthetic browser handles', () => {
    const stored = serializeItem({ ...item, file: new File(['hively'], item.name) });
    expect(stored).toMatchObject({ path: item.path, desktopFile: true });
    expect(stored).not.toHaveProperty('file');
    expect(stored?.fileHandle).toBeUndefined();
    expect(restoreStoredItem(stored)).toMatchObject(item);
    expect(serializeItem({ ...item, path: undefined })).toBeNull();
  });
  it('does not admit native references into the browser persistence path', () => {
    platform.desktop = false;
    expect(serializeItem(item)).toBeNull();
    expect(restoreStoredItem(item)).toBeNull();
  });
  it('restores Hively and OpenMPT files without object URLs', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL');
    for (const extension of ['hvl', 'xm']) {
      const file = new File(['module'], `song.${extension}`);
      platform.materializePlatformFile.mockResolvedValue(file);
      const loaded = await materializeTrackItem({ ...item, extension });
      expect(loaded).toMatchObject({ id: item.id, file, kind: 'module', extension });
      expect(loaded?.objectUrl).toBeUndefined();
    }
    expect(objectUrl).not.toHaveBeenCalled();
  });
  it('restores streams and videos through disk-backed Files and object URLs', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:media');
    for (const extension of ['flac', 'mkv']) {
      platform.materializePlatformFile.mockResolvedValue(new File(['media'], `song.${extension}`));
      expect(await materializeTrackItem({ ...item, extension })).toMatchObject({ objectUrl: 'blob:media', extension });
    }
    expect(objectUrl).toHaveBeenCalledTimes(2);
  });
});
