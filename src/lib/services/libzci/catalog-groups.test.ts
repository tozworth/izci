import { describe, expect, it } from 'vitest';
import {
  coreGroupByForLibraryView,
  isCatalogGroupPageStale,
  serializeCatalogGroupBy,
  validateCatalogGroupPage,
  type CoreCatalogGroupPage
} from './catalog-groups';

const page: CoreCatalogGroupPage = {
  revision: 31,
  total: 2,
  groups: [
    { key: ['Artist A'], count: 12 },
    { key: ['Artist B'], count: 3 }
  ]
};

describe('core catalog groups boundary', () => {
  it('maps Svelte group views to core groupings', () => {
    expect(coreGroupByForLibraryView('artists')).toBe('artist');
    expect(coreGroupByForLibraryView('albums')).toBe('album');
    expect(coreGroupByForLibraryView('genres')).toBe('genre');
    expect(coreGroupByForLibraryView('formats')).toBe('kind');
    // Shell-side groupings with no core equivalent stay local.
    expect(coreGroupByForLibraryView('years')).toBeNull();
    expect(coreGroupByForLibraryView('folders')).toBeNull();
  });

  it('pins the wire value and validates pages', () => {
    expect(JSON.parse(serializeCatalogGroupBy('artist'))).toBe('artist');
    expect(() => validateCatalogGroupPage(page)).not.toThrow();
    expect(isCatalogGroupPageStale(null, page)).toBe(true);
    expect(isCatalogGroupPageStale(31, page)).toBe(false);
    expect(isCatalogGroupPageStale(30, { ...page, revision: 32 })).toBe(true);
    expect(() => validateCatalogGroupPage({ ...page, revision: -1 })).toThrow();
    expect(() => validateCatalogGroupPage({ ...page, groups: [{ key: ['x'.repeat(4097)], count: 1 }] })).toThrow();
  });
});
