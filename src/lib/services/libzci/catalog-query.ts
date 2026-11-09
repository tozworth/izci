/**
 * Svelte-side builder/validation boundary for core catalog queries.
 *
 * The Rust owner (`Profile.catalog_query`, `catalog_groups`) remains the only
 * query authority. This module pins the `CatalogQuery` JSON contract used by
 * the future Svelte owner worker when requesting `WebProfile.catalog_query`
 * pages that feed the read-only `catalog-facade`. Mutations stay in
 * `catalog-commands`; groups/scans stay open.
 *
 * JSON shapes mirror `libzci/consumers/crude-pwa/src/catalog-types.ts` and
 * the Rust `#[serde(default, deny_unknown_fields)] CatalogQuery`. Keep them
 * in sync; the unit tests pin the wire names.
 */

export type CoreCatalogCollection = 'library' | 'favorites' | 'all';
export type CoreCatalogQueryKind = 'audio' | 'module' | 'video' | 'image';
export type CoreCatalogSort = 'title' | 'artist' | 'album' | 'rating' | 'play_count' | 'path';

export interface CoreCatalogQuery {
  collection: CoreCatalogCollection;
  kind?: CoreCatalogQueryKind;
  root?: number;
  media?: number;
  source_key?: string;
  subsong?: number;
  search: string;
  artist?: string;
  album?: string;
  genre?: string;
  sort: CoreCatalogSort;
  descending: boolean;
  offset: number;
  limit: number;
  revision?: number;
}

export const CATALOG_QUERY_MAX_ID = 9_007_199_254_740_991;
export const CATALOG_QUERY_MAX_PAGE = 500;
export const CATALOG_QUERY_DEFAULT_LIMIT = 100;
export const CATALOG_QUERY_MAX_SEARCH = 1_024;
export const CATALOG_QUERY_MAX_FILTER_TEXT = 4_096;
export const CATALOG_QUERY_MAX_SOURCE_KEY = 8_192;

function isValidId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= CATALOG_QUERY_MAX_ID
  );
}

function isValidSubsong(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295
  );
}

function isValidOffset(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 4_294_967_295
  );
}

function checkText(value: string, limit: number, field: string): void {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) {
    throw new Error(`Invalid catalog query ${field}: expected 0..${limit} chars without NUL`);
  }
}

/** Rust `CatalogQuery::default()` as JSON. */
export function defaultCatalogQuery(): CoreCatalogQuery {
  return {
    collection: 'library',
    search: '',
    sort: 'title',
    descending: false,
    offset: 0,
    limit: CATALOG_QUERY_DEFAULT_LIMIT
  };
}

/**
 * Build a validated catalog query. Unknown fields are rejected by requiring
 * callers to pass a `Partial` of the known shape; every value mirrors the
 * Rust `filtered()` bounds (`limit 1..500`, `search 0..1024`, filter text
 * `0..4096`, ids `1..MAX_ID`).
 */
export function buildCatalogQuery(partial: Partial<CoreCatalogQuery> = {}): CoreCatalogQuery {
  const query: CoreCatalogQuery = { ...defaultCatalogQuery(), ...partial };

  if (query.collection !== 'library' && query.collection !== 'favorites' && query.collection !== 'all') {
    throw new Error(`Invalid catalog collection: ${String(query.collection)}`);
  }
  if (query.kind !== undefined && query.kind !== 'audio' && query.kind !== 'module' && query.kind !== 'video' && query.kind !== 'image') {
    throw new Error(`Invalid catalog kind: ${String(query.kind)}`);
  }
  if (query.root !== undefined && !isValidId(query.root)) {
    throw new Error(`Invalid catalog root: ${String(query.root)}`);
  }
  if (query.media !== undefined && !isValidId(query.media)) {
    throw new Error(`Invalid catalog media: ${String(query.media)}`);
  }
  if (query.source_key !== undefined) {
    if (
      typeof query.source_key !== 'string' ||
      query.source_key.length === 0 ||
      query.source_key.length > CATALOG_QUERY_MAX_SOURCE_KEY ||
      query.source_key.includes('\0')
    ) {
      throw new Error('Invalid catalog source_key: expected 1..8192 chars without NUL');
    }
  }
  if (query.subsong !== undefined && !isValidSubsong(query.subsong)) {
    throw new Error(`Invalid catalog subsong: ${String(query.subsong)}`);
  }
  checkText(query.search, CATALOG_QUERY_MAX_SEARCH, 'search');
  if (query.artist !== undefined) checkText(query.artist, CATALOG_QUERY_MAX_FILTER_TEXT, 'artist');
  if (query.album !== undefined) checkText(query.album, CATALOG_QUERY_MAX_FILTER_TEXT, 'album');
  if (query.genre !== undefined) checkText(query.genre, CATALOG_QUERY_MAX_FILTER_TEXT, 'genre');
  if (
    query.sort !== 'title' &&
    query.sort !== 'artist' &&
    query.sort !== 'album' &&
    query.sort !== 'rating' &&
    query.sort !== 'play_count' &&
    query.sort !== 'path'
  ) {
    throw new Error(`Invalid catalog sort: ${String(query.sort)}`);
  }
  if (typeof query.descending !== 'boolean') {
    throw new Error(`Invalid catalog descending: ${String(query.descending)}`);
  }
  if (!isValidOffset(query.offset)) {
    throw new Error(`Invalid catalog offset: ${String(query.offset)}`);
  }
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > CATALOG_QUERY_MAX_PAGE) {
    throw new Error(`Invalid catalog limit: ${String(query.limit)}`);
  }
  if (
    query.revision !== undefined &&
    (!Number.isSafeInteger(query.revision) || query.revision < 0 || query.revision > CATALOG_QUERY_MAX_ID)
  ) {
    throw new Error(`Invalid catalog revision: ${String(query.revision)}`);
  }
  return query;
}

/** Serialize a catalog query for the owner-worker `catalog_query` channel. */
export function serializeCatalogQuery(query: CoreCatalogQuery): string {
  return JSON.stringify(buildCatalogQuery(query));
}
