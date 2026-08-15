import { describe, expect, it } from 'vitest';
import { getMenuViewportOffset } from './menu-viewport';

function menuRect(left: number, top: number, width: number, height: number) {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height
  };
}

describe('getMenuViewportOffset', () => {
  it('leaves a submenu in place when it fits', () => {
    expect(getMenuViewportOffset(menuRect(100, 80, 160, 120), 500, 400)).toEqual({ x: 0, y: 0 });
  });

  it('shifts an overflowing submenu back inside the right and bottom edges', () => {
    expect(getMenuViewportOffset(menuRect(300, 260, 220, 180), 400, 320)).toEqual({
      x: -128,
      y: -128
    });
  });

  it('opens to the left when there is enough room there', () => {
    expect(getMenuViewportOffset(menuRect(450, 80, 160, 120), 600, 400, 8, 450)).toEqual({
      x: -163,
      y: 0
    });
  });

  it('aligns an oversized submenu to the viewport padding', () => {
    expect(getMenuViewportOffset(menuRect(250, 180, 500, 400), 320, 240)).toEqual({
      x: -242,
      y: -172
    });
  });
});
