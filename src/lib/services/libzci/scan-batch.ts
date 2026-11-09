/**
 * Svelte-side boundary for scan staging batches.
 *
 * Managed scans reconcile only after a complete run: adapters enumerate and
 * probe, then stage bounded `MediaInput` batches (`1..256` entries) against
 * the scan token before `finish_scan`. Full per-entry `Metadata`
 * normalization belongs to the future probe slice; this module pins the
 * batch envelope (token + entry count) so malformed stages fail fast before
 * workers or SQL. Nothing here enumerates, probes, or writes.
 */

export const SCAN_BATCH_MIN = 1;
export const SCAN_BATCH_MAX = 256;
export const SCAN_BATCH_TOKEN_MAX = 128;

function checkToken(token: string): void {
  if (typeof token !== 'string' || token.length === 0 || token.length > SCAN_BATCH_TOKEN_MAX || token.includes('\0')) {
    throw new Error('Invalid scan token: expected 1..128 chars without NUL');
  }
}

/** Validate a staging batch envelope before posting it to the worker. */
export function validateStageBatch(token: string, media: readonly unknown[]): void {
  checkToken(token);
  if (!Array.isArray(media) || media.length < SCAN_BATCH_MIN || media.length > SCAN_BATCH_MAX) {
    throw new Error(`Invalid scan batch: expected 1..${SCAN_BATCH_MAX} entries`);
  }
}

/** Number of batches needed to stage `total` entries at the max batch size. */
export function scanBatchCount(total: number): number {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`Invalid scan entry total: ${String(total)}`);
  }
  return Math.ceil(total / SCAN_BATCH_MAX);
}
