import { writable, type Readable } from 'svelte/store';
import { CoreOwnerClient, type OwnerOutgoingMessage } from './owner-client';
import { createCoreCatalogFacade, type CoreCatalogFacade } from './catalog-facade';
import { createCoreQueueFacade, type CoreQueueFacade } from './queue-facade';
import { idleScanObservation, type CoreScanObservation } from './scan-observation';
import { CoreSourceRegistry } from './source-registry';
import { observeCoreProfile, type CoreProfileObservation } from './profile-observation';

/**
 * Unified Svelte entry point for the future profile owner binding.
 *
 * Components render from `queueFacade`/`catalogFacade`/`observation` and
 * resolve live `File`s through `registry`; commands and queries flow through
 * `client` (which multiplexes results and feeds the facades). The worker file,
 * locks, channels, OPFS/SQLite, and materialization remain open A2 work —
 * this module only composes the pure seams so there is one construction
 * site to replace with the live binding.
 *
 * Nothing here opens workers, touches handles, or persists state.
 */

export interface CoreProfileStoreOptions {
  post: (message: OwnerOutgoingMessage) => void;
  onError?: (error: Error) => void;
}

export interface CoreProfileStore {
  readonly queueFacade: CoreQueueFacade;
  readonly catalogFacade: CoreCatalogFacade;
  readonly registry: CoreSourceRegistry;
  readonly client: CoreOwnerClient;
  /** Latest owner access string (`''` before the first snapshot). */
  readonly access: Readable<string>;
  /** Latest scan observation (idle before the first snapshot carrying one). */
  readonly scan: Readable<CoreScanObservation>;
  /** Single derived store combining queue, catalog, access, and scan. */
  readonly observation: Readable<CoreProfileObservation>;
}

export function createCoreProfileStore(options: CoreProfileStoreOptions): CoreProfileStore {
  const queueFacade = createCoreQueueFacade();
  const catalogFacade = createCoreCatalogFacade();
  const registry = new CoreSourceRegistry();
  const access = writable<string>('');
  const scan = writable<CoreScanObservation>(idleScanObservation());
  const client = new CoreOwnerClient({
    post: options.post,
    queueFacade,
    catalogFacade,
    onError: options.onError,
    onAccess: (next) => access.set(next),
    onScan: (next) => scan.set(next)
  });
  const accessReadable: Readable<string> = { subscribe: access.subscribe };
  const scanReadable: Readable<CoreScanObservation> = { subscribe: scan.subscribe };
  const observation = observeCoreProfile({ queueFacade, catalogFacade, access: accessReadable, scan: scanReadable });
  return {
    queueFacade,
    catalogFacade,
    registry,
    client,
    access: accessReadable,
    scan: scanReadable,
    observation
  };
}
