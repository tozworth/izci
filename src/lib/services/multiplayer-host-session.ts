import { logError, logInfo, logWarning } from '$lib/services/logging';
import {
  clearMultiplayerLastSession,
  rememberMultiplayerLastSession
} from '$lib/stores/multiplayer-last-session';
import { enableOpusStereo } from './multiplayer-opus';
import {
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR
} from './multiplayer-protocol';
import { multiplayerChat } from './multiplayer-chat';
import {
  applyAudioBitrate,
  clearPeerConnectionTimer,
  createPeer,
  disposePeerConnection,
  describeIceFailure,
  prepareCandidatePublisher,
  preferOpus,
  sendToPeer,
  stageRemoteCandidates,
  startPeerConnectionTimer
} from './multiplayer-peer';
import {
  createInviteCode,
  isNewSignalOfferForPeer,
  isSignalOffer,
  loadFirebase
} from './multiplayer-signaling';
import {
  createMultiplayerTurnCredentialResponse,
  createMultiplayerTurnIceSettings,
  hasMultiplayerTurnIssuer,
  isMultiplayerTurnCredentialRequest,
  type MultiplayerTurnCredentialRequest
} from './multiplayer-turn-credentials';
import {
  errorMessage,
  getLocalName,
  sanitizeClientName,
  sanitizePlatform
} from './multiplayer-utils';
import type {
  PairedClientRecord,
  SignalAnswer,
  SignalCandidates,
  SignalOffer,
  SignalPeerRecord
} from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';
import {
  attachHostChannel,
  attachHostMediaChannel,
  attachHostRenderChannel,
  announceHostPeerLeave
} from './multiplayer-host-channels';
import { syncPeerFreeplayMode } from './multiplayer-host-freeplay';
import { removePeerFromHostPlaybackPreparation } from './multiplayer-host-playback-prep';
import { primeHostState } from './multiplayer-host-sync';

export async function startHosting(
  ctx: MultiplayerHostContext,
  options: { silent?: boolean } = {}
): Promise<string> {
  const { core } = ctx;
  const silent = options.silent === true;
  logInfo('multiplayer', 'Hosting requested', {
    maxListeners: core.multiplayerSettings.multiplayerMaxListeners
  });
  core.allowClientReconnect = false;
  await core.resetSession(true);
  multiplayerChat.restorePersistedHistory(core.multiplayerSettings.multiplayerChatHistoryLines);
  core.publish({
    mode: 'hosting',
    connectionStatus: 'connecting',
    hostName: getLocalName(),
    freeplay: false,
    audioStatus: 'idle',
    connectionDetail: 'Creating a Firebase signaling room...',
    message: null
  });

  try {
    const firebase = await loadFirebase();
    core.publish({ connectionDetail: 'Publishing the multiplayer room...' });
    const inviteCode = createInviteCode();
    const nextRoomRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}`);
    core.firebaseRuntime = firebase;
    core.roomRef = nextRoomRef;
    core.roomCode = inviteCode;
    const nextHostDirectoryRef = firebase.ref(
      firebase.database,
      `multiplayer/hosts/${firebase.uid}/directory`
    );
    core.hostDirectoryRef = nextHostDirectoryRef;
    await firebase.set(nextRoomRef, {
      meta: {
        hostUid: firebase.uid,
        protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
        protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
        hostName: getLocalName(),
        turnRelay: hasMultiplayerTurnIssuer(core.multiplayerSettings),
        createdAt: Date.now()
      }
    });
    const disconnect = firebase.onDisconnect(nextRoomRef);
    await disconnect.remove();
    await firebase.set(nextHostDirectoryRef, {
      currentRoom: inviteCode,
      hostName: getLocalName(),
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      updatedAt: Date.now()
    });
    const directoryDisconnect = firebase.onDisconnect(nextHostDirectoryRef);
    await directoryDisconnect.remove();

    core.roomDisconnect = disconnect;
    core.hostDirectoryDisconnect = directoryDisconnect;
    core.stopPeersListener = firebase.onValue(
      firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/peers`),
      (snapshot) => {
        const peers = snapshot.val() as Record<string, SignalPeerRecord> | null;
        const liveIds = new Set(
          Object.entries(peers ?? {})
            .filter(([, peerSignal]) => isSignalOffer(peerSignal.client))
            .map(([id]) => id)
        );
        for (const [id, peer] of core.hostPeers) {
          if (!liveIds.has(id)) {
            announceHostPeerLeave(ctx, peer);
            disposePeerConnection(peer);
            core.hostPeers.delete(id);
            core.freeplaySelections.delete(id);
            removePeerFromHostPlaybackPreparation(ctx, id);
            core.publish({ clients: core.state.clients.filter((client) => client.id !== id) });
          }
        }
        for (const [id, peerSignal] of Object.entries(peers ?? {})) {
          if (isMultiplayerTurnCredentialRequest(peerSignal.credentialRequest)
            && !core.answeredTurnCredentialRequestIds.has(peerSignal.credentialRequest.requestId)) {
            void answerTurnCredentialRequest(ctx, inviteCode, id, peerSignal.credentialRequest);
          }
          const peer = core.hostPeers.get(id);
          if (isNewSignalOfferForPeer(peerSignal.client, peer?.signalingCreatedAt ?? null)
            && !core.acceptingPeerIds.has(id)
          ) {
            core.acceptingPeerIds.add(id);
            void acceptClientOffer(
              ctx,
              inviteCode,
              id,
              peerSignal.client,
              peerSignal.clientCandidates ?? {}
            ).finally(() => core.acceptingPeerIds.delete(id));
          } else {
            if (peer) stageRemoteCandidates(peer, peerSignal.clientCandidates ?? {});
          }
        }
      }
    );

    core.publish({
      mode: 'hosting',
      connectionStatus: 'connected',
      inviteCode: silent ? null : inviteCode,
      connectionDetail: null
    });
    logInfo('multiplayer', 'Hosting started', {
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      turnRelay: hasMultiplayerTurnIssuer(core.multiplayerSettings)
    });
    rememberMultiplayerLastSession('hosting', { hostName: getLocalName() });
    primeHostState(ctx);
    return inviteCode;
  } catch (error) {
    logError('multiplayer', 'Hosting failed', error);
    await core.resetSession(true);
    const message = errorMessage(error, 'Could not start multiplayer hosting.');
    core.publish({
      mode: 'idle',
      connectionStatus: 'error',
      hostName: null,
      hostMotd: '',
      hostVersion: null,
      hostImplementation: null,
      hostProtocol: null,
      freeplay: false,
      connectionDetail: message,
      message
    });
    throw new Error(message);
  }
}

async function answerTurnCredentialRequest(
  ctx: MultiplayerHostContext,
  inviteCode: string,
  clientId: string,
  request: MultiplayerTurnCredentialRequest
): Promise<void> {
  const { core } = ctx;
  if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
  core.answeredTurnCredentialRequestIds.add(request.requestId);
  try {
    const response = await createMultiplayerTurnCredentialResponse(
      request,
      core.multiplayerSettings,
      clientId
    );
    if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
    await core.firebaseRuntime.set(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/rooms/${inviteCode}/peers/${clientId}/credentialResponse`
    ), response);
  } catch (error) {
    core.answeredTurnCredentialRequestIds.delete(request.requestId);
    core.publish({
      message: `Could not issue temporary TURN credentials: ${errorMessage(error, 'credential exchange failed')}`
    });
  }
}

async function acceptClientOffer(
  ctx: MultiplayerHostContext,
  inviteCode: string,
  id: string,
  offer: SignalOffer,
  candidates: SignalCandidates
): Promise<void> {
  const { core } = ctx;
  if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
  const previousPeer = core.hostPeers.get(id);
  if (!previousPeer && core.hostPeers.size >= core.multiplayerSettings.multiplayerMaxListeners) {
    if (!core.rejectedPeerIds.has(id)) {
      core.rejectedPeerIds.add(id);
      await core.firebaseRuntime.set(
        core.firebaseRuntime.ref(
          core.firebaseRuntime.database,
          `multiplayer/rooms/${inviteCode}/peers/${id}/host`
        ),
        { error: 'host-full', createdAt: offer.createdAt } satisfies SignalAnswer
      );
      window.setTimeout(() => {
        core.rejectedPeerIds.delete(id);
        if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
        void core.firebaseRuntime.remove(core.firebaseRuntime.ref(
          core.firebaseRuntime.database,
          `multiplayer/rooms/${inviteCode}/peers/${id}`
        ));
      }, 5_000);
    }
    return;
  }
  if (previousPeer) {
    announceHostPeerLeave(ctx, previousPeer);
    disposePeerConnection(previousPeer);
    removePeerFromHostPlaybackPreparation(ctx, id);
    core.hostPeers.delete(id);
  }
  await Promise.all([
    core.firebaseRuntime.remove(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/rooms/${inviteCode}/peers/${id}/host`
    )),
    core.firebaseRuntime.remove(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/rooms/${inviteCode}/peers/${id}/hostCandidates`
    ))
  ]).catch((error) => {
    logWarning('multiplayer', 'Stale host signaling cleanup failed', { peerId: id, error });
  });
  const peer = createPeer(
    id,
    sanitizeClientName(offer.name),
    await createMultiplayerTurnIceSettings(core.multiplayerSettings, `host-${id}`)
  );
  peer.signalingCreatedAt = offer.createdAt;
  core.hostPeers.set(id, peer);
  void core.firebaseRuntime.remove(core.firebaseRuntime.ref(
    core.firebaseRuntime.database,
    `multiplayer/rooms/${inviteCode}/peers/${id}/credentialResponse`
  ));
  const pairingSnapshot = await core.firebaseRuntime.get(core.firebaseRuntime.ref(
    core.firebaseRuntime.database,
    `multiplayer/hosts/${core.firebaseRuntime.uid}/paired/${id}`
  ));
  peer.paired = pairingSnapshot.exists();
  core.updateClient(id, {
    name: peer.name,
    platform: sanitizePlatform(offer.platform),
    status: 'connecting',
    paired: peer.paired,
    freeplay: false
  });

  peer.pc.ondatachannel = (event) => {
    if (event.channel.label === 'izci-media') attachHostMediaChannel(ctx, peer, event.channel);
    else if (event.channel.label === 'izci-render') attachHostRenderChannel(ctx, peer, event.channel);
    else attachHostChannel(ctx, peer, event.channel);
  };
  peer.pc.onconnectionstatechange = () => {
    if (core.hostPeers.get(id) !== peer) return;
    const status = peer.pc.connectionState;
    if (status === 'connected') {
      clearPeerConnectionTimer(peer);
      core.updateClient(id, { status: 'connected' });
      core.publish({ message: null });
    }
    if (status === 'failed' || status === 'disconnected' || status === 'closed') {
      core.updateClient(id, { status: 'disconnected' });
      removePeerFromHostPlaybackPreparation(ctx, id);
    }
    if (status === 'failed' || status === 'closed') announceHostPeerLeave(ctx, peer);
    if (status === 'failed') core.publish({ message: describeIceFailure(peer, peer.name) });
  };

  try {
    await peer.pc.setRemoteDescription(offer.description);
    stageRemoteCandidates(peer, candidates);
    const audioTransceiver = peer.pc.getTransceivers().find(
      (transceiver) => transceiver.receiver.track.kind === 'audio'
    );
    if (audioTransceiver) {
      preferOpus(audioTransceiver);
      audioTransceiver.direction = 'sendonly';
      peer.audioSender = audioTransceiver.sender;
      await peer.audioSender.replaceTrack(null);
    }
    const answer = enableOpusStereo(await peer.pc.createAnswer());
    const answerPath = `multiplayer/rooms/${inviteCode}/peers/${id}/host`;
    const startCandidatePublishing = prepareCandidatePublisher(
      peer,
      (candidate, index) => {
        const firebase = core.firebaseRuntime;
        if (!firebase) return;
        const candidateId = `c${String(index).padStart(3, '0')}`;
        return firebase.set(
          firebase.ref(firebase.database, `${answerPath}Candidates/${candidateId}`),
          candidate
        );
      },
      () => {
        clearPeerConnectionTimer(peer);
        core.publish({
          message: `Could not send ICE candidates for ${peer.name}. The deployed Firebase rules may be out of date.`
        });
      }
    );
    await peer.pc.setLocalDescription(answer);
    await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
    if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
    await core.firebaseRuntime.set(
      core.firebaseRuntime.ref(core.firebaseRuntime.database, answerPath),
      { description: peer.pc.localDescription?.toJSON(), createdAt: offer.createdAt }
    );
    startCandidatePublishing();
    startPeerConnectionTimer(peer, () => {
      if (peer.pc.connectionState === 'connected' || core.state.mode !== 'hosting') return;
      core.updateClient(id, { status: 'disconnected' });
      core.publish({ message: describeIceFailure(peer, peer.name) });
    });
  } catch (error) {
    disposePeerConnection(peer);
    core.hostPeers.delete(id);
    core.updateClient(id, { status: 'disconnected' });
    core.publish({
      message: `Could not finish the connection to ${peer.name}: ${errorMessage(error, 'ICE signaling failed.')}`
    });
  }
}

export async function togglePairing(ctx: MultiplayerHostContext, clientId: string): Promise<void> {
  const { core } = ctx;
  if (core.state.mode !== 'hosting') return;
  if (core.serverHost) {
    const peer = core.hostPeers.get(clientId);
    if (!peer || !peer.helloReceived) return;
    const pairing = await import('./multiplayer-server-host-pairing');
    try {
      if (core.state.clients.find((candidate) => candidate.id === clientId)?.paired) {
        await pairing.unpairServerPeer(ctx, peer);
      } else {
        await pairing.pairServerPeer(ctx, peer);
      }
    } catch (error) {
      core.publish({
        message: errorMessage(error, 'Could not change pairing for that guest.')
      });
    }
    return;
  }
  if (!core.firebaseRuntime) return;
  const client = core.state.clients.find((candidate) => candidate.id === clientId);
  const peer = core.hostPeers.get(clientId);
  if (!client || !peer) return;

  const pairingRef = core.firebaseRuntime.ref(
    core.firebaseRuntime.database,
    `multiplayer/hosts/${core.firebaseRuntime.uid}/paired/${clientId}`
  );
  const paired = !client.paired;
  if (paired) {
    await core.firebaseRuntime.set(pairingRef, {
      name: client.name,
      platform: client.platform,
      pairedAt: Date.now()
    } satisfies PairedClientRecord);
  } else {
    await core.firebaseRuntime.remove(pairingRef);
  }
  peer.paired = paired;
  await syncPeerFreeplayMode(ctx, peer);
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
  const roomCode = core.roomCode ?? core.state.inviteCode;
  if (core.firebaseRuntime && roomCode) {
    await core.firebaseRuntime.remove(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/rooms/${roomCode}/peers/${clientId}`
    ));
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
