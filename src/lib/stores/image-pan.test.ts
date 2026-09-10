import { describe, expect, it } from 'vitest';
import { clampImagePanOffset, IMAGE_PAN_ORIGIN, normalizeImagePanOffset } from './image-pan';

describe('normalizeImagePanOffset', () => {
  it('rounds and clamps axes into range', () => {
    expect(normalizeImagePanOffset({ x: 12.6, y: -3.2 })).toEqual({ x: 13, y: -3 });
    expect(normalizeImagePanOffset({ x: 99999, y: -99999 })).toEqual({ x: 8192, y: -8192 });
  });

  it('falls back to the origin for unsupported values', () => {
    expect(normalizeImagePanOffset(null)).toEqual(IMAGE_PAN_ORIGIN);
    expect(normalizeImagePanOffset({ x: 'far' })).toEqual(IMAGE_PAN_ORIGIN);
  });
});

describe('clampImagePanOffset', () => {
  const bounds = {
    hostWidth: 800,
    hostHeight: 600,
    naturalWidth: 1600,
    naturalHeight: 1200,
    fitMode: 'contain' as const,
    zoom: 2
  };

  it('allows panning within the zoomed overflow', () => {
    // Contain base is 800x600, zoomed to 1600x1200: +/-400 x, +/-300 y.
    expect(clampImagePanOffset({ x: 100, y: -100 }, bounds)).toEqual({ x: 100, y: -100 });
  });

  it('clamps panning past the image edges', () => {
    expect(clampImagePanOffset({ x: 9999, y: -9999 }, bounds)).toEqual({ x: 400, y: -300 });
  });

  it('collapses to the origin at 1x zoom', () => {
    expect(clampImagePanOffset({ x: 100, y: 100 }, { ...bounds, zoom: 1 })).toEqual(IMAGE_PAN_ORIGIN);
  });

  it('uses cover geometry for fill mode', () => {
    // Cover base is 800x600 scaled up the same here; tall image covers width.
    const cover = clampImagePanOffset(
      { x: 0, y: 500 },
      { ...bounds, naturalWidth: 800, naturalHeight: 1200, fitMode: 'cover' as const }
    );
    // Cover scale = max(1, 0.5) = 1 -> 800x1200 base, zoomed 1600x2400: y max (2400-600)/2 = 900.
    expect(cover).toEqual({ x: 0, y: 500 });
  });

  it('collapses to the origin when dimensions are unknown', () => {
    expect(clampImagePanOffset({ x: 10, y: 10 }, { ...bounds, naturalWidth: 0 })).toEqual(IMAGE_PAN_ORIGIN);
  });
});
