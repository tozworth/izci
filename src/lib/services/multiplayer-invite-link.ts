/**
 * Multiplayer invite deep links: `https://<origin>/#join=<invite code>`.
 * Parsed from the URL hash at startup so offline service-worker launches
 * still deliver the code; the hash is consumed (stripped) either way.
 */

const INVITE_HASH_PARAM_PATTERN = /(?:^|[#?&])join=([a-z0-9]{8})(?![a-z0-9])/;

export function buildInviteLink(inviteCode: string, origin?: string): string {
  const base = origin ?? window.location.origin;
  return `${base}/#join=${inviteCode}`;
}

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
