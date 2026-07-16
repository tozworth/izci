import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import { createTrackCollectionStore } from './playlist';

function item(id: string, overrides: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id,
    name: 'Track.flac',
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    path: 'Music/Artist/Track.flac',
    ...overrides
  };
}

describe('library folder reconciliation', () => {
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
});
