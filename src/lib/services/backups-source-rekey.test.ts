import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import { mediaSources } from '$lib/media/media-source';
import { favoritesStore, libraryStore } from '$lib/stores/playlist';
import { restoreFavorites } from './backups';

describe('backup favorite source restoration', () => {
  it('rekeys a matched library locator onto the restored favorite ID and subsong', () => {
    const libraryItem: MediaEntity = {
      id: 'restore-library-source',
      path: 'Music/Module.xm',
      name: 'Module.xm',
      format: 'xm',
      kind: 'module',
      size: 123,
      lastModified: 456,
      metadata: { title: 'Module', subsongs: 3, embeddedMetadataLoaded: true }
    };
    const handle = {
      kind: 'file',
      name: libraryItem.name,
      getFile: async () => new File([], libraryItem.name)
    } as FileSystemFileHandle;
    mediaSources.registerHandle(libraryItem.id, handle, 'granted');
    libraryStore.add([libraryItem]);

    const result = restoreFavorites([{
      ...libraryItem,
      id: 'restored-favorite-source',
      subsong: 2,
      rating: 4.5
    }]);

    expect(result).toEqual({ restored: 1, pending: [] });
    expect(get(favoritesStore.items)).toContainEqual(expect.objectContaining({
      id: 'restored-favorite-source',
      subsong: 2,
      rating: 4.5
    }));
    expect(mediaSources.get('restored-favorite-source')).toMatchObject({
      entityId: 'restored-favorite-source',
      fileHandle: handle
    });
    expect(mediaSources.referenceCount('restored-favorite-source')).toBe(1);

    favoritesStore.remove(['restored-favorite-source']);
    libraryStore.remove([libraryItem.id]);
  });

  it('leaves a favorite pending when its matched catalog item has no locator', () => {
    const libraryItem: MediaEntity = {
      id: 'missing-library-source',
      path: 'Music/Missing.flac',
      name: 'Missing.flac',
      format: 'flac',
      kind: 'stream',
      size: 10,
      lastModified: 20
    };
    libraryStore.add([libraryItem]);

    const record = { ...libraryItem, id: 'pending-favorite-source' };
    expect(restoreFavorites([record])).toEqual({ restored: 0, pending: [record] });
    expect(get(favoritesStore.items)).not.toContainEqual(
      expect.objectContaining({ id: record.id })
    );

    libraryStore.remove([libraryItem.id]);
  });
});
