import { describe, expect, it } from 'vitest';
import { resolveTitlebarAreaRect, type WindowControlsOverlayRect } from './window-controls-overlay';

const TITLEBAR_RECT: WindowControlsOverlayRect = {
  x: 0,
  y: 0,
  width: 700,
  height: 30
};

describe('resolveTitlebarAreaRect', () => {
  it('keeps the reported WCO rect outside fullscreen', () => {
    expect(resolveTitlebarAreaRect(TITLEBAR_RECT, false, 1545)).toEqual(TITLEBAR_RECT);
  });

  it('uses the real viewport width while fullscreen', () => {
    expect(resolveTitlebarAreaRect(TITLEBAR_RECT, true, 1545)).toEqual({
      x: 0,
      y: 0,
      width: 1545,
      height: 30
    });
  });

  it('falls back to the reported width when the viewport width is unavailable', () => {
    expect(resolveTitlebarAreaRect(TITLEBAR_RECT, true, 0)).toEqual({
      x: 0,
      y: 0,
      width: 700,
      height: 30
    });
  });
});
