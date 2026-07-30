import { describe, expect, it } from 'vitest';
import {
  clipDuration,
  createInitialClipState,
  cutSelection,
  keepSelection,
  replaceSelectionRanges,
  sliceClipRanges,
  updateSelection
} from './clip-audio';

describe('clip edit ranges', () => {
  it('cuts a logical selection without changing source coordinates', () => {
    const initial = updateSelection(createInitialClipState(10), 2, 5);
    const cut = cutSelection(initial);

    expect(cut.ranges).toEqual([{ start: 0, end: 2 }, { start: 5, end: 10 }]);
    expect(clipDuration(cut)).toBe(7);
    expect(cut.selectionStart).toBe(2);
    expect(cut.selectionEnd).toBe(2);
  });

  it('keeps selections spanning existing cuts', () => {
    const cut = cutSelection(updateSelection(createInitialClipState(10), 2, 5));
    const kept = keepSelection(updateSelection(cut, 1, 4));

    expect(kept.ranges).toEqual([{ start: 1, end: 2 }, { start: 5, end: 7 }]);
    expect(clipDuration(kept)).toBe(3);
    expect(kept.selectionEnd).toBe(3);
  });

  it('clamps reversed selections to the clip duration', () => {
    expect(updateSelection(createInitialClipState(4), 9, -2)).toMatchObject({
      selectionStart: 0,
      selectionEnd: 4
    });
  });

  it('copies source provenance across existing cuts', () => {
    const cut = cutSelection(updateSelection(createInitialClipState(10), 2, 5));

    expect(sliceClipRanges(cut.ranges, 1, 4)).toEqual([
      { start: 1, end: 2 },
      { start: 5, end: 7 }
    ]);
  });

  it('replaces a selection with copied source ranges', () => {
    const state = updateSelection(createInitialClipState(10), 3, 6);
    const pasted = replaceSelectionRanges(state, [{ start: 8, end: 10 }]);

    expect(pasted.ranges).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 10 },
      { start: 6, end: 10 }
    ]);
    expect(clipDuration(pasted)).toBe(9);
    expect(pasted).toMatchObject({ selectionStart: 3, selectionEnd: 5 });
  });
});
