import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { TrackItem } from '$lib/types';
import { createTrackCollectionStore } from './queue';

function item(id: string): TrackItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    path: `Music/${id}.flac`
  };
}

describe('track collection moveBy', () => {
  it('swaps an item with its neighbour and reports the move', () => {
    const store = createTrackCollectionStore({ dbName: 'test-queue-move', dedupe: false });
    store.add([item('a'), item('b'), item('c')]);

    expect(store.moveBy('b', -1)).toBe(true);
    expect(get(store.items).map((entry) => entry.id)).toEqual(['b', 'a', 'c']);

    expect(store.moveBy('c', -1)).toBe(true);
    expect(get(store.items).map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('refuses moves past the ends and unknown ids', () => {
    const store = createTrackCollectionStore({ dbName: 'test-queue-move-bounds', dedupe: false });
    store.add([item('a'), item('b')]);

    expect(store.moveBy('a', -1)).toBe(false);
    expect(store.moveBy('b', 1)).toBe(false);
    expect(store.moveBy('missing', 1)).toBe(false);
    expect(get(store.items).map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
