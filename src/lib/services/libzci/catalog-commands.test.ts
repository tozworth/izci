import { describe, expect, it } from 'vitest';
import {
  buildBookmarkCommand,
  buildFavoriteCommand,
  buildRateCommand,
  buildRemoveBookmarkCommand,
  buildRemoveMediaCommand,
  fromCoreRating,
  serializeCatalogCommand,
  toCoreRating
} from './catalog-commands';

describe('core catalog user-facts boundary', () => {
  it('maps Svelte ratings to core half-star steps', () => {
    expect(toCoreRating(undefined)).toBe(0);
    expect(toCoreRating(0)).toBe(0);
    expect(toCoreRating(4.5)).toBe(9);
    expect(toCoreRating(5)).toBe(10);
    expect(toCoreRating(0.5)).toBe(1);
    // Svelte normalization rounds to the nearest half star, then core doubles.
    expect(toCoreRating(4.74)).toBe(9);
    expect(fromCoreRating(9)).toBe(4.5);
    expect(fromCoreRating(0)).toBeUndefined();
  });

  it('pins favorite/rate wire shapes', () => {
    expect(buildFavoriteCommand(7, null, true)).toEqual({
      kind: 'favorite',
      media: 7,
      subsong: null,
      favorite: true
    });
    expect(buildRateCommand(7, 2, 4.5)).toEqual({
      kind: 'rate',
      media: 7,
      subsong: 2,
      rating: 9
    });
    expect(buildRateCommand(7, null, undefined)).toEqual({
      kind: 'rate',
      media: 7,
      subsong: null,
      rating: 0
    });
    expect(JSON.parse(serializeCatalogCommand(buildFavoriteCommand(7, null, false)))).toEqual(
      buildFavoriteCommand(7, null, false)
    );
    expect(() => buildFavoriteCommand(0, null, true)).toThrow();
    expect(() => buildRateCommand(7, -1, 3)).toThrow();
  });

  it('pins bookmark and remove wire shapes with bounds', () => {
    expect(buildBookmarkCommand(7, null, 12.5, 'chorus')).toEqual({
      kind: 'bookmark',
      media: 7,
      subsong: null,
      position_seconds: 12.5,
      label: 'chorus'
    });
    const bookmarked = buildBookmarkCommand(7, 1, 0, '');
    expect(bookmarked).toEqual({
      kind: 'bookmark',
      media: 7,
      subsong: 1,
      position_seconds: 0,
      label: ''
    });
    expect(buildRemoveBookmarkCommand(3)).toEqual({ kind: 'remove_bookmark', id: 3 });
    expect(buildRemoveMediaCommand([1, 2])).toEqual({ kind: 'remove', media: [1, 2] });

    expect(() => buildBookmarkCommand(7, null, Number.NaN, 'x')).toThrow();
    expect(() => buildBookmarkCommand(7, null, 1, 'x'.repeat(4097))).toThrow();
    expect(() => buildRemoveBookmarkCommand(0)).toThrow();
    expect(() => buildRemoveMediaCommand([])).toThrow();
  });
});
