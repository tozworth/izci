/**
 * Sidekick invitations keep the destination readable and put the opaque
 * admission material in a separate code:
 * `https://<origin>/#party=<sidekick URL>&code=<room>.<secret>`.
 *
 * Invitations are parsed locally, captured as pending state, and the
 * secret-bearing fragment is then removed from the address bar. Legacy
 * `#join=` invite codes stay owned by `multiplayer-invite-link`.
 *
 * Endpoints accept HTTPS only, except loopback development addresses where
 * plain HTTP is allowed (mirroring the server's `publicBaseUrl` rule).
 * Secrets travel in the fragment only, never in fetch URLs or logs; use
 * `redactSidekickSecrets` before surfacing errors or diagnostics.
 */

export const SIDEKICK_INVITE_MAX_BYTES = 4 * 1024;
export const SIDEKICK_INVITE_TITLE_MAX = 120;
export const SIDEKICK_INVITE_SECRET_MAX = 512;
export const SIDEKICK_ROOM_ID_PATTERN = /^[0-9a-f]{32}$/;

export interface SidekickInvitation {
  endpoint: string;
  roomId: string;
  secret: string;
  title: string | null;
}

export type SidekickInviteErrorCode =
  | 'too-large'
  | 'bad-encoding'
  | 'bad-payload'
  | 'bad-version'
  | 'bad-endpoint'
  | 'bad-room'
  | 'bad-secret'
  | 'bad-title';

export class SidekickInviteError extends Error {
  readonly code: SidekickInviteErrorCode;

  constructor(code: SidekickInviteErrorCode) {
    super(code);
    this.name = 'SidekickInviteError';
    this.code = code;
  }
}

/**
 * Strictly validate a sidekick endpoint and normalize it once: trim,
 * require HTTPS (HTTP only for loopback development hosts), reject URL
 * credentials, query/fragment components, malformed ports, and ambiguous
 * deployment paths. Returns the normalized base URL without trailing slash.
 */
export function normalizeSidekickInviteEndpoint(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) throw new SidekickInviteError('bad-endpoint');
  // A full invitation must never smuggle query/fragment parts into the field.
  if (trimmed.includes('?') || trimmed.includes('#')) throw new SidekickInviteError('bad-endpoint');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SidekickInviteError('bad-endpoint');
  }
  if (url.username || url.password) throw new SidekickInviteError('bad-endpoint');
  if (url.hash || url.search) throw new SidekickInviteError('bad-endpoint');
  const host = url.hostname.toLowerCase();
  const isLoopback = host === 'localhost'
    || host === '::1'
    || host === '[::1]'
    || host === '127.0.0.1'
    || host.startsWith('127.')
    || host.endsWith('.localhost');
  if (url.protocol === 'http:' && !isLoopback) throw new SidekickInviteError('bad-endpoint');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SidekickInviteError('bad-endpoint');
  }
  // Reject explicit default-port noise and malformed ports (URL throws on
  // the latter, but an empty port after a colon also fails to parse).
  if (url.port !== '' && (Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw new SidekickInviteError('bad-endpoint');
  }
  // Ambiguous deployment prefixes: doubled slashes, a bare /v1 segment, or
  // anything that already looks like an API route rather than a prefix.
  const path = url.pathname;
  if (path.includes('//')) throw new SidekickInviteError('bad-endpoint');
  const segments = path.split('/').filter((segment) => segment !== '');
  if (segments.includes('v1')) throw new SidekickInviteError('bad-endpoint');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new SidekickInviteError('bad-endpoint');
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizeInviteTitle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new SidekickInviteError('bad-title');
  const title = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, SIDEKICK_INVITE_TITLE_MAX + 1);
  if (!title) return null;
  if (title.length > SIDEKICK_INVITE_TITLE_MAX) throw new SidekickInviteError('bad-title');
  return title;
}

export function parseSidekickInvitation(raw: string): SidekickInvitation {
  if (raw.length > SIDEKICK_INVITE_MAX_BYTES) throw new SidekickInviteError('too-large');
  const params = new URLSearchParams(`party=${raw}`);
  for (const key of params.keys()) {
    if (key !== 'party' && key !== 'code') throw new SidekickInviteError('bad-payload');
  }
  const endpointRaw = params.get('party');
  const code = params.get('code');
  if (!endpointRaw) throw new SidekickInviteError('bad-endpoint');
  if (!code) throw new SidekickInviteError('bad-encoding');
  const separator = code.indexOf('.');
  const roomId = separator < 0 ? '' : code.slice(0, separator);
  const secret = separator < 0 ? '' : code.slice(separator + 1);
  const endpoint = normalizeSidekickInviteEndpoint(endpointRaw);
  if (!SIDEKICK_ROOM_ID_PATTERN.test(roomId)) {
    throw new SidekickInviteError('bad-room');
  }
  if (!secret || secret.length > SIDEKICK_INVITE_SECRET_MAX) {
    throw new SidekickInviteError('bad-secret');
  }
  return { endpoint, roomId, secret, title: null };
}

export function buildSidekickInvitationPayload(invitation: SidekickInvitation): string {
  const endpoint = normalizeSidekickInviteEndpoint(invitation.endpoint);
  if (!SIDEKICK_ROOM_ID_PATTERN.test(invitation.roomId)) throw new SidekickInviteError('bad-room');
  if (!invitation.secret || invitation.secret.length > SIDEKICK_INVITE_SECRET_MAX) {
    throw new SidekickInviteError('bad-secret');
  }
  // Validate the label even though invitations intentionally omit it. The
  // connected peer supplies the authoritative name after admission.
  normalizeInviteTitle(invitation.title);
  const payload = `${endpoint}&code=${encodeURIComponent(`${invitation.roomId}.${invitation.secret}`)}`;
  if (`#party=${payload}`.length > SIDEKICK_INVITE_MAX_BYTES) {
    throw new SidekickInviteError('too-large');
  }
  return payload;
}

export function buildSidekickInviteLink(invitation: SidekickInvitation, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}/#party=${buildSidekickInvitationPayload(invitation)}`;
}

const PARTY_HASH_PATTERN = /(?:^|[#?&])party=/;

/**
 * Returns the raw invitation payload embedded in a hash fragment, or null
 * when no party fragment is present. The value may be empty or malformed;
 * validation happens in `parseSidekickInvitation`.
 */
export function parseSidekickInviteHash(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  const match = PARTY_HASH_PATTERN.exec(hash);
  return match ? hash.slice(match.index + match[0].length) : null;
}

/** Parse a pasted full invitation URL or its fragment payload. */
export function parseSidekickInviteText(value: string, defaultEndpoint = ''): SidekickInvitation {
  const trimmed = value.trim();
  if (!trimmed.includes('#') && !trimmed.startsWith('party=') && defaultEndpoint) {
    return parseSidekickInvitation(
      `${defaultEndpoint}&code=${encodeURIComponent(trimmed)}`
    );
  }
  const hashIndex = trimmed.indexOf('#');
  const hash = hashIndex >= 0 ? trimmed.slice(hashIndex) : trimmed.startsWith('party=')
    ? `#${trimmed}`
    : trimmed.startsWith('#') ? trimmed : `#party=${trimmed}`;
  const raw = parseSidekickInviteHash(hash);
  if (raw === null) throw new SidekickInviteError('bad-payload');
  return parseSidekickInvitation(raw);
}

/**
 * Reads a `#party=` invitation from the current URL and strips the
 * secret-bearing fragment either way. Returns the parsed invitation, or
 * null when no party fragment is present. Throws SidekickInviteError for a
 * malformed invitation (the fragment is still stripped).
 */
export function consumeSidekickInvite(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState'> = window.history
): SidekickInvitation | null {
  const raw = parseSidekickInviteHash(location.hash);
  if (raw === null) return null;
  history.replaceState(null, '', `${location.pathname || '/'}${location.search}`);
  return parseSidekickInvitation(raw);
}

export interface SidekickEndpointDisplay {
  /** Full `authority + prefix` shown for confirmation. */
  authorityWithPrefix: string;
  /** ASCII (punycode) hostname; differs from the display host when set. */
  asciiHost: string | null;
  /** True when the hostname carries non-ASCII characters. */
  suspicious: boolean;
}

/** Describe an endpoint for the Join confirmation step. */
export function describeSidekickEndpoint(endpoint: string): SidekickEndpointDisplay {
  // URL normalizes Unicode hosts to punycode, so scan the raw input for
  // non-ASCII characters before normalization consumes the evidence.
  const suspicious = /[^\x00-\x7f]/.test(endpoint);
  const normalized = normalizeSidekickInviteEndpoint(endpoint);
  const url = new URL(normalized);
  const prefix = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return {
    authorityWithPrefix: `${url.host}${prefix}`,
    asciiHost: suspicious ? url.hostname : null,
    suspicious
  };
}

/**
 * Redact invitation fragments and secret-shaped tokens from errors and
 * diagnostics before display or logging. Secrets never reach the UI text.
 */
export function redactSidekickSecrets(text: string): string {
  return text
    .replace(/#party=[^\s"']+/g, '#party=[redacted]')
    .replace(/("[\w]*[Ss]ecret"\s*:\s*")[^"]+(")/g, '$1[redacted]$2')
    .replace(/((?:invitation|owner)?[Ss]ecret\s*=\s*["']?)[A-Za-z0-9_.-]+(["']?)/g, '$1[redacted]$2');
}
