import { describe, expect, it } from 'vitest';

import { splitUniqueItems } from './queue-dedupe';
import { createTrackCollectionStore } from './queue';
import type { TrackItem } from '$lib/types';

function item(id: string, overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    ...overrides
  };
}

describe('queue dedupe', () => {
  it('returns all items when dedupe is disabled', () => {
    const sourceItems = [item('a'), item('a-copy', { name: 'a.flac' })];

    expect(splitUniqueItems(sourceItems, { dedupe: false })).toEqual({
      uniqueItems: sourceItems,
      duplicateItems: []
    });
  });

  it('dedupes against existing items and earlier source items by stable track identity', () => {
    const existing = [item('existing', { path: '/Music/Alpha.flac' })];
    const unique = item('unique', { path: '/Music/Beta.flac' });
    const duplicateOfExisting = item('duplicate-existing', { path: '/music/alpha.flac' });
    const duplicateOfSource = item('duplicate-source', { path: '/Music/Beta.flac' });

    expect(
      splitUniqueItems([duplicateOfExisting, unique, duplicateOfSource], {
        dedupe: true,
        existingItems: existing
      })
    ).toEqual({
      uniqueItems: [unique],
      duplicateItems: [duplicateOfExisting, duplicateOfSource]
    });
  });

  it('accepts a collection-specific identity resolver', () => {
    const first = item('first', { name: 'module.xm', kind: 'module', extension: 'xm', subsong: 0 });
    const second = item('second', { name: 'module.xm', kind: 'module', extension: 'xm', subsong: 1 });

    expect(splitUniqueItems([first, second], {
      dedupe: true,
      getIdentity: (entry) => `${entry.name}:${entry.subsong ?? 'all'}`
    }).uniqueItems).toEqual([first, second]);
  });

  it('supports a live dedupe preference and resolves an existing equivalent', () => {
    let dedupe = true;
    const store = createTrackCollectionStore({
      dbName: 'test-queue-live-dedupe',
      dedupe: () => dedupe
    });
    const first = item('first', { path: '/Music/Alpha.wav', name: 'Alpha.wav', extension: 'wav' });
    const duplicate = item('duplicate', { path: '/music/alpha.wav', name: 'Alpha.wav', extension: 'wav' });

    expect(store.add([first])).toEqual([first]);
    expect(store.add([duplicate])).toEqual([]);
    expect(store.findEquivalent(duplicate)?.id).toBe(first.id);

    dedupe = false;
    expect(store.add([duplicate])).toEqual([duplicate]);
  });
});
