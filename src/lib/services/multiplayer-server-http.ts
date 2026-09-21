/**
 * Server HTTP transport: strict JSON calls for host auth, rooms, join, and
 * socket tickets. All requests use AbortSignal, omit credentials, and reject
 * redirects. Secrets travel in bodies or bearer headers, never URLs.
 */
import {
  SERVER_APP_PROTOCOL_CAPABILITIES,
  SERVER_APP_PROTOCOL_MAJOR,
  SERVER_APP_PROTOCOL_MINOR,
  type ServerErrorCode
} from './multiplayer-server-protocol';

export class ServerError extends Error {
  readonly code: ServerErrorCode | string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(code: ServerErrorCode | string, status: number, retryAfterSeconds: number | null = null) {
    super(code);
    this.name = 'ServerError';
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ServerSession {
  sessionToken: string;
  expiresAt: string;
}

export interface ServerRoom {
  roomId: string;
  ownerSecret: string;
  invitationSecret: string;
  expiresAt: string;
}

export interface ServerJoinResult {
  connectionId: string;
  connectionToken: string;
  attemptId: string;
  socketTicket: string;
  ticketExpiresAt: string;
  attemptExpiresAt: string;
}

export interface ServerTicket {
  ticket: string;
  expiresAt: string;
}

export interface ServerServerInfo {
  signalingVersion: number;
  appProtocolMajor: number;
  appProtocolMinor: number;
  appCapabilities: string[];
  /** Legacy integer; present only on pre-Phase-0 servers. */
  appProtocolVersion?: number;
  description: string;
  contact: string;
  iceUrls: string[];
  limits: {
    maxRooms: number;
    maxPeersPerRoom: number;
    maxPendingAttemptsPerRoom: number;
  };
}

export function isCompatibleServerServer(info: Pick<
  ServerServerInfo,
  'appProtocolMajor' | 'appCapabilities'
> & { appProtocolVersion?: number }): boolean {
  const major = info.appProtocolMajor
    ?? (typeof info.appProtocolVersion === 'number' ? info.appProtocolVersion : NaN);
  // Legacy servers expose only the old integer; treat it as incompatible with
  // the major/minor split (scorched-earth pre-alpha break).
  if (typeof info.appProtocolMajor !== 'number') return false;
  return major === SERVER_APP_PROTOCOL_MAJOR;
}

/** Normalize an endpoint once: trim, drop trailing slashes, keep prefix path. */
export function normalizeServerEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) throw new ServerError('bad-request', 0);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ServerError('bad-request', 0);
  }
  if (url.username || url.password) throw new ServerError('bad-request', 0);
  if (url.hash || url.search) throw new ServerError('bad-request', 0);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ServerError('bad-request', 0);
  }
  const host = url.hostname.toLowerCase();
  const isLoopback = host === 'localhost'
    || host === '127.0.0.1'
    || host === '::1'
    || host.endsWith('.localhost');
  if (url.protocol === 'http:' && !isLoopback) {
    throw new ServerError('bad-request', 0);
  }
  // Keep the deployment prefix path as-is (no trailing slash).
  return url.toString().replace(/\/+$/, '');
}

export function serverSocketUrl(endpoint: string): string {
  const url = new URL(`${normalizeServerEndpoint(endpoint)}/v1/socket`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function apiUrl(endpoint: string, path: string): string {
  return `${normalizeServerEndpoint(endpoint)}${path}`;
}

async function parseServerError(response: Response): Promise<ServerError> {
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
  return new ServerError(code, response.status, retryAfter);
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
  if (!response.ok) throw await parseServerError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function fetchServerInfo(endpoint: string, signal?: AbortSignal): Promise<ServerServerInfo> {
  const response = await fetch(apiUrl(endpoint, '/v1/info'), {
    method: 'GET',
    signal,
    credentials: 'omit',
    redirect: 'error'
  });
  if (!response.ok) throw await parseServerError(response);
  return (await response.json()) as ServerServerInfo;
}

export async function createServerSession(
  endpoint: string,
  hostKey: string,
  signal?: AbortSignal
): Promise<ServerSession> {
  return requestJson<ServerSession>('POST', endpoint, '/v1/host/sessions', {
    signal,
    body: { hostKey }
  });
}

export async function deleteServerSession(
  endpoint: string,
  sessionToken: string,
  signal?: AbortSignal
): Promise<void> {
  await requestJson<void>('DELETE', endpoint, '/v1/host/session', {
    signal,
    bearer: sessionToken
  });
}

export async function createServerRoom(
  endpoint: string,
  sessionToken: string,
  capacity: number,
  signal?: AbortSignal
): Promise<ServerRoom> {
  return requestJson<ServerRoom>('POST', endpoint, '/v1/rooms', {
    signal,
    bearer: sessionToken,
    body: { capacity }
  });
}

export async function resumeServerRoom(
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

export async function renewServerRoom(
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

export async function rotateServerInvitation(
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

export async function deleteServerRoom(
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

export async function joinServerRoom(
  endpoint: string,
  roomId: string,
  invitationSecret: string,
  attemptNonce: string,
  signal?: AbortSignal
): Promise<ServerJoinResult> {
  return requestJson<ServerJoinResult>('POST', endpoint, '/v1/join', {
    signal,
    body: {
      roomId,
      invitationSecret,
      attemptNonce,
      appProtocolMajor: SERVER_APP_PROTOCOL_MAJOR,
      appProtocolMinor: SERVER_APP_PROTOCOL_MINOR,
      appCapabilities: [...SERVER_APP_PROTOCOL_CAPABILITIES]
    }
  });
}

export interface ServerIceResult {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  expiresAt: string | null;
}

export async function fetchServerIce(
  endpoint: string,
  bearer: string,
  roomId: string | null,
  signal?: AbortSignal
): Promise<ServerIceResult> {
  return requestJson<ServerIceResult>('POST', endpoint, '/v1/ice', {
    signal,
    bearer,
    body: roomId ? { roomId } : {}
  });
}

export async function recreateServerRoom(
  endpoint: string,
  sessionToken: string,
  saved: { roomId: string; ownerSecret: string; invitationSecret: string },
  capacity: number,
  signal?: AbortSignal
): Promise<ServerRoom> {
  return requestJson<ServerRoom>('POST', endpoint, '/v1/rooms', {
    signal,
    bearer: sessionToken,
    body: {
      capacity,
      roomId: saved.roomId,
      ownerSecret: saved.ownerSecret,
      invitationSecret: saved.invitationSecret
    }
  });
}

export async function mintServerSocketTicket(
  endpoint: string,
  bearer: string,
  roomId: string | null,
  signal?: AbortSignal
): Promise<ServerTicket> {
  return requestJson<ServerTicket>('POST', endpoint, '/v1/socket-tickets', {
    signal,
    bearer,
    body: roomId ? { roomId } : {}
  });
}

/** Jittered backoff for transient failures, bounded by the caller deadline. */
export function serverBackoffDelay(attempt: number): number {
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
