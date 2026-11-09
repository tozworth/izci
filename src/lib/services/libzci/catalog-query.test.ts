import { describe, expect, it } from 'vitest';
import { buildCatalogQuery, defaultCatalogQuery, serializeCatalogQuery } from './catalog-query';

describe('core catalog query boundary', () => {
  it('matches the Rust defaults', () => {
    expect(defaultCatalogQuery()).toEqual({
      collection: 'library',
      search: '',
      sort: 'title',
      descending: false,
      offset: 0,
      limit: 100
    });
  });

  it('pins the snake_case wire shape', () => {
    const query = buildCatalogQuery({
      collection: 'favorites',
      kind: 'audio',
      search: 'love',
      sort: 'play_count',
      descending: true,
      offset: 10,
      limit: 50,
      source_key: 'svelte/a',
      subsong: 2,
      revision: 11
    });
    expect(query.source_key).toBe('svelte/a');
    expect(query.subsong).toBe(2);
    const wire = JSON.parse(serializeCatalogQuery(query));
    expect(wire).toEqual(query);
    expect(wire.play_count).toBeUndefined();
    expect(wire.sort).toBe('play_count');
    expect(wire.source_key).toBe('svelte/a');
  });

  it('rejects out-of-range pages and filters', () => {
    expect(() => buildCatalogQuery({ limit: 0 })).toThrow();
    expect(() => buildCatalogQuery({ limit: 501 })).toThrow();
    expect(() => buildCatalogQuery({ search: 'x'.repeat(1025) })).toThrow();
    expect(() => buildCatalogQuery({ artist: 'x'.repeat(4097) })).toThrow();
    expect(() => buildCatalogQuery({ collection: 'bogus' as never })).toThrow();
    expect(() => buildCatalogQuery({ kind: 'bogus' as never })).toThrow();
    expect(() => buildCatalogQuery({ sort: 'bogus' as never })).toThrow();
    expect(() => buildCatalogQuery({ root: 0 })).toThrow();
    expect(() => buildCatalogQuery({ media: -1 })).toThrow();
  });
});
