/**
 * Server host pairing: Pair/Unpair over RTC plus HMAC reconnect proofs.
 * The per-pair secret is exchanged over the encrypted RTC channel when the
 * host chooses Pair; reconnecting guests prove possession (room, both
 * identities, fresh nonces) before remembered reconnect privileges return.
 * Freeplay may activate before pairing once both connected peers opt in.
 *
 * Pairing restores remembered reconnects after invitation admission; it
 * never grants server administration, bypasses admission, or gates Freeplay.
 * Unpair and kick both leave a shared invitation reusable unless it is rotated.
 */
import { logWarning } from '$lib/services/logging';
import {
  findServerPairing,
  forgetServerPairing,
  rememberServerPairing
} from '$lib/stores/multiplayer-server-pairings';
import { getLocalServerIdentity, isValidServerIdentity } from './multiplayer-server-identity';
import {
  createPairSecret,
  verifyPairProof,
  type ServerPairProofContext
} from './multiplayer-server-pairing';
import { sendToPeer } from './multiplayer-peer';
import { sanitizeClientName } from './multiplayer-utils';
import { sendPairingState, syncPeerFreeplayMode } from './multiplayer-host-freeplay';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

function requireServerRoom(ctx: MultiplayerHostContext) {
  const link = ctx.core.serverHost;
  if (!link || ctx.core.state.mode !== 'hosting') throw new Error('No hosted server room.');
  return link;
}

/** Host chose Pair: mint a secret, store it, and send it over RTC. */
export async function pairServerPeer(ctx: MultiplayerHostContext, peer: PeerConnection): Promise<void> {
  const { core } = ctx;
  const link = requireServerRoom(ctx);
  if (!peer.clientIdentity || !peer.helloReceived) {
    throw new Error('Pair after the guest finishes connecting.');
  }
  const secret = createPairSecret();
  rememberServerPairing({
    peerIdentity: peer.clientIdentity,
    label: sanitizeClientName(peer.name) || 'Guest',
    secret,
    endpoint: link.room.endpoint,
    roomId: link.room.roomId,
    invitationSecret: link.room.invitationSecret || null
  });
  peer.paired = true;
  sendToPeer(peer, { kind: 'pair.secret', hostIdentity: getLocalServerIdentity(), secret });
  sendPairingState(ctx, peer);
  core.updateClient(peer.id, { paired: true });
  await syncPeerFreeplayMode(ctx, peer);
}

/** Host chose Unpair: drop privileges now; the shared invite still works. */
export async function unpairServerPeer(ctx: MultiplayerHostContext, peer: PeerConnection): Promise<void> {
  requireServerRoom(ctx);
  if (peer.clientIdentity) forgetServerPairing(peer.clientIdentity);
  peer.paired = false;
  sendPairingState(ctx, peer);
  await syncPeerFreeplayMode(ctx, peer);
}

interface PairProofMessage {
  clientIdentity: string;
  hostNonce: string;
  guestNonce: string;
  proof: string;
}

/** Verify a guest reconnect proof; privileges return only on success. */
export async function verifyServerPairProof(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  message: PairProofMessage
): Promise<void> {
  const { core } = ctx;
  const link = core.serverHost;
  if (!link || core.state.mode !== 'hosting') return;
  if (core.hostPeers.get(peer.id) !== peer) return;
  if (!peer.helloReceived) return;
  // The proof must name the peer that said hello and the fresh nonce from
  // this connection's host hello; anything else is stale or misdirected.
  if (!peer.clientIdentity || message.clientIdentity !== peer.clientIdentity) {
    logWarning('multiplayer', 'Pair proof for an unknown identity', { peerId: peer.id });
    return;
  }
  if (!peer.pairNonce || message.hostNonce !== peer.pairNonce) {
    logWarning('multiplayer', 'Pair proof with a stale nonce', { peerId: peer.id });
    return;
  }
  const record = findServerPairing(message.clientIdentity);
  if (!record) {
    logWarning('multiplayer', 'Pair proof without a stored pair', { peerId: peer.id });
    sendPairingState(ctx, peer);
    return;
  }
  const context: ServerPairProofContext = {
    roomId: link.room.roomId,
    hostIdentity: getLocalServerIdentity(),
    clientIdentity: message.clientIdentity,
    hostNonce: message.hostNonce,
    guestNonce: message.guestNonce
  };
  const verified = await verifyPairProof(record.secret, context, message.proof);
  if (!verified) {
    logWarning('multiplayer', 'Pair proof verification failed', { peerId: peer.id });
    return;
  }
  peer.paired = true;
  peer.name = sanitizeClientName(record.label) || peer.name;
  core.updateClient(peer.id, { name: peer.name, paired: true });
  sendPairingState(ctx, peer);
  await syncPeerFreeplayMode(ctx, peer);
}

/** Broadcast a rotated invitation to currently paired peers. */
export function broadcastServerInvitation(ctx: MultiplayerHostContext, secret: string): void {
  const { core } = ctx;
  const link = core.serverHost;
  if (!link || core.state.mode !== 'hosting') return;
  for (const peer of core.hostPeers.values()) {
    if (!peer.paired || peer.channel?.readyState !== 'open') continue;
    sendToPeer(peer, { kind: 'invitation', roomId: link.room.roomId, secret });
  }
}

export function isServerPairIdentity(value: unknown): value is string {
  return isValidServerIdentity(value);
}
