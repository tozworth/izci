import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTrackItems, getTrackIdentity, registerImportedFile } from '$lib/utils/files';
import { serializeItem, restoreStoredItem } from '$lib/stores/queue-persistence';
import { materializeTrackItem } from '$lib/stores/queue-materialization';
import { createTrackCollectionStore } from '$lib/stores/queue';
import { get } from 'svelte/store';

const native = vi.hoisted(() => ({ materializeFile: vi.fn() }));
vi.mock('$platform', async (importOriginal) => ({ ...await importOriginal<object>(), nativeFilesystem: native }));
afterEach(() => vi.clearAllMocks());

function nativeTrack(uri = 'content://provider/tree/Music/document/song', name = 'song.flac') {
  return buildTrackItems([registerImportedFile(new File(['data'], name), { nativeFile: { uri }, path: `Music/${name}` })])[0];
}

describe('SAF collection persistence', () => {
  it('deduplicates a document selected directly and through a tree, preserving case-sensitive document IDs', () => {
    const tree = nativeTrack('content://provider/tree/Music/document/Music%3ASong.flac');
    const direct = nativeTrack('content://provider/document/Music%3ASong.flac');
    const lower = nativeTrack('content://provider/document/Music%3Asong.flac');
    expect(getTrackIdentity(tree)).toBe(getTrackIdentity(direct));
    expect(getTrackIdentity(tree)).not.toBe(getTrackIdentity(lower));
    const library = createTrackCollectionStore({ dbName: 'test-native-dedupe', dedupe: true });
    library.add([tree, direct]);
    expect(get(library.items)).toEqual([tree]);
  });
  it('round-trips URI references without blobs, JS methods or synthetic FSA handles', () => {
    const item = nativeTrack();
    expect(item.file).toBeUndefined(); expect(item.fileHandle).toBeUndefined(); expect(item.objectUrl).toBeUndefined();
    const stored = structuredClone(serializeItem(item));
    expect(stored).not.toHaveProperty('file'); expect(stored).not.toHaveProperty('objectUrl');
    expect(restoreStoredItem(stored)).toMatchObject({ id: item.id, nativeFile: item.nativeFile, path: item.path });
    expect(serializeItem({ ...item, nativeFile: undefined })).toBeNull();
  });
  it('restores verified modules with unfamiliar extensions through the native provider', async () => {
    const item = { ...nativeTrack(), name: 'song.weird', extension: 'weird', kind: 'module' as const };
    native.materializeFile.mockResolvedValue(new File(['module'], 'song.weird'));
    const restored = restoreStoredItem(serializeItem(item))!;
    expect(await materializeTrackItem(restored)).toMatchObject({ kind: 'module', file: expect.any(File), nativeFile: item.nativeFile });
  });
  it('keeps IDs, play counts and ratings on rescan; distinct providers do not collide by display path', () => {
    const store = createTrackCollectionStore({ dbName: 'test-native', dedupe: true });
    const first = nativeTrack();
    const other = nativeTrack('content://other/tree/Music/document/song');
    expect(getTrackIdentity(first)).not.toBe(getTrackIdentity(other));
    store.add([{ ...first, sourceFolderId: 'folder', rating: 4, metadata: { playCount: 9 } }, other]);
    store.reconcileFolder('folder', [{ ...first, id: 'new-scan-id' }], ['folder']);
    expect(get(store.items)).toHaveLength(2);
    expect(get(store.items)[0]).toMatchObject({ id: first.id, rating: 4, metadata: { playCount: 9 }, nativeFile: first.nativeFile });
    store.reconcileFolder('folder', [], ['folder']);
    expect(get(store.items)).toEqual([other]);
  });
});
