import { EngineRequestTable } from './runtime';
import { makeQueueRequestId, serializeQueueCommand, validateQueueRequestId } from './queue-commands';
import { serializeCatalogCommand, type CoreCatalogCommand } from './catalog-commands';
import { serializeCatalogQuery, type CoreCatalogQuery } from './catalog-query';
import {
  serializeCatalogGroupBy,
  validateCatalogGroupPage,
  type CoreCatalogGroupBy,
  type CoreCatalogGroupPage
} from './catalog-groups';
import type { CoreQueueCommand } from './queue-commands';
import type { CoreQueueFacade } from './queue-facade';
import type { CoreCatalogFacade } from './catalog-facade';
import type { CoreCatalogPage } from './catalog-snapshot';
import type { CoreProfileQueueState } from './queue-snapshot';

/**
 * Minimal owner-client for the future Svelte profile owner worker.
 *
 * The worker will own `WebProfile` + `WebEngine` (OPFS/SQLite, capabilities,
 * checkpoints) behind a Web-Lock + BroadcastChannel single-owner protocol
 * (see the crude `browser-runtime`/`engine-worker`). This client pins the
 * document-side wire before any worker file exists:
 *
 * - `queue(command)` posts `{type:'queue', command, request}` with a bounded
 *   `${uuid}/${scope}` durable id and multiplexes the `result` through the
 *   shared `EngineRequestTable`.
 * - `catalog(command)` posts `{type:'catalog', command, request}` for core
 *   catalog mutations (favorite/rate/bookmark/remove) through the same table.
 *   Scan/probe-owned commands (`add`/`root`/`finish_scan`) have no client
 *   helper yet.
 * - `queryCatalog(query)` posts `{type:'catalog_query', query, request}` and
 *   feeds the returned page into the read-only catalog facade (newer
 *   revisions win). Full Rust rows are projected to the facade's
 *   title/artist/album/duration subset for MVP observation.
 * - `queryGroups(by, query)` posts `{type:'catalog_groups', by, query,
 *   request}` and validates the returned group page. No groups facade exists
 *   yet; callers render from the returned page.
 * - `handleMessage` routes `snapshot` into the read-only queue facade
 *   (newer revisions win) and `result`/`error` into pending requests.
 *
 * Budgets mirror the crude owner: at most 32 in-flight requests shared by
 * all channels. Ingest/restore/transport/materialization remain open A2 work.
 * This client never touches `File` objects, handles, or audio nodes.
 */

export const OWNER_MAX_IN_FLIGHT = 32;

export interface CoreProfileOutcome {
  duplicate: boolean;
  appended: number[];
  revision: number;
  load: {
    occurrence: number;
    source: { key: string; kind: string; locator: string; display_path: string };
    position_seconds: number;
    subsong: number | null;
    autoplay: boolean;
  } | null;
  stop: boolean;
}

export interface CoreCatalogOutcome {
  duplicate: boolean;
  revision: number;
  media: number[];
  bookmark: number | null;
  root: number | null;
  scan: { root: number; entries: number; added: number; removed: number } | null;
}

export type OwnerOutgoingMessage =
  | {
      type: 'queue';
      command: CoreQueueCommand;
      request: string;
    }
  | {
      type: 'catalog';
      command: CoreCatalogCommand;
      request: string;
    }
  | {
      type: 'catalog_query';
      query: CoreCatalogQuery;
      request: string;
    }
  | {
      type: 'catalog_groups';
      by: CoreCatalogGroupBy;
      query: CoreCatalogQuery;
      request: string;
    };

export type OwnerIncomingMessage =
  | { type: 'snapshot'; profile: CoreProfileQueueState }
  | { type: 'result'; request: string; value?: unknown; error?: string }
  | { type: 'error'; detail: string; kind?: string };

export interface OwnerClientOptions {
  post: (message: OwnerOutgoingMessage) => void;
  queueFacade?: CoreQueueFacade;
  catalogFacade?: CoreCatalogFacade;
  onError?: (error: Error) => void;
}

export class CoreOwnerClient {
  readonly #post: (message: OwnerOutgoingMessage) => void;
  readonly #queueFacade?: CoreQueueFacade;
  readonly #catalogFacade?: CoreCatalogFacade;
  readonly #onError?: (error: Error) => void;
  readonly #table = new EngineRequestTable();

  constructor(options: OwnerClientOptions) {
    this.#post = options.post;
    this.#queueFacade = options.queueFacade;
    this.#catalogFacade = options.catalogFacade;
    this.#onError = options.onError;
  }

  get pending(): number {
    return this.#table.size;
  }

  #issue<T>(type: 'queue' | 'catalog', command: CoreQueueCommand | CoreCatalogCommand, scope: string): Promise<T> {
    if (this.#table.size >= OWNER_MAX_IN_FLIGHT) {
      throw new Error('Owner request budget exhausted: 32 in-flight owner requests');
    }
    const request = makeQueueRequestId(scope);
    validateQueueRequestId(request);
    if (type === 'queue') serializeQueueCommand(command as CoreQueueCommand);
    else serializeCatalogCommand(command as CoreCatalogCommand);
    const pending = new Promise<T>((resolve, reject) => {
      this.#table.add(request, {
        resolve: (value) => resolve(value as T),
        reject
      });
    });
    this.#post({ type, command, request } as OwnerOutgoingMessage);
    return pending;
  }

  /**
   * Issue a core queue command. Rejects when more than 32 requests are
   * already in flight so a stalled owner cannot grow an unbounded queue.
   */
  queue(command: CoreQueueCommand, scope = 'queue'): Promise<CoreProfileOutcome> {
    return this.#issue<CoreProfileOutcome>('queue', command, scope);
  }

  /**
   * Issue a core catalog mutation (favorite/rate/bookmark/remove).
   * Shares the 32-request budget with the queue channel. Scan/probe-owned
   * commands have no helper yet.
   */
  catalog(command: CoreCatalogCommand, scope = 'catalog'): Promise<CoreCatalogOutcome> {
    return this.#issue<CoreCatalogOutcome>('catalog', command, scope);
  }

  /**
   * Query core catalog groups and validate the returned page.
   * Shares the 32-request budget with all other channels.
   */
  async queryGroups(
    by: CoreCatalogGroupBy,
    query: CoreCatalogQuery,
    scope = 'catalog_groups'
  ): Promise<CoreCatalogGroupPage> {
    if (this.#table.size >= OWNER_MAX_IN_FLIGHT) {
      throw new Error('Owner request budget exhausted: 32 in-flight owner requests');
    }
    const request = makeQueueRequestId(scope);
    validateQueueRequestId(request);
    serializeCatalogGroupBy(by);
    serializeCatalogQuery(query);
    const pending = new Promise<CoreCatalogGroupPage>((resolve, reject) => {
      this.#table.add(request, {
        resolve: (value) => resolve(value as CoreCatalogGroupPage),
        reject
      });
    });
    this.#post({ type: 'catalog_groups', by, query, request });
    const page = await pending;
    validateCatalogGroupPage(page);
    return page;
  }

  /**
   * Query a core catalog page and feed it to the catalog facade.
   * Shares the 32-request budget with all other channels.
   */
  async queryCatalog(query: CoreCatalogQuery, scope = 'catalog_query'): Promise<CoreCatalogPage> {
    if (this.#table.size >= OWNER_MAX_IN_FLIGHT) {
      throw new Error('Owner request budget exhausted: 32 in-flight owner requests');
    }
    const request = makeQueueRequestId(scope);
    validateQueueRequestId(request);
    serializeCatalogQuery(query);
    const pending = new Promise<CoreCatalogPage>((resolve, reject) => {
      this.#table.add(request, {
        resolve: (value) => resolve(value as CoreCatalogPage),
        reject
      });
    });
    this.#post({ type: 'catalog_query', query, request });
    const page = await pending;
    this.#catalogFacade?.pushObservation(page);
    return page;
  }

  /** Route one owner-worker message. Unknown result ids stay harmless. */
  handleMessage(message: OwnerIncomingMessage): void {
    if (message.type === 'snapshot') {
      this.#queueFacade?.pushObservation(message.profile);
      return;
    }
    if (message.type === 'result') {
      if (message.error !== undefined) {
        this.#table.reject(message.request, new Error(message.error));
      } else {
        this.#table.resolve(message.request, message.value);
      }
      return;
    }
    if (message.type === 'error') {
      this.#onError?.(new Error(message.detail));
    }
  }

  /** Reject every outstanding request (owner loss / teardown). */
  close(reason = 'libzci owner closed'): void {
    this.#table.rejectAll(new Error(reason));
  }
}
