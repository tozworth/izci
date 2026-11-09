import { derived, type Readable } from 'svelte/store';
import type { CoreCatalogFacade } from './catalog-facade';
import type { CoreQueueFacade } from './queue-facade';
import type { CoreScanObservation } from './scan-observation';
import type { CatalogSnapshotView } from './catalog-snapshot';
import type { QueueSnapshotView } from './queue-snapshot';

/**
 * Unified read-only observation for components adopting the core profile.
 *
 * Combines the queue/catalog facades with the access string and scan
 * observation into one derived store, so views subscribe once instead of
 * tracking four sources. The worker binding stays behind `CoreProfileStore`;
 * nothing here opens workers, touches handles, or persists state.
 */

export interface CoreProfileObservation {
  readonly queue: QueueSnapshotView | null;
  readonly catalog: CatalogSnapshotView | null;
  readonly access: string;
  readonly scan: CoreScanObservation;
}

export interface CoreProfileObservationSources {
  readonly queueFacade: CoreQueueFacade;
  readonly catalogFacade: CoreCatalogFacade;
  readonly access: Readable<string>;
  readonly scan: Readable<CoreScanObservation>;
}

export function observeCoreProfile(sources: CoreProfileObservationSources): Readable<CoreProfileObservation> {
  return derived(
    [sources.queueFacade.view, sources.catalogFacade.view, sources.access, sources.scan],
    ([queue, catalog, access, scan]): CoreProfileObservation => ({ queue, catalog, access, scan })
  );
}
