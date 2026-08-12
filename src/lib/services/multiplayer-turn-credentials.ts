import type { ExperimentalSettings } from '$lib/contracts/experimental-settings';
import type { MultiplayerIceSettings } from './multiplayer-ice';

const ECDH_ALGORITHM = { name: 'ECDH', namedCurve: 'P-256' } as const;
const TURN_CREDENTIAL_REQUEST_ID_BYTES = 12;
const AES_GCM_IV_BYTES = 12;

export interface MultiplayerTurnCredentialRequest {
  requestId: string;
  publicKey: string;
  createdAt: number;
}

export interface MultiplayerTurnCredentialResponse {
  requestId: string;
  publicKey: string;
  iv: string;
  ciphertext: string;
  createdAt: number;
}

interface TransientTurnPayload extends MultiplayerIceSettings {
  expiresAt: number;
}

export interface PendingMultiplayerTurnRequest {
  request: MultiplayerTurnCredentialRequest;
  decrypt(response: MultiplayerTurnCredentialResponse): Promise<MultiplayerIceSettings>;
}

type TurnIssuerSettings = Pick<
  ExperimentalSettings,
  'multiplayerTurnUrl'
  | 'multiplayerTurnSecret'
  | 'multiplayerTurnCredentialHours'
  | 'multiplayerForceTurn'
>;

export function hasMultiplayerTurnIssuer(settings: TurnIssuerSettings): boolean {
  return Boolean(settings.multiplayerTurnUrl.trim() && settings.multiplayerTurnSecret);
}

export async function createMultiplayerTurnCredentialRequest(): Promise<PendingMultiplayerTurnRequest> {
  const keyPair = await crypto.subtle.generateKey(ECDH_ALGORITHM, true, ['deriveKey']);
  const request: MultiplayerTurnCredentialRequest = {
    requestId: randomHex(TURN_CREDENTIAL_REQUEST_ID_BYTES),
    publicKey: encodeBase64(await crypto.subtle.exportKey('raw', keyPair.publicKey)),
    createdAt: Date.now()
  };

  return {
    request,
    async decrypt(response) {
      if (response.requestId !== request.requestId) {
        throw new Error('The TURN credential response does not match this request.');
      }
      const hostPublicKey = await crypto.subtle.importKey(
        'raw',
        decodeBase64(response.publicKey),
        ECDH_ALGORITHM,
        false,
        []
      );
      const encryptionKey = await deriveEncryptionKey(keyPair.privateKey, hostPublicKey);
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decodeBase64(response.iv) },
        encryptionKey,
        decodeBase64(response.ciphertext)
      );
      return parseTransientTurnPayload(new TextDecoder().decode(plaintext));
    }
  };
}

export async function createMultiplayerTurnCredentialResponse(
  request: MultiplayerTurnCredentialRequest,
  settings: TurnIssuerSettings,
  subject: string,
  now = Date.now()
): Promise<MultiplayerTurnCredentialResponse> {
  if (!hasMultiplayerTurnIssuer(settings)) {
    throw new Error('This host does not have a TURN credential issuer configured.');
  }
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    decodeBase64(request.publicKey),
    ECDH_ALGORITHM,
    false,
    []
  );
  const keyPair = await crypto.subtle.generateKey(ECDH_ALGORITHM, true, ['deriveKey']);
  const encryptionKey = await deriveEncryptionKey(keyPair.privateKey, clientPublicKey);
  const payload = await createMultiplayerTurnIceSettings(settings, subject, now);
  const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    new TextEncoder().encode(JSON.stringify(payload))
  );

  return {
    requestId: request.requestId,
    publicKey: encodeBase64(await crypto.subtle.exportKey('raw', keyPair.publicKey)),
    iv: encodeBase64(iv),
    ciphertext: encodeBase64(ciphertext),
    createdAt: now
  };
}

export async function createMultiplayerTurnIceSettings(
  settings: TurnIssuerSettings,
  subject: string,
  now = Date.now()
): Promise<TransientTurnPayload> {
  if (!hasMultiplayerTurnIssuer(settings)) {
    return {
      multiplayerTurnUrl: '',
      multiplayerTurnUsername: '',
      multiplayerTurnCredential: '',
      multiplayerForceTurn: false,
      expiresAt: 0
    };
  }
  const expiresAt = Math.floor(now / 1_000) + settings.multiplayerTurnCredentialHours * 60 * 60;
  const username = `${expiresAt}:${sanitizeSubject(subject)}`;
  const secretKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(settings.multiplayerTurnSecret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const credential = encodeBase64(await crypto.subtle.sign(
    'HMAC',
    secretKey,
    new TextEncoder().encode(username)
  ));
  return {
    multiplayerTurnUrl: settings.multiplayerTurnUrl,
    multiplayerTurnUsername: username,
    multiplayerTurnCredential: credential,
    multiplayerForceTurn: settings.multiplayerForceTurn,
    expiresAt: expiresAt * 1_000
  };
}

export function isMultiplayerTurnCredentialRequest(
  value: unknown
): value is MultiplayerTurnCredentialRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<MultiplayerTurnCredentialRequest>;
  return typeof request.requestId === 'string'
    && /^[a-f0-9]{24}$/.test(request.requestId)
    && typeof request.publicKey === 'string'
    && request.publicKey.length >= 80
    && request.publicKey.length <= 128
    && typeof request.createdAt === 'number';
}

export function isMultiplayerTurnCredentialResponse(
  value: unknown
): value is MultiplayerTurnCredentialResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<MultiplayerTurnCredentialResponse>;
  return typeof response.requestId === 'string'
    && /^[a-f0-9]{24}$/.test(response.requestId)
    && typeof response.publicKey === 'string'
    && response.publicKey.length >= 80
    && response.publicKey.length <= 128
    && typeof response.iv === 'string'
    && response.iv.length >= 16
    && response.iv.length <= 32
    && typeof response.ciphertext === 'string'
    && response.ciphertext.length > 0
    && response.ciphertext.length <= 4_096
    && typeof response.createdAt === 'number';
}

async function deriveEncryptionKey(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { ...ECDH_ALGORITHM, public: publicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function parseTransientTurnPayload(json: string): MultiplayerIceSettings {
  const payload = JSON.parse(json) as Partial<TransientTurnPayload>;
  if (typeof payload.multiplayerTurnUrl !== 'string'
    || !/^(?:turn|turns):/i.test(payload.multiplayerTurnUrl)
    || typeof payload.multiplayerTurnUsername !== 'string'
    || payload.multiplayerTurnUsername.length > 256
    || typeof payload.multiplayerTurnCredential !== 'string'
    || payload.multiplayerTurnCredential.length > 512
    || typeof payload.multiplayerForceTurn !== 'boolean'
    || typeof payload.expiresAt !== 'number'
    || payload.expiresAt <= Date.now()) {
    throw new Error('The host supplied invalid or expired TURN credentials.');
  }
  return {
    multiplayerTurnUrl: payload.multiplayerTurnUrl,
    multiplayerTurnUsername: payload.multiplayerTurnUsername,
    multiplayerTurnCredential: payload.multiplayerTurnCredential,
    multiplayerForceTurn: payload.multiplayerForceTurn
  };
}

function sanitizeSubject(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'peer';
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encodeBase64(value: ArrayBuffer | ArrayBufferView): string {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return btoa(String.fromCharCode(...bytes));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
