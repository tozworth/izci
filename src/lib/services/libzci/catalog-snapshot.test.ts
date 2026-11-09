import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  isCatalogSnapshotStale,
  toCatalogSnapshotView,
  toSvelteRating,
  type CoreCatalogPage
} from './catalog-snapshot';
import { createCoreCatalogFacade } from './catalog-facade';

const page: CoreCatalogPage = {
  revision: 11,
  total: 2,
  rows: [
    {
      id: 1,
      kind: 'audio',
      in_library: true,
      source: { key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' },
      metadata: { title: 'One', artist: 'Artist', album: 'Album', duration_seconds: 180 },
      facts: { favorite: true, rating: 9, play_count: 3, last_played_ms: 123 }
    },
    {
      id: 2,
      kind: 'audio',
      in_library: false,
      source: { key: 'b', kind: 'ephemeral', locator: 'blob:b', display_path: 'plain.ogg' },
      metadata: { title: '', artist: '', album: '', duration_seconds: null },
      facts: { favorite: false, rating: 0, play_count: 0, last_played_ms: null }
    }
  ]
};

describe('core catalog snapshot probe', () => {
  it('maps ratings and restorable flags', () => {
    expect(toSvelteRating(0)).toBeUndefined();
    expect(toSvelteRating(9)).toBe(4.5);
    expect(toSvelteRating(10)).toBe(5);

    const view = toCatalogSnapshotView(page);
    expect(view.revision).toBe(11);
    expect(view.total).toBe(2);
    expect(view.rows).toEqual([
      {
        mediaId: 1,
        title: 'One',
        artist: 'Artist',
        album: 'Album',
        kind: 'audio',
        inLibrary: true,
        favorite: true,
        rating: 4.5,
        playCount: 3,
        restorable: true
      },
      {
        mediaId: 2,
        title: 'plain.ogg',
        artist: '',
        album: '',
        kind: 'audio',
        inLibrary: false,
        favorite: false,
        rating: undefined,
        playCount: 0,
        restorable: false
      }
    ]);
  });

  it('guards re-renders on the core revision', () => {
    expect(isCatalogSnapshotStale(null, page)).toBe(true);
    expect(isCatalogSnapshotStale(11, page)).toBe(false);
    expect(isCatalogSnapshotStale(10, { ...page, revision: 12 })).toBe(true);
  });

  it('ignores duplicate and out-of-order revisions', () => {
    const facade = createCoreCatalogFacade();
    expect(get(facade.view)).toBeNull();
    facade.pushObservation(page);
    const applied = get(facade.view);
    expect(get(facade.revision)).toBe(11);

    facade.pushObservation(page);
    expect(get(facade.view)).toBe(applied);

    facade.pushObservation({ ...page, revision: 9 });
    expect(get(facade.revision)).toBe(11);

    facade.pushObservation({ ...page, revision: 12, total: 3 });
    expect(get(facade.revision)).toBe(12);
    expect(get(facade.view)?.total).toBe(3);
  });
});
