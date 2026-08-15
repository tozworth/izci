import { describe, expect, it } from 'vitest';

import {
  buildSelectAllSelection,
  emptySelection,
  normalizeSelection,
  normalizeStoredSelection,
  removeIdsFromSelection,
  resolveSelectSelection
} from './queue-selection';
import type { TrackItem, TrackSelection } from '$lib/types';

function item(id: string): TrackItem {
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind: 'stream',
    size: 0,
    lastModified: 0
  };
}

describe('queue selection helpers', () => {
  const items = [item('a'), item('b'), item('c'), item('d')];

  it('normalizes selected ids into queue order and drops stale focus ids', () => {
    const selection: TrackSelection = {
      ids: ['d', 'missing', 'b'],
      anchorId: 'c',
      focusId: 'missing'
    };

    expect(normalizeSelection(items, selection)).toEqual({
      ids: ['b', 'd'],
      anchorId: 'c',
      focusId: 'd'
    });
  });

  it('normalizes malformed stored selections against existing ids', () => {
    expect(
      normalizeStoredSelection(
        {
          ids: ['c', 1, 'a', 'missing'],
          anchorId: 'missing',
          focusId: 'c'
        },
        new Set(items.map((track) => track.id))
      )
    ).toEqual({
      ids: ['c', 'a'],
      anchorId: 'c',
      focusId: 'c'
    });
  });

  it('supports single, toggle, and range selection without losing the anchor', () => {
    const selectedB = resolveSelectSelection(items, emptySelection, 'b');
    const rangeToD = resolveSelectSelection(items, selectedB, 'd', { range: true });
    const toggledC = resolveSelectSelection(items, rangeToD, 'c', { toggle: true });
    const additiveRange = resolveSelectSelection(items, toggledC, 'a', { range: true, toggle: true });

    expect(selectedB).toEqual({ ids: ['b'], anchorId: 'b', focusId: 'b' });
    expect(rangeToD).toEqual({ ids: ['b', 'c', 'd'], anchorId: 'b', focusId: 'd' });
    expect(toggledC).toEqual({ ids: ['b', 'd'], anchorId: 'c', focusId: 'd' });
    expect(additiveRange).toEqual({ ids: ['a', 'b', 'c', 'd'], anchorId: 'c', focusId: 'a' });
  });

  it('builds select-all state and keeps remaining selected ids after removal', () => {
    const all = buildSelectAllSelection(items);

    expect(all).toEqual({
      ids: ['a', 'b', 'c', 'd'],
      anchorId: 'a',
      focusId: 'd'
    });

    expect(removeIdsFromSelection(items, all, new Set(['a', 'd']))).toEqual({
      ids: ['b', 'c'],
      anchorId: 'c',
      focusId: 'c'
    });
  });

  it('builds select-all state from the displayed projection only', () => {
    expect(buildSelectAllSelection([items[1], items[3]])).toEqual({
      ids: ['b', 'd'],
      anchorId: 'b',
      focusId: 'd'
    });
  });

  it('selects the next available item when removing the active selection', () => {
    const selection = resolveSelectSelection(items, emptySelection, 'b');
    const remainingItems = [item('a'), item('c'), item('d')];

    expect(removeIdsFromSelection(remainingItems, selection, new Set(['b']), items)).toEqual({
      ids: ['c'],
      anchorId: 'c',
      focusId: 'c'
    });
  });

  it('selects the previous item when removing the active selection at the end', () => {
    const selection = resolveSelectSelection(items, emptySelection, 'd');
    const remainingItems = [item('a'), item('b'), item('c')];

    expect(removeIdsFromSelection(remainingItems, selection, new Set(['d']), items)).toEqual({
      ids: ['c'],
      anchorId: 'c',
      focusId: 'c'
    });
  });
});
