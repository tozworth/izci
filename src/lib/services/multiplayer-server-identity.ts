/**
 * Browser-local server identity. Replaces Firebase UIDs for pairing:
 * every browser generates one stable random identity, persisted locally,
 * and proves pair ownership over RTC with an HMAC over a versioned
 * context (see multiplayer-server-pairing.ts). The identity never leaves
 * the device except inside multiplayer hello messages.
 */
const IDENTITY_STORAGE_KEY = 'izci.multiplayer-server-identity';

const IDENTITY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidServerIdentity(value: unknown): value is string {
  return typeof value === 'string' && IDENTITY_PATTERN.test(value);
}

function generateIdentity(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

/** Stable per-browser identity, generated once and reused afterwards. */
export function getLocalServerIdentity(): string {
  try {
    const stored = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (isValidServerIdentity(stored)) return stored;
  } catch {
    // Storage unavailable (private mode, disabled): fall through to an
    // ephemeral identity. Pairing proofs still work for this session but
    // are forgotten on reload, which is the safe direction.
  }
  const fresh = generateIdentity();
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, fresh);
  } catch {
    // Ephemeral identity only.
  }
  return fresh;
}
