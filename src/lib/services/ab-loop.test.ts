import { describe, expect, it } from 'vitest';

import { canEnableAbLoop, resolveAbLoopRange } from './ab-loop';

describe('A-B loop range', () => {
  it('resolves an active range with start before end', () => {
    expect(resolveAbLoopRange({ active: true, start: 10, end: 20 })).toEqual({ start: 10, end: 20 });
  });

  it('returns null when the loop is not active', () => {
    expect(resolveAbLoopRange({ active: false, start: 10, end: 20 })).toBeNull();
  });

  it('returns null while a point is missing', () => {
    expect(resolveAbLoopRange({ active: true, start: null, end: 20 })).toBeNull();
    expect(resolveAbLoopRange({ active: true, start: 10, end: null })).toBeNull();
    expect(resolveAbLoopRange({ active: true, start: null, end: null })).toBeNull();
  });

  it('rejects an inverted range', () => {
    expect(resolveAbLoopRange({ active: true, start: 20, end: 10 })).toBeNull();
    expect(resolveAbLoopRange({ active: true, start: 10, end: 10 })).toBeNull();
  });
});

describe('A-B loop enablement', () => {
  it('requires both points with start before end', () => {
    expect(canEnableAbLoop({ start: 10, end: 20 })).toBe(true);
    expect(canEnableAbLoop({ start: null, end: 20 })).toBe(false);
    expect(canEnableAbLoop({ start: 10, end: null })).toBe(false);
    expect(canEnableAbLoop({ start: null, end: null })).toBe(false);
    expect(canEnableAbLoop({ start: 20, end: 10 })).toBe(false);
    expect(canEnableAbLoop({ start: 10, end: 10 })).toBe(false);
  });
});
