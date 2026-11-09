/**
 * Read-only probe of the core catalog page contract for the future Svelte
 * catalog facade. Pins the JSON shape published by core
 * (`WebProfile.catalog_query`, as consumed by the crude `catalogView`) and
 * maps it to a render-ready view. Mutations, scans, and persistence stay open
 * A2 work; nothing here writes.
 */

export type CoreCatalogKind = 'audio' | 'module' | 'video' | 'image';

export interface CoreCatalogFacts {
  favorite: boolean;
  /** Half-star steps 0..10; 0 clears the rating. */
  rating: number;
  play_count: number;
  last_played_ms: number | null;
}

export interface CoreCatalogRow {
  id: number;
  kind: CoreCatalogKind;
  in_library: boolean;
  source: {
    key: string;
    kind: 'native_path' | 'browser_handle' | 'ephemeral';
    locator: string;
    display_path: string;
  };
  metadata: {
    title: string;
    artist: string;
    album: string;
    duration_seconds: number | null;
  };
  facts: CoreCatalogFacts;
}

export interface CoreCatalogPage {
  revision: number;
  total: number;
  rows: CoreCatalogRow[];
}

export interface CatalogSnapshotRow {
  mediaId: number;
  title: string;
  artist: string;
  album: string;
  kind: CoreCatalogKind;
  inLibrary: boolean;
  favorite: boolean;
  /** Svelte half-star rating 0.5..5; undefined when core rating is 0 (cleared). */
  rating: number | undefined;
  playCount: number;
  /** False for plain File inputs and unknown sources: not restorable. */
  restorable: boolean;
}

export interface CatalogSnapshotView {
  revision: number;
  total: number;
  rows: CatalogSnapshotRow[];
}

/**
 * True when the view must re-render: first observation or a newer core
 * revision. Mirrors the queue revision guard so both shells skip stale work.
 */
export function isCatalogSnapshotStale(
  lastRenderedRevision: number | null,
  page: CoreCatalogPage
): boolean {
  return lastRenderedRevision === null || page.revision !== lastRenderedRevision;
}

/** Map a core rating (0..10 half-star steps) to the Svelte rating domain. */
export function toSvelteRating(coreRating: number): number | undefined {
  if (!Number.isSafeInteger(coreRating) || coreRating <= 0) return undefined;
  const clamped = Math.min(coreRating, 10);
  return clamped / 2;
}

/** Join catalog rows into render rows without touching any Svelte store. */
export function toCatalogSnapshotView(page: CoreCatalogPage): CatalogSnapshotView {
  const rows = page.rows.map((row) => {
    const title = row.metadata.title.trim() || row.source.display_path || `media #${row.id}`;
    return {
      mediaId: row.id,
      title,
      artist: row.metadata.artist,
      album: row.metadata.album,
      kind: row.kind,
      inLibrary: row.in_library,
      favorite: row.facts.favorite,
      rating: toSvelteRating(row.facts.rating),
      playCount: Math.max(0, Math.trunc(row.facts.play_count)),
      restorable: row.source.kind === 'browser_handle'
    } satisfies CatalogSnapshotRow;
  });
  return { revision: page.revision, total: page.total, rows };
}
