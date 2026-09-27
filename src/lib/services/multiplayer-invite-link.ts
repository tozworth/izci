/**
 * Recognize retired invite links so offline launches can explain retirement.
 * These codes never initiate a signaling connection.
 */

const INVITE_HASH_PARAM_PATTERN = /(?:^|[#?&])join=([a-z0-9]{8})(?![a-z0-9])/;

/** Returns the invite code embedded in a hash fragment, if any. */
export function parseInviteLinkHash(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  return INVITE_HASH_PARAM_PATTERN.exec(hash)?.[1] ?? null;
}

/**
 * Reads and strips `#join=<code>` from the current URL. Returns the code on
 * the first call and null afterwards; the strip happens even without a code.
 */
export function consumeInviteLinkHash(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history
): string | null {
  const code = parseInviteLinkHash(location.hash);
  if (location.hash) {
    history.replaceState(null, '', `${location.pathname || '/'}${location.search}`);
  }
  return code;
}
