import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import type { MultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import {
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import { multiplayerAudioService } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import {
  clearPeerConnectionTimer,
  createPeer,
  describeIceFailure,
  flushRemoteCandidates,
  preferOpus,
  prepareCandidatePublisher,
  sendToPeer,
  stageRemoteCandidates,
  startPeerConnectionTimer
} from './multiplayer-peer';
import {
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR,
  isCompatibleHelloIdentity
} from './multiplayer-protocol';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import {
  createDirectIceSettings,
  isSignalAnswerForOffer,
  loadFirebase,
  normalizeInviteCode,
  requestTemporaryTurnCredentials
} from './multiplayer-signaling';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import {
  EMPTY_CATALOG,
  EMPTY_DELIVERY,
  EMPTY_REMOTE_PLAYBACK,
  type SignalAnswer,
  type SignalCandidates
} from './multiplayer-types';
import {
  errorMessage,
  getClientPlatform,
  getLocalName,
  sanitizeClientName
} from './multiplayer-utils';
import type { MultiplayerClientContext } from './multiplayer-client';
import { attachClientChannel } from './multiplayer-client-channels';
import {
  attachClientMediaChannel,
  attachClientRenderChannel
} from './multiplayer-client-audio';
import { updateLocalTimelineMode } from './multiplayer-client-freeplay';
import {
  clearReconnectTimer,
  scheduleClientReconnect
} from './multiplayer-client-lifecycle';

const SIGNALING_TIMEOUT_MS = 8_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}

export async function join(
  ctx: MultiplayerClientContext,
  rawInviteCode: string,
  options: { silent?: boolean; preserveHostId?: boolean } = {}
): Promise<void> {
  const { core } = ctx;
  logInfo('multiplayer', 'Join requested', { paired: false });
  if (core.state.receiveAudio) void multiplayerAudioService.warmRemoteAudio();
  core.allowClientReconnect = true;
  core.reconnectAttempts = 0;
  if (!options.preserveHostId) core.clientHostId = null;
  multiplayerSourcePlaybackService.beginClientSession((trackId, generationId) => {
    if (!core.clientPeer || core.state.mode !== 'client'
      || !ctx.transition.isCurrent(generationId, trackId, 'source-file')) return;
    if (core.state.freeplay && core.state.remoteCatalog.repeatMode === 'one') {
      multiplayerSourcePlaybackService.replay();
      return;
    }
    if (core.state.freeplay || core.state.hostImplementation?.product === 'izci-server') {
      sendToPeer(core.clientPeer, { kind: 'playback.ended', generationId, trackId });
    }
  });
  multiplayerSourcePlaybackService.setEnabled(core.state.receiveAudio);
  try {
    await ctx.connectClient(rawInviteCode, false, options.silent === true);
    if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(ctx, 15_000);
  } catch (error) {
    logError('multiplayer', 'Join failed', error);
    if (!options.silent) await multiplayerSourcePlaybackService.endClientSession();
    throw error;
  }
}

export async function joinPaired(ctx: MultiplayerClientContext, hostId: string): Promise<void> {
  const { core } = ctx;
  logInfo('multiplayer', 'Paired-host join requested', { hostId });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) {
    throw new Error('That paired multiplayer host is invalid.');
  }
  const firebase = await withTimeout(
    loadFirebase(),
    SIGNALING_TIMEOUT_MS,
    'Firebase sign-in timed out while finding the paired host.'
  );
  const directory = (await withTimeout(
    firebase.get(firebase.ref(firebase.database, `multiplayer/hosts/${hostId}/directory`)),
    SIGNALING_TIMEOUT_MS,
    'The paired-host directory lookup timed out.'
  )).val() as {
    currentRoom?: string;
    hostName?: string;
    protocolMajor?: number;
    protocolMinor?: number;
    capabilities?: string[];
  } | null;
  if (!directory
    || !isCompatibleHelloIdentity({
      protocolMajor: directory.protocolMajor,
      capabilities: directory.capabilities ?? []
    })
    || !normalizeInviteCode(directory.currentRoom ?? '')) {
    throw new Error('That paired host is not currently hosting.');
  }
  rememberMultiplayerPairing(
    hostId,
    sanitizeClientName(directory.hostName ?? 'Host')
  );
  core.clientHostId = hostId;
  await join(ctx, directory.currentRoom!, { preserveHostId: true });
}

export async function resolveDirectoryRoomCode(
  ctx: MultiplayerClientContext,
  hostId: string
): Promise<string | null> {
  const { core } = ctx;
  try {
    const firebase = core.firebaseRuntime ?? await withTimeout(
      loadFirebase(),
      SIGNALING_TIMEOUT_MS,
      'Firebase sign-in timed out while restoring the paired host.'
    );
    const directory = (await withTimeout(
      firebase.get(firebase.ref(firebase.database, `multiplayer/hosts/${hostId}/directory`)),
      SIGNALING_TIMEOUT_MS,
      'The paired-host directory lookup timed out.'
    )).val() as { currentRoom?: string; protocolMajor?: number; capabilities?: string[] } | null;
    return directory
      && isCompatibleHelloIdentity({
        protocolMajor: directory.protocolMajor,
        capabilities: directory.capabilities ?? []
      })
      ? normalizeInviteCode(directory.currentRoom ?? '')
      : null;
  } catch (error) {
    logWarning('multiplayer', 'Paired-host directory lookup failed', { hostId, error });
    return null;
  }
}

export async function restoreClientJoin(
  ctx: MultiplayerClientContext,
  last: MultiplayerLastSession
): Promise<void> {
  const { core } = ctx;
  core.clientHostId = last.hostId;
  core.publish({
    mode: 'client',
    connectionStatus: 'connecting',
    reconnecting: true,
    inviteCode: last.inviteCode,
    hostName: last.hostName,
    audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
    connectionDetail: 'Finding the paired host session...',
    message: 'Reconnecting to the host...'
  });
  const inviteCode = last.hostId ? await resolveDirectoryRoomCode(ctx, last.hostId) : null;
  const target = inviteCode ?? last.inviteCode;
  if (!target) throw new Error('No multiplayer session to restore.');
  try {
    await join(ctx, target, { silent: true, preserveHostId: true });
  } catch {
    core.allowClientReconnect = true;
    core.publish({
      mode: 'client',
      inviteCode: target,
      hostName: last.hostName,
      connectionStatus: 'disconnected',
      reconnecting: true,
      message: 'Reconnecting to the host...'
    });
    scheduleClientReconnect(ctx);
  }
}

export async function connectClient(
  ctx: MultiplayerClientContext,
  rawInviteCode: string,
  reconnecting: boolean,
  silent = false
): Promise<void> {
  const { core, transition } = ctx;
  clearReconnectTimer(ctx);
  await core.resetSession(true);
  const inviteCode = normalizeInviteCode(rawInviteCode);
  if (!inviteCode) {
    const error = new Error('Enter a valid multiplayer invite code.');
    core.publish({ connectionStatus: 'error', message: error.message });
    throw error;
  }

  core.publish({
    mode: 'client',
    connectionStatus: 'connecting',
    reconnecting,
    inviteCode,
    hostName: null,
    hostVersion: null,
    hostImplementation: null,
    hostProtocol: null,
    freeplay: reconnecting ? core.state.freeplay : false,
    freeplayQueue: reconnecting ? core.state.freeplayQueue : [],
    remoteCatalog: reconnecting ? core.state.remoteCatalog : EMPTY_CATALOG,
    remotePlayback: reconnecting ? core.state.remotePlayback : EMPTY_REMOTE_PLAYBACK,
    remoteArtwork: reconnecting ? core.state.remoteArtwork : null,
    remoteArtworkResolvedTrackKey: reconnecting ? core.state.remoteArtworkResolvedTrackKey : '',
    remoteOdaBackground: reconnecting ? core.state.remoteOdaBackground : null,
    remoteDelivery: reconnecting ? core.state.remoteDelivery : { ...EMPTY_DELIVERY },
    audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    connectionStats: null,
    connectionDetail: 'Signing in to multiplayer signaling...',
    message: null
  });
  updateLocalTimelineMode(ctx);
  logInfo(
    'multiplayer',
    reconnecting ? 'Reconnect attempt started' : 'Client connection started',
    {
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      receiveAudio: core.state.receiveAudio
    }
  );

  try {
    const firebase = await withTimeout(
      loadFirebase(),
      SIGNALING_TIMEOUT_MS,
      'Firebase sign-in timed out.'
    );
    core.firebaseRuntime = firebase;
    core.publish({ connectionDetail: 'Looking up the multiplayer session...' });
    const metaRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/meta`);
    const meta = (await withTimeout(
      firebase.get(metaRef),
      SIGNALING_TIMEOUT_MS,
      'The multiplayer room lookup timed out.'
    )).val() as {
      protocolMajor?: number;
      protocolMinor?: number;
      capabilities?: string[];
      hostName?: string;
      turnRelay?: boolean;
    } | null;
    if (!meta
      || !isCompatibleHelloIdentity({
        protocolMajor: meta.protocolMajor,
        capabilities: meta.capabilities ?? []
      })) {
      throw new Error('That multiplayer session is unavailable or incompatible.');
    }
    core.publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });
    const turnSettings = meta.turnRelay
      ? await withTimeout(
          requestTemporaryTurnCredentials(firebase, inviteCode),
          SIGNALING_TIMEOUT_MS,
          'TURN credential exchange timed out.'
        )
      : createDirectIceSettings();
    core.publish({ connectionDetail: meta.turnRelay
      ? 'Preparing a peer connection with TURN fallback...'
      : 'Preparing a direct peer connection...' });

    const peer = createPeer(firebase.uid, getLocalName(), turnSettings);
    const audioTransceiver = peer.pc.addTransceiver('audio', { direction: 'recvonly' });
    preferOpus(audioTransceiver);
    setMultiplayerReceiverBuffer(
      audioTransceiver.receiver,
      core.multiplayerSettings.multiplayerAudioBufferMs
    );
    const channel = peer.pc.createDataChannel('izci-control', { ordered: true });
    peer.channel = channel;
    const mediaChannel = peer.pc.createDataChannel('izci-media', { ordered: true });
    mediaChannel.binaryType = 'arraybuffer';
    peer.mediaChannel = mediaChannel;
    const renderChannel = peer.pc.createDataChannel('izci-render', { ordered: false });
    renderChannel.binaryType = 'arraybuffer';
    peer.renderChannel = renderChannel;
    core.clientPeer = peer;
    transition.reset();
    transition.setReceiveAudio(core.state.receiveAudio);
    attachClientChannel(ctx, peer);
    attachClientMediaChannel(ctx, peer);
    attachClientRenderChannel(ctx, peer);

    const nextPeerRef = firebase.ref(
      firebase.database,
      `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}`
    );
    const clientSignalRef = firebase.ref(
      firebase.database,
      `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/client`
    );
    const clientCandidatesRef = firebase.ref(
      firebase.database,
      `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/clientCandidates`
    );
    const disconnect = firebase.onDisconnect(clientSignalRef);
    await withTimeout(
      disconnect.remove(),
      SIGNALING_TIMEOUT_MS,
      'Registering signaling cleanup timed out.'
    );
    core.ownPeerRef = clientSignalRef;
    core.peerDisconnect = disconnect;

    await firebase.remove(clientCandidatesRef).catch((error) => {
      logWarning('multiplayer', 'Stale client candidate cleanup failed', { error });
    });

    const offer = enableOpusStereo(await peer.pc.createOffer());
    const offerCreatedAt = Date.now();
    core.publish({ connectionDetail: 'Creating an ICE connection offer...' });
    const startCandidatePublishing = prepareCandidatePublisher(
      peer,
      (candidate, index) => {
        const runtime = core.firebaseRuntime;
        if (!runtime) return;
        const candidateId = `c${String(index).padStart(3, '0')}`;
        return runtime.set(
          runtime.ref(
            runtime.database,
            `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/clientCandidates/${candidateId}`
          ),
          candidate
        );
      },
      () => {
        core.allowClientReconnect = false;
        clearPeerConnectionTimer(peer);
        core.publish({
          connectionStatus: 'error',
          audioStatus: 'unavailable',
          message: 'Could not send ICE candidates. The deployed Firebase multiplayer rules may be out of date.'
        });
      }
    );
    await peer.pc.setLocalDescription(offer);
    core.publish({ connectionDetail: 'Gathering and sending ICE candidates...' });
    await withTimeout(
      firebase.set(clientSignalRef, {
        name: peer.name,
        platform: getClientPlatform(),
        description: peer.pc.localDescription?.toJSON(),
        createdAt: offerCreatedAt
      }),
      SIGNALING_TIMEOUT_MS,
      'Publishing the peer connection offer timed out.'
    );
    startCandidatePublishing();
    core.publish({ connectionDetail: `Waiting for ${core.state.hostName ?? 'the host'} to answer...` });
    startPeerConnectionTimer(peer, () => {
      if (core.clientPeer !== peer || peer.pc.connectionState === 'connected') return;
      core.publish({
        connectionStatus: 'disconnected',
        audioStatus: 'unavailable',
        connectionDetail: describeIceFailure(peer),
        message: describeIceFailure(peer)
      });
      scheduleClientReconnect(ctx, 2_000);
    });

    let answerApplicationStarted = false;
    core.stopAnswerListener = firebase.onValue(
      nextPeerRef,
      (snapshot) => {
        const signal = snapshot.val() as {
          host?: SignalAnswer;
          hostCandidates?: SignalCandidates;
        } | null;
        const answer = signal?.host;
        if (answer && !isSignalAnswerForOffer(answer, offerCreatedAt)) {
          logDebug('multiplayer', 'Ignoring stale host signaling answer', {
            expectedCreatedAt: offerCreatedAt,
            receivedCreatedAt: answer.createdAt ?? null
          });
          return;
        }
        if (answer?.error === 'host-full') {
          core.allowClientReconnect = false;
          clearPeerConnectionTimer(peer);
          core.publish({
            connectionStatus: 'error',
            audioStatus: 'unavailable',
            connectionDetail: 'The host has reached its listener limit.',
            message: 'That multiplayer host has reached its listener limit.'
          });
          peer.pc.close();
          if (core.firebaseRuntime && core.ownPeerRef) void core.firebaseRuntime.remove(core.ownPeerRef);
          return;
        }
        stageRemoteCandidates(peer, signal?.hostCandidates ?? {});
        if (!answer?.description || answerApplicationStarted || peer.pc.remoteDescription) return;
        answerApplicationStarted = true;
        logDebug('multiplayer', 'Applying host signaling answer', {
          peerId: peer.id,
          signalingState: peer.pc.signalingState
        });
        core.publish({ connectionDetail: 'Checking direct ICE routes...' });
        void peer.pc.setRemoteDescription(answer.description)
          .then(() => flushRemoteCandidates(peer))
          .catch((error) => {
            clearPeerConnectionTimer(peer);
            core.publish({
              connectionStatus: 'error',
              audioStatus: 'unavailable',
              connectionDetail: 'The host answer was rejected by the browser.',
              message: `The host answer could not be applied: ${errorMessage(error, 'invalid session description')}`
            });
          });
      }
    );
  } catch (error) {
    logError(
      'multiplayer',
      reconnecting ? 'Reconnect attempt failed' : 'Client connection failed',
      error
    );
    await core.resetSession(true);
    if (reconnecting && core.allowClientReconnect) {
      core.publish({
        mode: 'client',
        connectionStatus: 'disconnected',
        audioStatus: 'unavailable',
        connectionDetail: 'The signaling attempt failed; preparing another attempt...',
        message: 'Reconnecting to the host...'
      });
    } else if (!silent) {
      core.allowClientReconnect = false;
      core.publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        hostVersion: null,
        hostImplementation: null,
        hostProtocol: null,
        freeplay: false,
        audioStatus: 'unavailable',
        connectionDetail: errorMessage(error, 'Could not join that multiplayer session.'),
        message: errorMessage(error, 'Could not join that multiplayer session.')
      });
    } else {
      core.publish({
        mode: 'client',
        connectionStatus: 'disconnected',
        reconnecting: true,
        audioStatus: 'unavailable',
        message: 'Reconnecting to the host...'
      });
    }
    throw error;
  }
}
