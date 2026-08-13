import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import { createTrackCollectionStore } from './playlist';

function item(id: string, overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id,
    name: 'Track.flac',
    format: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    path: 'Music/Artist/Track.flac',
    ...overrides
  };
}

describe('library folder reconciliation', () => {
  it('applies verified external updates without changing identity or play count', () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-external-update', dedupe: true });
    store.add([
      item('stable-id', {
        metadata: { title: 'Old title', artist: 'Artist', playCount: 9 }
      })
    ]);

    store.applyExternalUpdate('stable-id', {
      path: 'Music/Artist/Renamed.flac',
      name: 'Renamed.flac',
      size: 120,
      lastModified: 2,
      metadata: { title: 'New title', album: 'Album', playCount: 0 }
    });

    expect(get(store.items)[0]).toMatchObject({
      id: 'stable-id',
      path: 'Music/Artist/Renamed.flac',
      name: 'Renamed.flac',
      size: 120,
      lastModified: 2,
      metadata: { title: 'New title', album: 'Album', playCount: 9 }
    });
    expect(get(store.items)[0].metadata?.artist).toBeUndefined();
  });

  it('applies folder plans only against the catalog revision they were built from', async () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-plan-revision', dedupe: true });
    store.add([item('existing')]);
    const snapshot = store.getCatalogSnapshot();
    const planned = item('planned', { path: 'Music/Artist/Planned.flac' });
    const plan = {
      nextCatalog: [...snapshot.entities, planned],
      addedItems: [planned],
      updatedItems: [],
      removedItems: [],
      sourceRegistrations: [],
      sourceDeletions: [],
      duplicates: []
    };

    store.setSelection({ ids: ['existing'], anchorId: 'existing', focusId: 'existing' });
    await expect(store.applyCatalogIfRevision(snapshot.catalogRevision, plan)).resolves.toEqual({
      status: 'applied'
    });
    expect(get(store.items).map((entry) => entry.id)).toEqual(['existing', 'planned']);

    await expect(store.applyCatalogIfRevision(snapshot.catalogRevision, plan)).resolves.toEqual({
      status: 'conflict',
      actualCatalogRevision: snapshot.catalogRevision + 1
    });
  });
});
