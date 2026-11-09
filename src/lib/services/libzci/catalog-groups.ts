import type { LibraryGroupViewId } from '$lib/types';

/**
 * Svelte-side boundary for core catalog grouping.
 *
 * The Rust owner (`Profile.catalog_groups`) remains the only grouping
 * authority. This module pins the `CatalogGroupBy` wire values and the
 * `CatalogGroupPage` shape, plus the mapping from Svelte library group views
 * to core groupings. Svelte-only groupings (years, folders) have no core
 * equivalent and stay shell-side; `formats` maps to core `kind`.
 *
 * Wire shapes mirror the Rust `#[serde(rename_all = "snake_case")]`
 * `CatalogGroupBy` and `CatalogGroupPage`.
 */

export type CoreCatalogGroupBy = 'artist' | 'album' | 'genre' | 'kind';

export interface CoreCatalogGroup {
  key: string[];
  count: number;
}

export interface CoreCatalogGroupPage {
  revision: number;
  total: number;
  groups: CoreCatalogGroup[];
}

export const CATALOG_GROUPS_MAX_ID = 9_007_199_254_740_991;

/**
 * Map a Svelte library group view to its core grouping.
 * Returns `null` for shell-side groupings with no core equivalent.
 */
export function coreGroupByForLibraryView(view: LibraryGroupViewId): CoreCatalogGroupBy | null {
  switch (view) {
    case 'artists':
      return 'artist';
    case 'albums':
      return 'album';
    case 'genres':
      return 'genre';
    case 'formats':
      return 'kind';
    default:
      return null;
  }
}

/** True when the view must re-render: first page or a newer core revision. */
export function isCatalogGroupPageStale(
  lastRenderedRevision: number | null,
  page: CoreCatalogGroupPage
): boolean {
  return lastRenderedRevision === null || page.revision !== lastRenderedRevision;
}

function isValidRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= CATALOG_GROUPS_MAX_ID
  );
}

/** Validate a group page shape before feeding it to Svelte stores. */
export function validateCatalogGroupPage(page: CoreCatalogGroupPage): void {
  if (!isValidRevision(page.revision)) {
    throw new Error(`Invalid catalog group revision: ${String(page.revision)}`);
  }
  if (!isValidRevision(page.total)) {
    throw new Error(`Invalid catalog group total: ${String(page.total)}`);
  }
  if (!Array.isArray(page.groups)) {
    throw new Error('Invalid catalog groups: expected an array');
  }
  for (const group of page.groups) {
    if (!Array.isArray(group.key) || group.key.some((part) => typeof part !== 'string')) {
      throw new Error('Invalid catalog group key: expected string[]');
    }
    if (group.key.some((part) => part.length > 4096 || part.includes('\0'))) {
      throw new Error('Invalid catalog group key part: expected 0..4096 chars without NUL');
    }
    if (!isValidRevision(group.count)) {
      throw new Error(`Invalid catalog group count: ${String(group.count)}`);
    }
  }
}

/** Serialize the group-by selector for the owner-worker `catalog_groups` channel. */
export function serializeCatalogGroupBy(by: CoreCatalogGroupBy): string {
  return JSON.stringify(by);
}
