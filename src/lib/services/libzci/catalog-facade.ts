import { writable, type Readable } from 'svelte/store';
import {
  toCatalogSnapshotView,
  type CatalogSnapshotView,
  type CoreCatalogPage
} from './catalog-snapshot';

/**
 * Read-only Svelte observation facade over core catalog state. The future
 * owner-worker binding will push `WebProfile.catalog_query` pages here;
 * components render from `view` and never mutate through this module.
 * Catalog commands, scans, persistence and owner election remain open A2 work.
 */
export interface CoreCatalogFacade {
  readonly view: Readable<CatalogSnapshotView | null>;
  readonly revision: Readable<number | null>;
  /**
   * Apply a core catalog page. First pages always apply; later ones apply
   * only when they carry a newer revision, so late or duplicate deliveries
   * from owner handoff stay harmless.
   */
  pushObservation(page: CoreCatalogPage): void;
}

export function createCoreCatalogFacade(): CoreCatalogFacade {
  const view = writable<CatalogSnapshotView | null>(null);
  const revision = writable<number | null>(null);
  let appliedRevision: number | null = null;

  return {
    view: { subscribe: view.subscribe },
    revision: { subscribe: revision.subscribe },
    pushObservation(page: CoreCatalogPage): void {
      if (appliedRevision !== null && page.revision <= appliedRevision) return;
      appliedRevision = page.revision;
      view.set(toCatalogSnapshotView(page));
      revision.set(page.revision);
    }
  };
}
