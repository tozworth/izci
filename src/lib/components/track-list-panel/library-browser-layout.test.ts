import { describe, expect, it } from 'vitest';
import { getLibraryTileMetrics, getLibraryTileNavigationIndex, getLibraryTileWindow } from './library-browser-layout';
import { resolveGalleryAspectRatio } from '$lib/utils/thumbnails';

describe('desktop library tiles', () => {
  it('fits columns to narrow panes and uses wider visual thumbnails', () => {
    expect(getLibraryTileMetrics(70, 144, false).columns).toBe(1);
    const music = getLibraryTileMetrics(620, 144, false);
    const visual = getLibraryTileMetrics(620, 144, true);
    expect(music.columns).toBe(4);
    expect(visual.columns).toBe(music.columns);
    expect(visual.rowHeight).toBeLessThan(music.rowHeight);
    expect(getLibraryTileMetrics(620, 256, false).columns).toBe(2);
  });

  it('mounts a bounded window including the last incomplete row', () => {
    const metrics = getLibraryTileMetrics(620, 144, false);
    const middle = getLibraryTileWindow(10001, metrics.columns, metrics.rowPitch, 8000, 500);
    expect(middle.start).toBeGreaterThan(0);
    expect(middle.end - middle.start).toBeLessThan(40);
    expect(middle.start % metrics.columns).toBe(0);
    const end = getLibraryTileWindow(10001, metrics.columns, metrics.rowPitch, middle.height - 500, 500);
    expect(end.start).toBeLessThan(10001);
    expect(end.end).toBeGreaterThanOrEqual(10001);
    expect(getLibraryTileWindow(0, 4, 200, 0, 500).height).toBe(12);
  });

  it('moves vertically by a row and keeps horizontal navigation inside rows', () => {
    expect(getLibraryTileNavigationIndex(2, 11, 4, 'ArrowDown')).toBe(6);
    expect(getLibraryTileNavigationIndex(6, 11, 4, 'ArrowUp')).toBe(2);
    expect(getLibraryTileNavigationIndex(3, 11, 4, 'ArrowRight')).toBe(3);
    expect(getLibraryTileNavigationIndex(4, 11, 4, 'ArrowLeft')).toBe(4);
    expect(getLibraryTileNavigationIndex(7, 11, 4, 'ArrowDown')).toBe(10);
  });

  it('preserves gallery proportions while bounding extreme or missing dimensions', () => {
    expect(resolveGalleryAspectRatio(1920, 1080)).toBeCloseTo(16 / 9);
    expect(resolveGalleryAspectRatio(100, 1000)).toBe(0.5);
    expect(resolveGalleryAspectRatio(1000, 100)).toBe(2.4);
    expect(resolveGalleryAspectRatio(0, 0)).toBe(4 / 3);
  });
});
