import { derived, type Readable } from 'svelte/store';
import type { CatalogSnapshotView } from './catalog-snapshot';
import type { QueueSnapshotView } from './queue-snapshot';
import type { CoreScanObservation } from './scan-observation';
import type { CoreProfileStore } from './profile-store';

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

export function observeCoreProfile(store: CoreProfileStore): Readable<CoreProfileObservation> {
  return derived(
    [store.queueFacade.view, store.catalogFacade.view, store.access, store.scan],
    ([queue, catalog, access, scan]): CoreProfileObservation => ({ queue, catalog, access, scan })
  );
}
