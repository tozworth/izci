import { EngineRequestTable } from './runtime';
import { makeQueueRequestId, serializeQueueCommand, validateQueueRequestId } from './queue-commands';
import { serializeCatalogCommand, type CoreCatalogCommand } from './catalog-commands';
import type { CoreQueueCommand } from './queue-commands';
import type { CoreQueueFacade } from './queue-facade';
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
 * - `handleMessage` routes `snapshot` into the read-only queue facade
 *   (newer revisions win) and `result`/`error` into pending requests.
 *
 * Budgets mirror the crude owner: at most 32 in-flight requests shared by
 * both channels. Catalog queries (`catalog_query` pages) belong to the next
 * slice; ingest/restore/transport/materialization remain open A2 work. This
 * client never touches `File` objects, handles, or audio nodes.
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
    };

export type OwnerIncomingMessage =
  | { type: 'snapshot'; profile: CoreProfileQueueState }
  | { type: 'result'; request: string; value?: unknown; error?: string }
  | { type: 'error'; detail: string; kind?: string };

export interface OwnerClientOptions {
  post: (message: OwnerOutgoingMessage) => void;
  queueFacade?: CoreQueueFacade;
  onError?: (error: Error) => void;
}

export class CoreOwnerClient {
  readonly #post: (message: OwnerOutgoingMessage) => void;
  readonly #queueFacade?: CoreQueueFacade;
  readonly #onError?: (error: Error) => void;
  readonly #table = new EngineRequestTable();

  constructor(options: OwnerClientOptions) {
    this.#post = options.post;
    this.#queueFacade = options.queueFacade;
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
