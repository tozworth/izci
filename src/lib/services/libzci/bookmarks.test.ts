import { describe, expect, it } from 'vitest';
import {
  sortCoreBookmarks,
  toCoreBookmarkFields,
  toSvelteBookmark,
  validateBookmarkTarget,
  validateCoreBookmark,
  type CoreBookmark
} from './bookmarks';

const row: CoreBookmark = { id: 7, media: 3, subsong: null, position_seconds: 12.5, label: 'Chorus' };

describe('core bookmarks boundary', () => {
  it('validates rows and targets', () => {
    expect(() => validateCoreBookmark(row)).not.toThrow();
    expect(() => validateCoreBookmark({ ...row, id: 0 })).toThrow();
    expect(() => validateCoreBookmark({ ...row, label: 'x'.repeat(4097) })).toThrow();
    expect(() => validateBookmarkTarget(3, null)).not.toThrow();
    expect(() => validateBookmarkTarget(0, null)).toThrow();
    expect(() => validateBookmarkTarget(3, -1)).toThrow();
  });

  it('maps between core rows and Svelte views', () => {
    expect(toSvelteBookmark(row)).toEqual({ id: '7', name: 'Chorus', time: 12.5 });
    expect(toSvelteBookmark({ ...row, label: '' }).name).toBe('Bookmark');
    expect(toCoreBookmarkFields({ time: 3, name: 'Verse' })).toEqual({
      position_seconds: 3,
      label: 'Verse'
    });
    expect(() => toCoreBookmarkFields({ time: Number.NaN, name: 'x' })).toThrow();
  });

  it('sorts in core order', () => {
    const rows: CoreBookmark[] = [
      { ...row, id: 9, position_seconds: 20 },
      { ...row, id: 8, position_seconds: 5 },
      { ...row, id: 10, position_seconds: 5 }
    ];
    expect(sortCoreBookmarks(rows).map((entry) => entry.id)).toEqual([8, 10, 9]);
  });
});
