/**
 * Sidekick pairing proofs. When the host chooses Pair, a random per-pair
 * secret travels over the (encrypted) RTC channel and both sides store it
 * in the sidekick pairings namespace. On reconnect the guest proves
 * possession with HMAC-SHA-256 over a versioned context binding the room
 * and both browser-local identities plus fresh nonces from both peers.
 *
 * Fresh nonces defeat replay (an old proof names a stale host nonce) and
 * the bound identities defeat wrong-peer reuse. Until hello and proof
 * finish, paired privileges stay disabled host-side.
 */
import { createSidekickNonce } from './multiplayer-sidekick-protocol';
import { isValidSidekickIdentity } from './multiplayer-sidekick-identity';

export const SIDEKICK_PAIR_PROOF_VERSION = 'izci-pair-v1';

export interface SidekickPairProofContext {
  roomId: string;
  hostIdentity: string;
  clientIdentity: string;
  hostNonce: string;
  guestNonce: string;
}

export function createPairSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isValidPairSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

export function createPairNonce(): string {
  return createSidekickNonce();
}

function isValidNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export function isValidPairProofContext(value: unknown): value is SidekickPairProofContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<SidekickPairProofContext>;
  return typeof context.roomId === 'string'
    && /^[0-9a-f]{32}$/.test(context.roomId)
    && isValidSidekickIdentity(context.hostIdentity)
    && isValidSidekickIdentity(context.clientIdentity)
    && isValidNonce(context.hostNonce)
    && isValidNonce(context.guestNonce)
    && context.hostIdentity !== context.clientIdentity;
}

function proofInput(context: SidekickPairProofContext): string {
  return [
    SIDEKICK_PAIR_PROOF_VERSION,
    context.roomId,
    context.hostIdentity,
    context.clientIdentity,
    context.hostNonce,
    context.guestNonce
  ].join('|');
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA-256 proof (hex) for a validated context. */
export async function computePairProof(
  secretHex: string,
  context: SidekickPairProofContext
): Promise<string> {
  if (!isValidPairSecret(secretHex)) throw new Error('Invalid pair secret.');
  if (!isValidPairProofContext(context)) throw new Error('Invalid pair proof context.');
  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(proofInput(context))
  );
  return bytesToHex(signature);
}

/**
 * Verify a presented proof. Returns false (never throws) for malformed
 * contexts, malformed proofs, or mismatches, so callers keep privileges
 * disabled on any failure.
 */
export async function verifyPairProof(
  secretHex: string,
  context: unknown,
  proofHex: unknown
): Promise<boolean> {
  try {
    if (!isValidPairSecret(secretHex)) return false;
    if (!isValidPairProofContext(context)) return false;
    if (typeof proofHex !== 'string' || !/^[0-9a-f]{64}$/.test(proofHex)) return false;
    const expected = await computePairProof(secretHex, context);
    if (expected.length !== proofHex.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) {
      diff |= expected.charCodeAt(i) ^ proofHex.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}
