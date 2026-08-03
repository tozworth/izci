import { describe, expect, it } from 'vitest';
import { resolveHorizontalSwipe } from './tab-swipe';

describe('resolveHorizontalSwipe', () => {
  it('moves forward on a decisive left swipe', () => {
    expect(resolveHorizontalSwipe({ x: 220, y: 100 }, { x: 110, y: 112 })).toBe(1);
  });

  it('moves backward on a decisive right swipe', () => {
    expect(resolveHorizontalSwipe({ x: 80, y: 100 }, { x: 170, y: 96 })).toBe(-1);
  });

  it('ignores short and predominantly vertical movement', () => {
    expect(resolveHorizontalSwipe({ x: 100, y: 100 }, { x: 130, y: 102 })).toBeNull();
    expect(resolveHorizontalSwipe({ x: 100, y: 100 }, { x: 165, y: 190 })).toBeNull();
  });

  it('accepts an intentional diagonal swipe without demanding near-perfect horizontality', () => {
    expect(resolveHorizontalSwipe({ x: 200, y: 100 }, { x: 145, y: 160 })).toBe(1);
  });
});
