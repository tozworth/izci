/**
 * Svelte-side boundary for core capability stage keys.
 *
 * Genuine File System Access handles live in a separate IndexedDB registry;
 * domain rows persist only `{key,kind,locator,display_path}`. Staging maps a
 * picked handle to a key before the SQL commit and completes it after. This
 * module pins the key shapes used by the future owner worker so Svelte and
 * the crude share one scheme without inventing handle serialization:
 *
 * - ingest/file batch: `<request>/<index>`
 * - managed-root staging: `<request>/root`
 * - scan file staging: `<rootKey>/file/<sha256-hex>`
 *
 * Nothing here touches handles, IDB, or SQL; resolution/completion/GC belong
 * to the future capabilities + owner slice.
 */

export const CAPABILITY_MAX_KEY = 8_192;
export const CAPABILITY_MAX_REQUEST = 256;

function checkKey(key: string, field = 'capability key'): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > CAPABILITY_MAX_KEY || key.includes('\0')) {
    throw new Error(`Invalid ${field}: expected 1..8192 chars without NUL`);
  }
}

function checkRequest(request: string): void {
  if (typeof request !== 'string' || request.length === 0 || request.length > CAPABILITY_MAX_REQUEST || request.includes('\0') || request.includes('/')) {
    throw new Error('Invalid capability request: expected 1..256 chars without NUL or /');
  }
}

/** Validate any capability/source key before staging or persisting it. */
export function validateCapabilityKey(key: string): void {
  checkKey(key);
}

/** `<request>/<index>` for ingest and `addFiles` batches. */
export function makeFileStageKey(request: string, index: number): string {
  checkRequest(request);
  if (!Number.isSafeInteger(index) || index < 0 || index > 9_999) {
    throw new Error(`Invalid file stage index: ${String(index)}`);
  }
  const key = `${request}/${index}`;
  checkKey(key, 'file stage key');
  return key;
}

/** `<request>/root` for managed-root staging. */
export function makeRootStageKey(request: string): string {
  checkRequest(request);
  const key = `${request}/root`;
  checkKey(key, 'root stage key');
  return key;
}

function checkDigestHex(digest: string): void {
  if (typeof digest !== 'string' || digest.length !== 64 || !/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error('Invalid scan digest: expected 64 lowercase hex chars');
  }
}

/** `<rootKey>/file/<sha256-hex>` for stable scan path candidates. */
export function makeScanFileKey(rootKey: string, digestHex: string): string {
  checkKey(rootKey, 'scan root key');
  checkDigestHex(digestHex);
  const key = `${rootKey}/file/${digestHex}`;
  checkKey(key, 'scan file key');
  return key;
}
