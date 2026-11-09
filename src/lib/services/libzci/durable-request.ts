/**
 * Durable request identities for core mutations.
 *
 * Core receipts (`Profile.request(command, request)`) make retries idempotent
 * and reject replayed payloads; evicted receipts fail visibly instead of
 * replaying old mutations. The Rust gate (`validate_request_age`) parses an
 * optional `base:` revision prefix and requires `base <= revision` with at
 * most 128 revisions of drift. This module pins the Svelte-side shape
 * (`${revision}:${uuid}/${scope}`) and the age check so document retries
 * across owner handoff stay safe.
 *
 * Requests without a `:` prefix (today's `${uuid}/${scope}`) skip the age
 * check in core but lose replay protection; new code must prefer the
 * revision-prefixed form. Nothing here posts messages or touches storage.
 */

export const DURABLE_REQUEST_MAX = 256;
export const DURABLE_REQUEST_MAX_DRIFT = 128;

function checkScope(scope: string): void {
  if (typeof scope !== 'string' || scope.length === 0 || scope.includes('/') || scope.includes(':') || scope.includes('\0')) {
    throw new Error('Invalid durable request scope: expected non-empty text without / : or NUL');
  }
}

/**
 * Build a revision-prefixed durable id for the observed profile revision.
 * The `revision` should be the latest `profile.revision` seen by the sender.
 */
export function makeDurableRequestId(revision: number, scope = 'queue'): string {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision > 9_007_199_254_740_991) {
    throw new Error(`Invalid durable request revision: ${String(revision)}`);
  }
  checkScope(scope);
  const id = `${revision}:${crypto.randomUUID()}/${scope}`;
  validateDurableRequestId(id);
  return id;
}

/** Validate length and shape (`[revision:]uuid[/scope]`, no NUL). */
export function validateDurableRequestId(request: string): void {
  if (typeof request !== 'string' || request.length === 0 || request.length > DURABLE_REQUEST_MAX || request.includes('\0')) {
    throw new Error('Invalid durable request id: expected 1..256 chars without NUL');
  }
}

/**
 * Mirror core `validate_request_age`: when the id carries a `base:` prefix,
 * require `base <= currentRevision` and `currentRevision - base <= 128`.
 * Ids without a prefix pass (no replay protection). Throws
 * `request-expired` when the receipt window has moved on — the caller must
 * refresh the snapshot and issue a new request.
 */
export function validateRequestAge(request: string, currentRevision: number): void {
  validateDurableRequestId(request);
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0) {
    throw new Error(`Invalid current revision: ${String(currentRevision)}`);
  }
  const separator = request.indexOf(':');
  if (separator < 0) return;
  const base = Number(request.slice(0, separator));
  if (!Number.isSafeInteger(base) || base < 0) {
    throw new Error('Invalid durable request revision prefix');
  }
  if (base > currentRevision || currentRevision - base > DURABLE_REQUEST_MAX_DRIFT) {
    throw new Error('request-expired: request outcome expired; refresh the snapshot before issuing a new request');
  }
}
