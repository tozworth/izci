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

  it('adopts matching manual tracks and preserves their identity and metadata', () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-adopt', dedupe: true });
    store.add([item('manual', { metadata: { title: 'Track', playCount: 4 } })]);

    const result = store.reconcileFolder('music-root', [item('scan')], ['music-root']);
    const [track] = get(store.items);

    expect(result.addedItems).toHaveLength(0);
    expect(track).toMatchObject({
      id: 'manual',
      sourceFolderId: 'music-root',
      metadata: { title: 'Track', playCount: 4 }
    });
  });

  it('refreshes changed files while preserving only their play count', () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-change', dedupe: true });
    store.add([
      item('managed', {
        sourceFolderId: 'music-root',
        metadata: { title: 'Old title', duration: 10, playCount: 7 }
      })
    ]);

    const result = store.reconcileFolder(
      'music-root',
      [item('scan', { size: 200, lastModified: 2 })],
      ['music-root']
    );
    const [track] = get(store.items);

    expect(result.updatedItems).toHaveLength(1);
    expect(track.id).toBe('managed');
    expect(track.size).toBe(200);
    expect(track.metadata).toEqual({ playCount: 7 });
  });

  it('removes missing managed tracks without touching tracks owned elsewhere', () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-remove', dedupe: true });
    store.add([
      item('missing', { sourceFolderId: 'music-root' }),
      item('other', { sourceFolderId: 'other-root', path: 'Other/Track.flac' })
    ]);

    const result = store.reconcileFolder('music-root', [], ['music-root', 'other-root']);

    expect(result.removedItems.map((track) => track.id)).toEqual(['missing']);
    expect(get(store.items).map((track) => track.id)).toEqual(['other']);
  });

  it('re-adopts tracks orphaned when a filesystem root was forgotten', () => {
    const store = createTrackCollectionStore({ dbName: 'test-library-orphan', dedupe: true });
    store.add([item('orphan', { sourceFolderId: 'forgotten-root' })]);

    store.reconcileFolder('new-root', [item('scan')], ['new-root']);

    expect(get(store.items)).toHaveLength(1);
    expect(get(store.items)[0]).toMatchObject({ id: 'orphan', sourceFolderId: 'new-root' });
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
