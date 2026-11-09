/**
 * Svelte-side boundary for profile storage namespaces.
 *
 * One browser profile owns one `WebProfile` (OPFS/SQLite), one capability
 * registry (IndexedDB), one BroadcastChannel, and one Web Lock. Names must
 * never collide with the crude reference (`libzci-crude-v3-*`) or between
 * Svelte profiles, or two owners will split-brain a single profile. This
 * module pins the fresh Svelte namespace and validation so the future worker
 * binding cannot drift into the crude names.
 *
 * Fresh state only: no old-state reader, migration, or cross-generation
 * backup/restore. Nothing here opens storage, channels, or locks.
 */

export const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const PROFILE_NAMESPACE = 'izci-v1';

/** Validate a profile name (`1..64` of `[a-zA-Z0-9_-]`). */
export function validateProfileName(name: string): void {
  if (typeof name !== 'string' || !PROFILE_NAME_PATTERN.test(name)) {
    throw new Error('Invalid profile name: expected 1..64 chars of [a-zA-Z0-9_-]');
  }
}

/** OPFS directory for the profile SQLite database. */
export function opfsDirectoryForProfile(name: string): string {
  validateProfileName(name);
  return `/${PROFILE_NAMESPACE}/${name}`;
}

/** IndexedDB name for the profile capability registry. */
export function capabilityDbNameForProfile(name: string): string {
  validateProfileName(name);
  return `izci-capabilities-v1-${name}`;
}

/** BroadcastChannel name for single-owner election and snapshots. */
export function channelNameForProfile(name: string): string {
  validateProfileName(name);
  return `${PROFILE_NAMESPACE}-${name}`;
}

/** Web Lock name for single-owner election. */
export function lockNameForProfile(name: string): string {
  validateProfileName(name);
  return `izci-profile-v1-${name}`;
}
