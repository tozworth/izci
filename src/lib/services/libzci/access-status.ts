/**
 * Svelte-side boundary for the owner access contract.
 *
 * The owner worker publishes one `access` string per snapshot (see the crude
 * `ProfileController`/`engine-worker`): `''` initially, `'checking'` while
 * materializing a `QueueLoad`, `'granted'` when the current source resolves,
 * `'no selected source'` when the queue has no current occurrence, and
 * `'<kind>: <detail>'` otherwise (`non-restorable`, `access-required`,
 * `unavailable`, ...). Transport guards mirror the worker: `play` restores
 * first unless granted; non-`pause`/`stop`/`dispose` commands require
 * granted access.
 *
 * Nothing here queries permissions, resolves handles, or posts messages.
 */

export const ACCESS_GRANTED = 'granted';
export const ACCESS_CHECKING = 'checking';
export const ACCESS_NO_SELECTION = 'no selected source';

export type AccessAction = 'play' | 'wait' | 'select-track' | 're-add' | 'grant-and-retry';

/** True when the current source resolves and transport may proceed. */
export function isAccessGranted(access: string): boolean {
  return access === ACCESS_GRANTED;
}

/** True while a `QueueLoad` materialization is in flight. */
export function isAccessChecking(access: string): boolean {
  return access === ACCESS_CHECKING;
}

/** True when the queue has no current occurrence to materialize. */
export function hasNoSelection(access: string): boolean {
  return access === ACCESS_NO_SELECTION;
}

/** True for plain-`File` (`ephemeral`) sources after reload. */
export function isNonRestorable(access: string): boolean {
  return access.startsWith('non-restorable:');
}

/**
 * Map an access string to the UI action. `grant-and-retry` covers both
 * capability grants and plain-`File` reselection via the restore flow; the
 * worker reports the specific kind in the string.
 */
export function describeAccessAction(access: string): AccessAction {
  if (isAccessGranted(access)) return 'play';
  if (isAccessChecking(access)) return 'wait';
  if (hasNoSelection(access)) return 'select-track';
  if (isNonRestorable(access)) return 're-add';
  return 'grant-and-retry';
}
