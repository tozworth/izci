/**
 * Sidekick HTTP transport: strict JSON calls for host auth, rooms, join, and
 * socket tickets. All requests use AbortSignal, omit credentials, and reject
 * redirects. Secrets travel in bodies or bearer headers, never URLs.
 */
import {
  SIDEKICK_APP_PROTOCOL_VERSION,
  type SidekickErrorCode
} from './multiplayer-sidekick-protocol';

export class SidekickError extends Error {
  readonly code: SidekickErrorCode | string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(code: SidekickErrorCode | string, status: number, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'SidekickError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface SidekickSession {
  sessionToken: string;
  expiresAt: string;
}

export interface SidekickRoom {
  roomId: string;
  ownerSecret: string;
  invitationSecret: string;
  expiresAt: string;
}

export interface SidekickJoinResult {
  connectionId: string;
  connectionToken: string;
  attemptId: string;
  socketTicket: string;
  ticketExpiresAt: string;
  attemptExpiresAt: string;
}

export interface SidekickTicket {
  ticket: string;
  expiresAt: string;
}

export interface SidekickServerInfo {
  signalingVersion: number;
  appProtocolVersion: number;
  description: string;
  contact: string;
  iceUrls: string[];
  limits: {
    maxRooms: number;
    maxPeersPerRoom: number;
    maxPendingAttemptsPerRoom: number;
  };
}

/** Normalize an endpoint once: trim, drop trailing slashes, keep prefix path. */
export function normalizeSidekickEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new SidekickError('bad-request', 0);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SidekickError('bad-request', 0);
  }
  if (url.username || url.password) throw new SidekickError('bad-request', 0);
  if (url.hash || url.search) throw new SidekickError('bad-request', 0);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SidekickError('bad-request', 0);
  }
  const host = url.hostname.toLowerCase();
  const isLoopback = host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host.endsWith('.localhost');
  if (url.protocol === 'http:' && !isLoopback) {
    throw new SidekickError('bad-request', 0);
  }
  // Keep the deployment prefix path as-is (no trailing slash).
  return url.toString().replace(/\/+$/, '');
}

export function sidekickSocketUrl(endpoint: string): string {
  const url = new URL(`${normalizeSidekickEndpoint(endpoint)}/v1/socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function apiUrl(endpoint: string, path: string): string {
  return `${normalizeSidekickEndpoint(endpoint)}${path}`;
}

async function parseSidekickError(response: Response): Promise<SidekickError> {
  let code = 'bad-request';
  let retryAfter: number | null = null;
  try {
    const body = (await response.json()) as {
      error?: { code?: string; retryAfter?: number };
    };
    if (typeof body?.error?.code === 'string' && body.error.code) code = body.error.code;
    if (typeof body?.error?.retryAfter === 'number') retryAfter = body.error.retryAfter;
  } catch {
    // Fall through with the generic code.
  }
  if (response.headers.has('Retry-After') && retryAfter === null) {
    const parsed = Number(response.headers.get('Retry-After'));
    if (Number.isFinite(parsed) && parsed >= 0) retryAfter = parsed;
  }
  return new SidekickError(code, response.status, retryAfter);
}

interface RequestOptions {
  signal?: AbortSignal;
  bearer?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body?: any;
}

async function requestJson<T>(
  method: string,
  endpoint: string,
  path: string,
  options: RequestOptions = {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<T> {
  const response = await fetch(apiUrl(endpoint, path), {
    method,
    signal: options.signal,
    credentials: 'omit',
    redirect: 'error',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {})
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw await parseSidekickError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchSidekickInfo(endpoint: string, signal?: AbortSignal): Promise<SidekickServerInfo> {
  const response = await fetch(apiUrl(endpoint, '/v1/info'), {
    method: 'GET',
    signal,
    credentials: 'omit',
    redirect: 'error'
  });
  if (!response.ok) throw await parseSidekickError(response);
  return (await response.json()) as SidekickServerInfo;
}

export async function createSidekickSession(
  endpoint: string,
  hostKey: string,
  signal?: AbortSignal
): Promise<SidekickSession> {
  return requestJson<SidekickSession>('POST', endpoint, '/v1/host/sessions', {
    signal,
    body: { hostKey }
  });
}

export async function deleteSidekickSession(
  endpoint: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<void> {
  await requestJson<void>('DELETE', endpoint, '/v1/host/session', {
    signal,
    bearer: sessionToken
  });
}

export async function createSidekickRoom(
  endpoint: string,
  sessionToken: string,
  capacity: number,
  signal?: AbortSignal
): Promise<SidekickRoom> {
  return requestJson<SidekickRoom>('POST', endpoint, '/v1/rooms', {
    signal,
    bearer: sessionToken,
    body: { capacity }
  });
}

export async function resumeSidekickRoom(
  endpoint: string,
  sessionToken: string,
  roomId: string,
  ownerSecret: string,
  signal?: AbortSignal
): Promise<{ roomId: string; expiresAt: string }> {
  return requestJson('POST', endpoint, `/v1/rooms/${roomId}/resume`, {
    signal,
    bearer: sessionToken,
    body: { ownerSecret }
  });
}

export async function renewSidekickRoom(
  endpoint: string,
  sessionToken: string,
  roomId: string,
  signal?: AbortSignal
): Promise<{ roomId: string; expiresAt: string }> {
  return requestJson('POST', endpoint, `/v1/rooms/${roomId}/renew`, {
    signal,
    bearer: sessionToken
  });
}

export async function rotateSidekickInvitation(
  endpoint: string,
  sessionToken: string,
  roomId: string,
  signal?: AbortSignal
): Promise<{ roomId: string; invitationSecret: string }> {
  return requestJson('POST', endpoint, `/v1/rooms/${roomId}/rotate`, {
    signal,
    bearer: sessionToken
  });
}

export async function deleteSidekickRoom(
  endpoint: string,
  sessionToken: string,
  roomId: string,
  signal?: AbortSignal
): Promise<void> {
  await requestJson<void>('DELETE', endpoint, `/v1/rooms/${roomId}`, {
    signal,
    bearer: sessionToken
  });
}

export async function joinSidekickRoom(
  endpoint: string,
  roomId: string,
  invitationSecret: string,
  attemptNonce: string,
  signal?: AbortSignal
): Promise<SidekickJoinResult> {
  return requestJson<SidekickJoinResult>('POST', endpoint, '/v1/join', {
    signal,
    body: {
      roomId,
      invitationSecret,
      attemptNonce,
      appProtocol: SIDEKICK_APP_PROTOCOL_VERSION
    }
  });
}

export async function mintSidekickSocketTicket(
  endpoint: string,
  bearer: string,
  roomId: string | null,
  signal?: AbortSignal
): Promise<SidekickTicket> {
  return requestJson<SidekickTicket>('POST', endpoint, '/v1/socket-tickets', {
    signal,
    bearer,
    body: roomId ? { roomId } : {}
  });
}

/** Jittered backoff for transient failures, bounded by the caller deadline. */
export function sidekickBackoffDelay(attempt: number): number {
  const base = [500, 1_000, 2_000, 5_000, 10_000][Math.min(attempt, 4)];
  return base + Math.floor(Math.random() * 500);
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
