/**
 * Sidekick `#party=` invitations: `https://<origin>/#party=<base64url JSON>`.
 *
 * The JSON payload carries `v`, `endpoint`, `roomId`, `secret`, and an
 * optional `title`. Invitations are parsed locally, captured as pending
 * state, and the secret-bearing fragment is then removed from the address
 * bar. Legacy `#join=` invite codes stay owned by `multiplayer-invite-link`.
 *
 * Endpoints accept HTTPS only, except loopback development addresses where
 * plain HTTP is allowed (mirroring the server's `publicBaseUrl` rule).
 * Secrets travel in the fragment only, never in fetch URLs or logs; use
 * `redactSidekickSecrets` before surfacing errors or diagnostics.
 */

export const SIDEKICK_INVITE_VERSION = 1;
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

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(raw: string): Uint8Array {
  if (!raw) throw new SidekickInviteError('bad-encoding');
  if (raw.length > SIDEKICK_INVITE_MAX_BYTES) throw new SidekickInviteError('too-large');
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new SidekickInviteError('bad-encoding');
  const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  if (remainder === 1) throw new SidekickInviteError('bad-encoding');
  let binary: string;
  try {
    binary = atob(padded + (remainder === 0 ? '' : '='.repeat(4 - remainder)));
  } catch {
    throw new SidekickInviteError('bad-encoding');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  const bytes = decodeBase64Url(raw);
  if (bytes.length > SIDEKICK_INVITE_MAX_BYTES) throw new SidekickInviteError('too-large');
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SidekickInviteError('bad-payload');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new SidekickInviteError('bad-payload');
  }
  const record = payload as Record<string, unknown>;
  const allowed = new Set(['v', 'endpoint', 'roomId', 'secret', 'title']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new SidekickInviteError('bad-payload');
  }
  if (record['v'] !== SIDEKICK_INVITE_VERSION) throw new SidekickInviteError('bad-version');
  if (typeof record['endpoint'] !== 'string') throw new SidekickInviteError('bad-endpoint');
  const endpoint = normalizeSidekickInviteEndpoint(record['endpoint']);
  if (typeof record['roomId'] !== 'string' || !SIDEKICK_ROOM_ID_PATTERN.test(record['roomId'])) {
    throw new SidekickInviteError('bad-room');
  }
  if (typeof record['secret'] !== 'string'
    || record['secret'].length === 0
    || record['secret'].length > SIDEKICK_INVITE_SECRET_MAX) {
    throw new SidekickInviteError('bad-secret');
  }
  return {
    endpoint,
    roomId: record['roomId'],
    secret: record['secret'],
    title: normalizeInviteTitle(record['title'])
  };
}

export function buildSidekickInvitationPayload(invitation: SidekickInvitation): string {
  const payload: Record<string, unknown> = {
    v: SIDEKICK_INVITE_VERSION,
    endpoint: normalizeSidekickInviteEndpoint(invitation.endpoint),
    roomId: invitation.roomId,
    secret: invitation.secret
  };
  if (!SIDEKICK_ROOM_ID_PATTERN.test(invitation.roomId)) throw new SidekickInviteError('bad-room');
  if (!invitation.secret || invitation.secret.length > SIDEKICK_INVITE_SECRET_MAX) {
    throw new SidekickInviteError('bad-secret');
  }
  const title = normalizeInviteTitle(invitation.title);
  if (title) payload['title'] = title;
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  if (encoded.length > SIDEKICK_INVITE_MAX_BYTES) throw new SidekickInviteError('too-large');
  if (`#party=${encoded}`.length > SIDEKICK_INVITE_MAX_BYTES) {
    throw new SidekickInviteError('too-large');
  }
  return encoded;
}

export function buildSidekickInviteLink(invitation: SidekickInvitation, origin?: string): string {
  const base = (origin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '');
  return `${base}/#party=${buildSidekickInvitationPayload(invitation)}`;
}

const PARTY_HASH_PATTERN = /(?:^|[#?&])party=([^&#?]*)/;

/**
 * Returns the raw base64url payload embedded in a hash fragment, or null
 * when no party fragment is present. The value may be empty or malformed;
 * validation happens in `parseSidekickInvitation`.
 */
export function parseSidekickInviteHash(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  return PARTY_HASH_PATTERN.exec(hash)?.[1] ?? null;
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
    .replace(/#party=[A-Za-z0-9_-]+/g, '#party=[redacted]')
    .replace(/("[\w]*[Ss]ecret"\s*:\s*")[^"]+(")/g, '$1[redacted]$2')
    .replace(/((?:invitation|owner)?[Ss]ecret\s*=\s*["']?)[A-Za-z0-9_.-]+(["']?)/g, '$1[redacted]$2');
}
