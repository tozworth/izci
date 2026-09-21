import { beforeEach, describe, expect, it } from 'vitest';
import {
  computePairProof,
  createPairNonce,
  createPairSecret,
  isValidPairProofContext,
  isValidPairSecret,
  verifyPairProof,
  type ServerPairProofContext
} from './multiplayer-server-pairing';
import {
  findServerPairing,
  forgetServerPairing,
  rememberServerPairing,
  setServerPairingInvitationByRoom,
  serverPairings
} from '$lib/stores/multiplayer-server-pairings';

const ROOM = 'd'.repeat(32);
const HOST = 'host-identity-01';
const CLIENT = 'client-identity-02';

function context(overrides: Partial<ServerPairProofContext> = {}): ServerPairProofContext {
  return {
    roomId: ROOM,
    hostIdentity: HOST,
    clientIdentity: CLIENT,
    hostNonce: 'host-nonce-001',
    guestNonce: 'guest-nonce-002',
    ...overrides
  };
}

describe('server pair secrets', () => {
  it('mints 32-byte hex secrets', () => {
    const secret = createPairSecret();
    expect(isValidPairSecret(secret)).toBe(true);
    expect(createPairSecret()).not.toBe(secret);
    expect(isValidPairSecret('short')).toBe(false);
    expect(isValidPairSecret('x'.repeat(64))).toBe(false);
  });

  it('mints nonces in the server alphabet', () => {
    expect(createPairNonce()).toMatch(/^[A-Za-z0-9_-]{16}$/);
  });
});

describe('server pair proofs', () => {
  it('round-trips a valid proof', async () => {
    const secret = createPairSecret();
    const proof = await computePairProof(secret, context());
    expect(await verifyPairProof(secret, context(), proof)).toBe(true);
  });

  it('rejects replay with a stale host nonce', async () => {
    const secret = createPairSecret();
    const proof = await computePairProof(secret, context());
    // The host rotates its nonce every connection; an old proof names the
    // previous nonce and must not verify against the fresh context.
    await expect(verifyPairProof(secret, context({ hostNonce: 'host-nonce-999' }), proof)).resolves.toBe(false);
  });

  it('rejects wrong-peer and wrong-room proofs', async () => {
    const secret = createPairSecret();
    const proof = await computePairProof(secret, context());
    await expect(verifyPairProof(secret, context({ clientIdentity: 'someone-else-03' }), proof)).resolves.toBe(false);
    await expect(verifyPairProof(secret, context({ hostIdentity: 'other-host-ident-9' }), proof)).resolves.toBe(false);
    await expect(verifyPairProof(secret, context({ roomId: 'e'.repeat(32) }), proof)).resolves.toBe(false);
  });

  it('rejects tampered proofs and wrong secrets without throwing', async () => {
    const secret = createPairSecret();
    const proof = await computePairProof(secret, context());
    const tampered = proof.slice(0, 63) + (proof[63] === '0' ? '1' : '0');
    await expect(verifyPairProof(secret, context(), tampered)).resolves.toBe(false);
    await expect(verifyPairProof(createPairSecret(), context(), proof)).resolves.toBe(false);
    await expect(verifyPairProof(secret, context(), 'not-hex')).resolves.toBe(false);
    await expect(verifyPairProof('short', context(), proof)).resolves.toBe(false);
    await expect(verifyPairProof(secret, null, proof)).resolves.toBe(false);
    await expect(verifyPairProof(secret, context(), null)).resolves.toBe(false);
  });

  it('rejects degenerate contexts', () => {
    expect(isValidPairProofContext(context())).toBe(true);
    expect(isValidPairProofContext(context({ hostIdentity: CLIENT, clientIdentity: CLIENT }))).toBe(false);
    expect(isValidPairProofContext(context({ roomId: 'short' }))).toBe(false);
    expect(isValidPairProofContext(context({ hostNonce: 'x' }))).toBe(false);
    expect(isValidPairProofContext(null)).toBe(false);
  });
});

describe('server pairings store', () => {
  beforeEach(() => {
    serverPairings.set([]);
  });

  function record() {
    return {
      peerIdentity: HOST,
      label: 'Friday Host',
      secret: createPairSecret(),
      endpoint: 'https://server.example.com/party',
      roomId: ROOM,
      invitationSecret: 'invite-1'
    };
  }

  it('remembers, finds, and forgets pairs', () => {
    rememberServerPairing(record());
    expect(findServerPairing(HOST)?.label).toBe('Friday Host');
    setServerPairingInvitationByRoom('https://server.example.com/party', ROOM, 'invite-2');
    expect(findServerPairing(HOST)?.invitationSecret).toBe('invite-2');
    forgetServerPairing(HOST);
    expect(findServerPairing(HOST)).toBeNull();
  });

  it('drops malformed records and keeps the namespace separate', () => {
    serverPairings.set([
      { ...record(), secret: 'bad' },
      { ...record(), peerIdentity: 'x' },
      { ...record(), roomId: 'not-hex' },
      { ...record(), endpoint: 'ftp://server.example.com' },
      record()
    ] as never);
    const snapshot = serverPairings.getSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].peerIdentity).toBe(HOST);
  });

  it('ignores invalid remember calls', () => {
    rememberServerPairing({ ...record(), peerIdentity: 'bad id!' });
    rememberServerPairing({ ...record(), peerIdentity: 'other-identity-1', secret: 'bad' });
    expect(serverPairings.getSnapshot()).toHaveLength(0);
  });
});
