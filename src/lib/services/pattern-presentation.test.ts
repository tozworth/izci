import { describe, expect, it } from 'vitest';
import { isPatternCellEmpty, splitPatternCell } from './pattern-presentation';

describe('pattern presentation', () => {
  it('splits a formatted libopenmpt cell into semantic columns', () => {
    expect(splitPatternCell('C-5 01v48 A06')).toEqual({
      note: 'C-5',
      instrument: '01',
      volume: 'v48',
      effect: 'A06'
    });

    expect(splitPatternCell('F#6 18v30 8FF')).toEqual({
      note: 'F#6',
      instrument: '18',
      volume: 'v30',
      effect: '8FF'
    });
  });

  it('fills missing columns and recognizes empty cells', () => {
    expect(splitPatternCell('')).toEqual({ note: '...', instrument: '..', volume: '..', effect: '...' });
    expect(isPatternCellEmpty('... .. .. ...')).toBe(true);
    expect(isPatternCellEmpty('... ..v32 ...')).toBe(false);
  });
});
