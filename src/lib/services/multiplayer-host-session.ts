import { logInfo } from './logging';
import { clearMultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { clearPeerConnectionTimer, disposePeerConnection, sendToPeer } from './multiplayer-peer';
import { errorMessage } from './multiplayer-utils';
import type { MultiplayerHostContext } from './multiplayer-host';
import { announceHostPeerLeave } from './multiplayer-host-channels';
import { pairServerPeer, unpairServerPeer } from './multiplayer-server-host-pairing';
import { removePeerFromHostPlaybackPreparation } from './multiplayer-host-playback-prep';

export async function togglePairing(ctx: MultiplayerHostContext, clientId: string): Promise<void> {
  const { core } = ctx;
  if (core.state.mode !== 'hosting') return;
  if (core.serverHost) {
    const peer = core.hostPeers.get(clientId);
    if (!peer || !peer.helloReceived) return;
    try {
      if (core.state.clients.find((candidate) => candidate.id === clientId)?.paired) {
        await unpairServerPeer(ctx, peer);
      } else {
        await pairServerPeer(ctx, peer);
      }
    } catch (error) {
      core.publish({
        message: errorMessage(error, 'Could not change pairing for that guest.')
      });
    }
  }
}

export async function kick(ctx: MultiplayerHostContext, clientId: string): Promise<void> {
  const { core } = ctx;
  if (core.state.mode !== 'hosting') return;
  logInfo('multiplayer', 'Client kick requested', { clientId });
  const peer = core.hostPeers.get(clientId);
  if (peer) {
    clearPeerConnectionTimer(peer);
    announceHostPeerLeave(ctx, peer);
    sendToPeer(peer, { kind: 'kicked' });
    window.setTimeout(() => disposePeerConnection(peer), 80);
    core.freeplaySelections.delete(clientId);
    core.hostPeers.delete(clientId);
    removePeerFromHostPlaybackPreparation(ctx, clientId);
  }
  core.publish({ clients: core.state.clients.filter((client) => client.id !== clientId) });
  // Server kicks also release the server reservation so the slot frees
  // immediately; the shared invitation stays reusable until rotated.
  const serverAttempt = (peer as { serverAttemptId?: string } | undefined)?.serverAttemptId;
  if (core.serverHost && serverAttempt) {
    try {
      core.serverHost.release(serverAttempt);
    } catch {
      // Expiry reaps the slot server-side.
    }
  }

}

export async function stopHosting(ctx: MultiplayerHostContext): Promise<void> {
  const { core } = ctx;
  if (core.state.mode !== 'hosting') return;
  logInfo('multiplayer', 'Hosting stopped');
  clearMultiplayerLastSession();
  core.allowClientReconnect = false;
  await core.resetSession(true);
  core.publish({
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostMotd: '',
    hostVersion: null,
    hostImplementation: null,
    hostProtocol: null,
    freeplay: false,
    clients: [],
    audioStatus: 'idle',
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    connectionStats: null,
    connectionDetail: null,
    message: null
  });
}
