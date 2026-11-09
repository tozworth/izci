import { EngineRequestTable } from './runtime';
import { makeQueueRequestId, serializeQueueCommand, validateQueueRequestId } from './queue-commands';
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
 * - `handleMessage` routes `snapshot` into the read-only queue facade
 *   (newer revisions win) and `result`/`error` into pending requests.
 *
 * Budgets mirror the crude owner: at most 32 in-flight queue requests.
 * Ingest/restore/transport/materialization remain open A2 work; this client
 * never touches `File` objects, handles, or audio nodes.
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

export type OwnerOutgoingMessage = {
  type: 'queue';
  command: CoreQueueCommand;
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

  /**
   * Issue a core queue command. Rejects when more than 32 requests are
   * already in flight so a stalled owner cannot grow an unbounded queue.
   */
  queue(command: CoreQueueCommand, scope = 'queue'): Promise<CoreProfileOutcome> {
    if (this.#table.size >= OWNER_MAX_IN_FLIGHT) {
      throw new Error('Owner request budget exhausted: 32 in-flight queue requests');
    }
    const request = makeQueueRequestId(scope);
    validateQueueRequestId(request);
    // Validate the JSON envelope early so malformed commands fail before post.
    serializeQueueCommand(command);
    const pending = new Promise<CoreProfileOutcome>((resolve, reject) => {
      this.#table.add(request, {
        resolve: (value) => resolve(value as CoreProfileOutcome),
        reject
      });
    });
    this.#post({ type: 'queue', command, request });
    return pending;
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
