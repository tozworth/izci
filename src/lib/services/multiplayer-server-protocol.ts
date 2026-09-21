/**
 * Server signaling protocol: JSON socket frames with `version`, `type`,
 * `requestId`, optional `attemptId`, and `payload`.
 *
 * Mirrors `izci-server/internal/signaling/protocol.go`. The wire definitions live
 * here in code; `tests/multiplayer-server-contract/` holds representative
 * fixtures that this module must accept/reject in parity with the Go server.
 * Signaling version 1 is separate from the app (RTC/data-channel) protocol.
 */
import {
  MULTIPLAYER_PROTOCOL_CAPABILITIES,
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR
} from './multiplayer-protocol';

export const SERVER_SIGNALING_VERSION = 1;

/** Must match AppProtocolMajor/Minor in izci-server/internal/signaling/signaling.go. */
export const SERVER_APP_PROTOCOL_MAJOR = MULTIPLAYER_PROTOCOL_MAJOR;
export const SERVER_APP_PROTOCOL_MINOR = MULTIPLAYER_PROTOCOL_MINOR;
export const SERVER_APP_PROTOCOL_CAPABILITIES: readonly string[] = MULTIPLAYER_PROTOCOL_CAPABILITIES;

export const SERVER_MAX_SDP_BYTES = 50 * 1024;
export const SERVER_MAX_CANDIDATE_BYTES = 4 * 1024;
export const SERVER_MAX_CANDIDATES_PER_SIDE = 128;

export type ServerClientMessageType =
  | 'auth'
  | 'accept'
  | 'reject'
  | 'offer'
  | 'answer'
  | 'candidate'
  | 'candidates-end'
  | 'connected'
  | 'release';

export type ServerServerMessageType =
  | 'ready'
  | 'peer.requested'
  | 'peer.accepted'
  | 'peer.rejected'
  | 'offer'
  | 'answer'
  | 'candidate'
  | 'candidates-end'
  | 'peer.connected'
  | 'peer.released'
  | 'error';

export type ServerMessageType = ServerClientMessageType | ServerServerMessageType;

export type ServerErrorCode =
  | 'bad-request'
  | 'unsupported-version'
  | 'unauthorized'
  | 'room-unavailable'
  | 'room-full'
  | 'rate-limited'
  | 'attempt-expired'
  | 'host-unavailable'
  | 'ticket-expired'
  | 'ticket-consumed'
  | 'server-shutting-down'
  | 'payload-too-large'
  | 'not-found'
  | 'method-not-allowed'
  | 'origin-forbidden';

export interface ServerEnvelope {
  version: number;
  type: ServerMessageType;
  requestId: string;
  attemptId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Record<string, any>;
}

export interface ServerAuthPayload {
  ticket: string;
}

export interface ServerSdpPayload {
  sdp: string;
}

export interface ServerCandidatePayload {
  candidate: string;
  index: number;
  sdpMid: string;
  sdpMLineIndex: number;
}

export interface ServerErrorPayload {
  code: string;
  retryAfter?: number;
}

export interface ServerReadyPayload {
  role: 'host' | 'guest';
  roomId: string;
  connectionId?: string;
}

export interface ServerPeerRequestedPayload {
  connectionId: string;
}

export interface ServerPeerRejectedPayload {
  reason: string;
}

const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'auth',
  'accept',
  'reject',
  'offer',
  'answer',
  'candidate',
  'candidates-end',
  'connected',
  'release'
]);

const KNOWN_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  ...CLIENT_MESSAGE_TYPES,
  'ready',
  'peer.requested',
  'peer.accepted',
  'peer.rejected',
  'offer',
  'answer',
  'candidate',
  'candidates-end',
  'peer.connected',
  'peer.released',
  'error'
]);

const ATTEMPT_SCOPED_TYPES: ReadonlySet<string> = new Set([
  'accept',
  'reject',
  'offer',
  'answer',
  'candidate',
  'candidates-end',
  'connected',
  'release'
]);

const HEX_ID_PATTERN = /^[0-9a-f]{32}$/;

function isValidRequestId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return false;
  // eslint-disable-next-line no-control-regex
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code >= 0 && code <= 0x1f) || code === 0x7f) return false;
  }
  return true;
}

export function isValidHexId(value: unknown): value is string {
  return typeof value === 'string' && HEX_ID_PATTERN.test(value);
}

const TOP_LEVEL_FIELDS: ReadonlySet<string> = new Set([
  'version',
  'type',
  'requestId',
  'attemptId',
  'payload'
]);

export interface ServerDecodeSuccess {
  ok: true;
  envelope: ServerEnvelope;
}

export interface ServerDecodeFailure {
  ok: false;
  code: ServerErrorCode;
}

export function createServerRequestId(prefix = 'req'): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createServerNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Strictly decode one socket frame. Returns the envelope on success or a
 * stable error code on failure. Unknown top-level/payload fields, unknown
 * types, bad versions, malformed IDs, and out-of-range values are rejected.
 */
export function decodeServerMessage(data: string | ArrayBuffer): ServerDecodeSuccess | ServerDecodeFailure {
  let text: string;
  if (typeof data !== 'string') {
    try {
      text = new TextDecoder().decode(data);
    } catch {
      return { ok: false, code: 'bad-request' };
    }
  } else {
    text = data;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad-request' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'bad-request' };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!TOP_LEVEL_FIELDS.has(key)) return { ok: false, code: 'bad-request' };
  }
  const { version, type, requestId, attemptId, payload } = record;
  if (version !== SERVER_SIGNALING_VERSION) {
    return {
      ok: false,
      code: typeof version === 'number' ? 'unsupported-version' : 'bad-request'
    };
  }
  if (typeof type !== 'string' || !KNOWN_MESSAGE_TYPES.has(type)) {
    return { ok: false, code: 'bad-request' };
  }
  if (!isValidRequestId(requestId)) return { ok: false, code: 'bad-request' };
  const attempt = attemptId === undefined ? '' : attemptId;
  if (typeof attempt !== 'string') return { ok: false, code: 'bad-request' };
  if (ATTEMPT_SCOPED_TYPES.has(type)) {
    if (!isValidHexId(attempt)) return { ok: false, code: 'bad-request' };
  } else if (type !== 'auth' && attempt !== '' && !isValidHexId(attempt)) {
    return { ok: false, code: 'bad-request' };
  }
  if (payload !== undefined
    && (!payload || typeof payload !== 'object' || Array.isArray(payload))) {
    return { ok: false, code: 'bad-request' };
  }
  const payloadRecord = (payload ?? {}) as Record<string, unknown>;
  const messageType = type as ServerMessageType;
  const payloadCode = validateServerPayload(messageType, payloadRecord);
  if (payloadCode) return { ok: false, code: payloadCode };
  const envelope: ServerEnvelope = {
    version: SERVER_SIGNALING_VERSION,
    type: messageType,
    requestId: requestId as string,
    ...(attempt !== '' ? { attemptId: attempt } : {}),
    ...(payload !== undefined ? { payload: payloadRecord } : {})
  };
  return { ok: true, envelope };
}

function validateServerPayload(
  type: ServerMessageType,
  payload: Record<string, unknown>
): ServerErrorCode | null {
  const keys = Object.keys(payload);
  const hasOnly = (...allowed: string[]): boolean =>
    keys.every((key) => allowed.includes(key));
  switch (type) {
    case 'auth': {
      if (!hasOnly('ticket')) return 'bad-request';
      const ticket = payload['ticket'];
      if (typeof ticket !== 'string' || ticket.length === 0 || ticket.length > 256) {
        return 'bad-request';
      }
      return null;
    }
    case 'offer':
    case 'answer': {
      if (!hasOnly('sdp')) return 'bad-request';
      const sdp = payload['sdp'];
      if (typeof sdp !== 'string' || sdp.length === 0 || sdp.length > SERVER_MAX_SDP_BYTES) {
        return 'bad-request';
      }
      return null;
    }
    case 'candidate': {
      if (!hasOnly('candidate', 'index', 'sdpMid', 'sdpMLineIndex')) return 'bad-request';
      const candidate = payload['candidate'];
      const index = payload['index'];
      const sdpMid = payload['sdpMid'];
      const sdpMLineIndex = payload['sdpMLineIndex'];
      if (typeof candidate !== 'string'
        || candidate.length === 0
        || candidate.length > SERVER_MAX_CANDIDATE_BYTES) return 'bad-request';
      if (typeof index !== 'number'
        || !Number.isInteger(index)
        || index < 0
        || index >= SERVER_MAX_CANDIDATES_PER_SIDE) return 'bad-request';
      if (typeof sdpMid !== 'string' || sdpMid.length > 64) return 'bad-request';
      if (typeof sdpMLineIndex !== 'number'
        || !Number.isInteger(sdpMLineIndex)
        || sdpMLineIndex < 0
        || sdpMLineIndex > 65_535) return 'bad-request';
      return null;
    }
    case 'accept':
    case 'reject':
    case 'candidates-end':
    case 'connected':
    case 'release':
    case 'peer.accepted':
    case 'peer.connected': {
      if (keys.length !== 0) return 'bad-request';
      return null;
    }
    case 'ready': {
      if (!hasOnly('role', 'roomId', 'connectionId')) return 'bad-request';
      if (payload['role'] !== 'host' && payload['role'] !== 'guest') return 'bad-request';
      if (!isValidHexId(payload['roomId'])) return 'bad-request';
      const connectionId = payload['connectionId'];
      if (connectionId !== undefined && !isValidHexId(connectionId)) return 'bad-request';
      if (payload['role'] === 'guest' && !isValidHexId(connectionId)) return 'bad-request';
      return null;
    }
    case 'peer.requested': {
      if (!hasOnly('connectionId')) return 'bad-request';
      if (!isValidHexId(payload['connectionId'])) return 'bad-request';
      return null;
    }
    case 'peer.rejected':
    case 'peer.released': {
      if (!hasOnly('reason')) return 'bad-request';
      if (typeof payload['reason'] !== 'string' || payload['reason'].length === 0) {
        return 'bad-request';
      }
      return null;
    }
    case 'error': {
      if (!hasOnly('code', 'retryAfter')) return 'bad-request';
      if (typeof payload['code'] !== 'string' || payload['code'].length === 0) {
        return 'bad-request';
      }
      const retryAfter = payload['retryAfter'];
      if (retryAfter !== undefined
        && (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter) || retryAfter < 0)) {
        return 'bad-request';
      }
      return null;
    }
    default:
      return 'bad-request';
  }
}

export function encodeServerMessage(
  type: ServerClientMessageType,
  requestId: string,
  payload?: Record<string, unknown>,
  attemptId?: string
): string {
  const envelope: Record<string, unknown> = {
    version: SERVER_SIGNALING_VERSION,
    type,
    requestId,
    ...(attemptId ? { attemptId } : {}),
    ...(payload ? { payload } : {})
  };
  return JSON.stringify(envelope);
}

/** Errors that require user action rather than automatic retry. */
export function isServerFatalError(code: string): boolean {
  return code === 'unauthorized'
    || code === 'unsupported-version'
    || code === 'room-unavailable'
    || code === 'ticket-expired'
    || code === 'ticket-consumed';
}
