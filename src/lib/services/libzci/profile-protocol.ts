import { serializeQueueCommand, validateQueueRequestId } from './queue-commands';
import { serializeCatalogCommand } from './catalog-commands';
import { serializeCatalogQuery } from './catalog-query';
import { serializeCatalogGroupBy } from './catalog-groups';
import { validateBookmarkTarget } from './bookmarks';
import { validateScanPlan, validateManagedRoot, SCAN_MAX_ID, SCAN_MAX_TOKEN } from './scan-roots';
import { validateImageSequence } from './image-sequence';
import { validateLyricsDocument } from './lyrics-document';
import { validatePlayCountSnapshot } from './play-counts';
import { validateCoreNormalization } from './normalization';

/**
 * Worker-side protocol boundary for the future Svelte profile owner worker.
 *
 * The document side posts `OwnerOutgoingMessage`s (see `owner-client.ts`);
 * the worker owns `WebProfile` + `WebEngine` and replies with snapshots,
 * results, and errors. This module pins the worker-visible envelope names
 * and reuses every existing validator so a malformed document message fails
 * fast before touching OPFS/SQLite, and a malformed worker reply fails fast
 * before touching Svelte stores.
 *
 * Nothing here opens workers, locks, channels, or databases.
 */

export const PROFILE_PROTOCOL_CHANNELS = [
  'profile-init',
  'queue',
  'catalog',
  'catalog_query',
  'catalog_groups',
  'bookmarks',
  'image_sequence',
  'roots',
  'begin_scan',
  'cancel_scan',
  'finish_scan',
  'close'
] as const;

export type ProfileWorkerChannel = (typeof PROFILE_PROTOCOL_CHANNELS)[number];

function checkRequest(request: unknown): asserts request is string {
  if (typeof request !== 'string') throw new Error('Invalid worker request id: expected string');
  validateQueueRequestId(request);
}

function checkToken(token: unknown): void {
  if (typeof token !== 'string' || token.length === 0 || token.length > SCAN_MAX_TOKEN || token.includes('\0')) {
    throw new Error('Invalid scan token: expected 1..128 chars without NUL');
  }
}

function checkRootId(root: unknown): void {
  if (!Number.isSafeInteger(root) || (root as number) <= 0 || (root as number) > SCAN_MAX_ID) {
    throw new Error(`Invalid scan root id: ${String(root)}`);
  }
}

const QUEUE_COMMAND_KINDS = new Set([
  'volume',
  'mute',
  'append',
  'remove',
  'move',
  'play',
  'next',
  'previous',
  'up_next',
  'clear_up_next',
  'settings',
  'checkpoint'
]);

const CATALOG_COMMAND_KINDS = new Set([
  'favorite',
  'rate',
  'bookmark',
  'remove_bookmark',
  'remove',
  'add',
  'root',
  'remove_root',
  'finish_scan'
]);

function checkCommandKind(value: unknown, kinds: ReadonlySet<string>, field: string): void {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (typeof kind !== 'string' || !kinds.has(kind)) {
    throw new Error(`Invalid ${field} kind: ${String(kind)}`);
  }
}

/** Validate a document→worker message envelope before dispatch. */
export function validateDocumentMessage(message: { type: string; [key: string]: unknown }): void {
  if (!PROFILE_PROTOCOL_CHANNELS.includes(message.type as ProfileWorkerChannel)) {
    throw new Error(`Unknown profile worker channel: ${String(message.type)}`);
  }
  switch (message.type) {
    case 'profile-init':
      if (typeof message.name !== 'string' || message.name.length === 0 || message.name.length > 64) {
        throw new Error('Invalid profile name: expected 1..64 chars');
      }
      break;
    case 'queue':
      checkCommandKind(message.command, QUEUE_COMMAND_KINDS, 'queue command');
      serializeQueueCommand(message.command as never);
      checkRequest(message.request);
      break;
    case 'catalog':
      checkCommandKind(message.command, CATALOG_COMMAND_KINDS, 'catalog command');
      serializeCatalogCommand(message.command as never);
      checkRequest(message.request);
      break;
    case 'catalog_query':
    case 'image_sequence':
      serializeCatalogQuery(message.query as never);
      checkRequest(message.request);
      break;
    case 'catalog_groups':
      serializeCatalogGroupBy(message.by as never);
      serializeCatalogQuery(message.query as never);
      checkRequest(message.request);
      break;
    case 'bookmarks':
      validateBookmarkTarget(message.media as number, (message.subsong as number | null) ?? null);
      checkRequest(message.request);
      break;
    case 'roots':
      checkRequest(message.request);
      break;
    case 'begin_scan':
      checkRootId(message.root);
      checkRequest(message.request);
      break;
    case 'cancel_scan':
    case 'finish_scan':
      checkToken(message.token);
      checkRequest(message.request);
      break;
    case 'close':
      if (message.request !== undefined) checkRequest(message.request);
      break;
  }
}

/** Validate a worker→document snapshot payload before feeding facades. */
export function validateSnapshotPayload(payload: {
  profile?: unknown;
  catalogRevision?: unknown;
}): void {
  const profile = payload.profile as { revision?: unknown; catalog_revision?: unknown } | undefined;
  if (!profile || typeof profile.revision !== 'number' || !Number.isSafeInteger(profile.revision)) {
    throw new Error('Invalid snapshot profile revision');
  }
  if (profile.catalog_revision !== undefined && typeof profile.catalog_revision !== 'number') {
    throw new Error('Invalid snapshot catalog revision');
  }
}

/** Validate a worker→document result payload for a known channel. */
export function validateResultPayload(channel: ProfileWorkerChannel, value: unknown): void {
  switch (channel) {
    case 'roots':
      if (!Array.isArray(value)) throw new Error('Invalid roots result: expected an array');
      for (const root of value) validateManagedRoot(root);
      break;
    case 'begin_scan':
      validateScanPlan(value as never);
      break;
    case 'finish_scan':
      // Validated by the caller via validateScanSummary; shape-check only here.
      if (typeof value !== 'object' || value === null) throw new Error('Invalid finish_scan result');
      break;
    case 'bookmarks':
      if (!Array.isArray(value)) throw new Error('Invalid bookmarks result: expected an array');
      break;
    case 'image_sequence':
      validateImageSequence(value as never);
      break;
    case 'catalog_groups':
    case 'catalog_query':
    case 'queue':
    case 'catalog':
    case 'cancel_scan':
    case 'profile-init':
    case 'close':
      break;
  }
}

export { validateLyricsDocument, validatePlayCountSnapshot, validateCoreNormalization, validateManagedRoot };
