import { describe, expect, it } from 'vitest';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history';

describe('Troubadour workbench history', () => {
  it('undoes and redoes staged states without mutating prior history', () => {
    const initial = createHistory({ title: 'Original' });
    const changed = pushHistory(initial, { title: 'Changed' });
    const undone = undoHistory(changed);
    expect(undone.present.title).toBe('Original');
    expect(redoHistory(undone).present.title).toBe('Changed');
    expect(initial.undo).toEqual([]);
  });
});
