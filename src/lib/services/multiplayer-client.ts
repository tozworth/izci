import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import {
  clearMultiplayerLastSession,
  rememberMultiplayerLastSession,
  type MultiplayerLastSession
} from '$lib/stores/multiplayer-last-session';
import {
  multiplayerFreeplayState,
  rememberMultiplayerFreeplayState
} from '$lib/stores/multiplayer-freeplay-state';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import {
  forgetMultiplayerPairing,
  multiplayerPairings,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import { multiplayerAudioService } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { decodeRenderFrame } from './multiplayer-render-transfer';
import { resolveMultiplayerConnectionRoute } from './multiplayer-ice';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { getMultiplayerArtworkTrackKey } from './multiplayer-artwork';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  isHostMessage,
  type MultiplayerCommand,
  type MultiplayerCommandInput,
  type MultiplayerSynchronizedStart
} from './multiplayer-protocol';
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
import { parseSourceFileFrame } from './multiplayer-source-transfer';
import { MultiplayerClientTransition } from './multiplayer-client-transition';
import {
  createDirectIceSettings,
  isSignalAnswerForOffer,
  loadFirebase,
  normalizeInviteCode,
  requestTemporaryTurnCredentials
} from './multiplayer-signaling';
import {
  createReceiverBitrateMonitor
} from './multiplayer-receiver-monitor';
import {
  errorMessage,
  getClientPlatform,
  getLocalName,
  isIncompatibleProtocolHello,
  isMultiplayerClientTransportHealthy,
  sanitizeFreeplayQueueIds,
  sanitizeClientName,
  writeReceiveAudioPreference
} from './multiplayer-utils';
import {
  EMPTY_CATALOG,
  EMPTY_REMOTE_PLAYBACK,
  type MultiplayerClientSide,
  type MultiplayerSessionCore,
  type PeerConnection,
  type SignalAnswer,
  type SignalCandidates,
  type SourceFileBeginFrame
} from './multiplayer-types';

export function createMultiplayerClientSide(core: MultiplayerSessionCore): MultiplayerClientSide {
  const SIGNALING_TIMEOUT_MS = 8_000;
  const transition = new MultiplayerClientTransition();
  transition.setReceiveAudio(core.state.receiveAudio);
  let sourceRetryGenerationId: string | null = null;
  let sourceRetryCount = 0;
  let pendingFreeplayResumeTrackId: string | null = null;
  let synchronizedStartTimer: number | null = null;
  let synchronizedStartGenerationId: string | null = null;
  let synchronizedStartAt = 0;
  let renderReadySentGeneration: string | null = null;
  let renderReadySentEpoch = -1;
  multiplayerRenderPlaybackService.setCallbacks({
    onReady: (epoch, positionMs) => {
      if (core.state.mode !== 'client' || !core.clientPeer) return;
      if (core.latestDelivery.mode !== 'render') return;
      sendRenderReadyMessages(core.clientPeer, epoch, positionMs);
    },
    onNeed: (need) => {
      if (core.state.mode !== 'client' || !core.clientPeer) return;
      if (core.latestDelivery.mode !== 'render') return;
      const state = multiplayerRenderPlaybackService.getState();
      if (!state.generationId || !state.renderId) return;
      sendToPeer(core.clientPeer, {
        kind: 'render.need',
        need: {
          generationId: state.generationId,
          renderId: state.renderId,
          epoch: need.epoch,
          targetTimeMs: need.targetTimeMs,
          aheadMs: need.aheadMs,
          ranges: need.ranges
        }
      });
    }
  });
  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  function cancelSynchronizedStart(): void {
    if (synchronizedStartTimer !== null) window.clearTimeout(synchronizedStartTimer);
    synchronizedStartTimer = null;
    synchronizedStartGenerationId = null;
    synchronizedStartAt = 0;
    multiplayerSourcePlaybackService.cancelSynchronizedStart();
  }

  function applySynchronizedStart(peer: PeerConnection, start: MultiplayerSynchronizedStart): void {
    if (core.clientPeer !== peer
      || core.state.freeplay
      || !transition.isCurrent(start.generationId, start.trackId)) return;
    cancelSynchronizedStart();
    synchronizedStartGenerationId = start.generationId;
    synchronizedStartAt = start.startAt;
    if (core.state.remoteDelivery.mode === 'source-file') {
      multiplayerSourcePlaybackService.scheduleSynchronizedStart(
        start.generationId,
        start.trackId,
        start.positionSeconds,
        start.startAt
      );
      return;
    }
    if (core.state.remoteDelivery.mode === 'render') {
      const renderRelease = () => {
        synchronizedStartTimer = null;
        if (core.clientPeer !== peer
          || synchronizedStartGenerationId !== start.generationId
          || !transition.isCurrent(start.generationId, start.trackId, 'render')) return;
        synchronizedStartAt = 0;
        multiplayerRenderPlaybackService.resumeAudible();
      };
      synchronizedStartTimer = window.setTimeout(
        renderRelease,
        Math.max(0, start.startAt - Date.now())
      );
      return;
    }
    if (core.state.remoteDelivery.mode !== 'stream') return;
    const release = () => {
      synchronizedStartTimer = null;
      if (core.clientPeer !== peer
        || synchronizedStartGenerationId !== start.generationId
        || !transition.isCurrent(start.generationId, start.trackId, 'stream')) return;
      synchronizedStartAt = 0;
      multiplayerAudioService.setRemoteAudible(core.state.receiveAudio);
    };
    synchronizedStartTimer = window.setTimeout(release, Math.max(0, start.startAt - Date.now()));
  }

  function updateLocalTimelineMode(): void {
    multiplayerSourcePlaybackService.setLocalTimeline(
      core.state.mode === 'client'
        && core.state.freeplay
        && core.state.remoteDelivery.mode === 'source-file'
    );
  }

  function persistFreeplayState(): void {
    if (core.state.mode !== 'client' || !core.state.freeplay || !core.clientHostId) return;
    const previous = multiplayerFreeplayState.getSnapshot();
    const next = {
      hostId: core.clientHostId,
      queue: core.state.freeplayQueue,
      shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
      repeatMode: core.state.remoteCatalog.repeatMode,
      currentTrackId: core.state.remotePlayback.track?.id
        ?? (previous?.hostId === core.clientHostId ? previous.currentTrackId : null)
    };
    if (previous
      && previous.hostId === next.hostId
      && previous.shuffleEnabled === next.shuffleEnabled
      && previous.repeatMode === next.repeatMode
      && previous.currentTrackId === next.currentTrackId
      && previous.queue.length === next.queue.length
      && previous.queue.every((id, index) => id === next.queue[index])) return;
    rememberMultiplayerFreeplayState(next);
  }

  function sendFreeplayQueueToPeer(): void {
    if (!core.clientPeer || !core.state.freeplay) return;
    sendToPeer(core.clientPeer, {
      kind: 'freeplay.queue',
      itemIds: core.state.freeplayQueue,
      shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
      repeatMode: core.state.remoteCatalog.repeatMode
    });
  }

  function setFreeplayQueue(itemIds: string[]): void {
    publish({ freeplayQueue: sanitizeFreeplayQueueIds(itemIds) });
    persistFreeplayState();
    sendFreeplayQueueToPeer();
  }

  function restoreFreeplayStateForHost(hostId: string): void {
    const saved = multiplayerFreeplayState.getSnapshot();
    if (!saved || saved.hostId !== hostId) return;
    publish({
      freeplayQueue: saved.queue,
      remoteCatalog: {
        ...core.state.remoteCatalog,
        shuffleEnabled: saved.shuffleEnabled,
        repeatMode: saved.repeatMode
      }
    });
  }

  function tryResumeFreeplaySelection(): void {
    const trackId = pendingFreeplayResumeTrackId;
    if (!trackId || !core.state.freeplay || core.state.remotePlayback.track) return;
    if (!core.state.freeplayQueue.includes(trackId)) {
      pendingFreeplayResumeTrackId = null;
      return;
    }
    pendingFreeplayResumeTrackId = null;
    logInfo('freeplay', 'Requesting persisted Freeplay selection', { trackId });
    sendCommand({ type: 'collection.activate', collection: 'playlist', itemId: trackId });
  }

  async function join(
    rawInviteCode: string,
    options: { silent?: boolean; preserveHostId?: boolean } = {}
  ): Promise<void> {
    logInfo('multiplayer', 'Join requested', { paired: false });
    if (core.state.receiveAudio) void multiplayerAudioService.warmRemoteAudio();
    core.allowClientReconnect = true;
    core.reconnectAttempts = 0;
    if (!options.preserveHostId) core.clientHostId = null;
    multiplayerSourcePlaybackService.beginClientSession((trackId, generationId) => {
      if (core.clientPeer && core.state.mode === 'client' && core.state.freeplay) {
        if (!transition.isCurrent(generationId, trackId, 'source-file')) return;
        if (core.state.remoteDelivery.mode === 'source-file'
          && core.state.remoteCatalog.repeatMode === 'one') {
          multiplayerSourcePlaybackService.replay();
        } else {
          sendToPeer(core.clientPeer, {
            kind: 'playback.ended',
            generationId,
            trackId
          });
        }
      }
    });
    multiplayerSourcePlaybackService.setEnabled(core.state.receiveAudio);
    try {
      await connectClient(rawInviteCode, false, options.silent === true);
      if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
    } catch (error) {
      logError('multiplayer', 'Join failed', error);
      if (!options.silent) await multiplayerSourcePlaybackService.endClientSession();
      throw error;
    }
  }

  async function joinPaired(hostId: string): Promise<void> {
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
      protocolVersion?: number;
    } | null;
    if (!directory
      || directory.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION
      || !normalizeInviteCode(directory.currentRoom ?? '')) {
      throw new Error('That paired host is not currently hosting.');
    }
    const pairing = multiplayerPairings.getSnapshot().find((candidate) => candidate.hostId === hostId);
    rememberMultiplayerPairing(
      hostId,
      sanitizeClientName(directory.hostName ?? 'Host'),
      pairing?.freeplay === true
    );
    core.clientHostId = hostId;
    await join(directory.currentRoom!, { preserveHostId: true });
  }

  async function resolveDirectoryRoomCode(hostId: string): Promise<string | null> {
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
      )).val() as { currentRoom?: string; protocolVersion?: number } | null;
      return directory?.protocolVersion === MULTIPLAYER_PROTOCOL_VERSION
        ? normalizeInviteCode(directory.currentRoom ?? '')
        : null;
    } catch (error) {
      logWarning('multiplayer', 'Paired-host directory lookup failed', { hostId, error });
      return null;
    }
  }

  async function restoreClientJoin(last: MultiplayerLastSession): Promise<void> {
    core.clientHostId = last.hostId;
    publish({
      mode: 'client',
      connectionStatus: 'connecting',
      reconnecting: true,
      inviteCode: last.inviteCode,
      hostName: last.hostName,
      audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
      connectionDetail: 'Finding the paired host session...',
      message: 'Reconnecting to the host...'
    });
    const inviteCode = last.hostId ? await resolveDirectoryRoomCode(last.hostId) : null;
    const target = inviteCode ?? last.inviteCode;
    if (!target) throw new Error('No multiplayer session to restore.');
    try {
      await join(target, { silent: true, preserveHostId: true });
    } catch {
      core.allowClientReconnect = true;
      publish({
        mode: 'client',
        inviteCode: target,
        hostName: last.hostName,
        connectionStatus: 'disconnected',
        reconnecting: true,
        message: 'Reconnecting to the host...'
      });
      scheduleClientReconnect();
    }
  }

  async function connectClient(rawInviteCode: string, reconnecting: boolean, silent = false): Promise<void> {
    clearReconnectTimer();
    await core.resetSession(true);
    const inviteCode = normalizeInviteCode(rawInviteCode);
    if (!inviteCode) {
      const error = new Error('Enter a valid multiplayer invite code.');
      publish({ connectionStatus: 'error', message: error.message });
      throw error;
    }

    publish({
      mode: 'client',
      connectionStatus: 'connecting',
      reconnecting,
      inviteCode,
      hostName: null,
      hostVersion: null,
      freeplayPaired: reconnecting ? core.state.freeplayPaired : false,
      freeplay: reconnecting ? core.state.freeplay : false,
      freeplayQueue: reconnecting ? core.state.freeplayQueue : [],
      remoteCatalog: reconnecting ? core.state.remoteCatalog : EMPTY_CATALOG,
      remotePlayback: reconnecting ? core.state.remotePlayback : EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: reconnecting ? core.state.remoteArtwork : null,
      remoteArtworkResolvedTrackKey: reconnecting ? core.state.remoteArtworkResolvedTrackKey : '',
      remoteDelivery: reconnecting ? core.state.remoteDelivery : {
        generationId: 'idle', trackId: null, mode: 'none', reason: 'host-disabled'
      },
      audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: 'Signing in to multiplayer signaling...',
      message: null
    });
    updateLocalTimelineMode();
    logInfo(
      'multiplayer',
      reconnecting ? 'Reconnect attempt started' : 'Client connection started',
      {
        protocol: MULTIPLAYER_PROTOCOL_VERSION,
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
      publish({ connectionDetail: 'Looking up the multiplayer session...' });
      const metaRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/meta`);
      const meta = (await withTimeout(
        firebase.get(metaRef),
        SIGNALING_TIMEOUT_MS,
        'The multiplayer room lookup timed out.'
      )).val() as {
        protocolVersion?: number;
        hostName?: string;
        turnRelay?: boolean;
      } | null;
      if (!meta || meta.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new Error('That multiplayer session is unavailable or incompatible.');
      }
      publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });
      const turnSettings = meta.turnRelay
        ? await withTimeout(
            requestTemporaryTurnCredentials(firebase, inviteCode),
            SIGNALING_TIMEOUT_MS,
            'TURN credential exchange timed out.'
          )
        : createDirectIceSettings();
      publish({ connectionDetail: meta.turnRelay
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
      attachClientChannel(peer);
      attachClientMediaChannel(peer);
      attachClientRenderChannel(peer);

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
      publish({ connectionDetail: 'Creating an ICE connection offer...' });
      const startCandidatePublishing = prepareCandidatePublisher(
        peer,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/clientCandidates`,
        () => core.firebaseRuntime,
        () => {
          core.allowClientReconnect = false;
          clearPeerConnectionTimer(peer);
          publish({
            connectionStatus: 'error',
            audioStatus: 'unavailable',
            message: 'Could not send ICE candidates. The deployed Firebase multiplayer rules may be out of date.'
          });
        }
      );
      await peer.pc.setLocalDescription(offer);
      publish({ connectionDetail: 'Gathering and sending ICE candidates...' });
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
      publish({ connectionDetail: `Waiting for ${core.state.hostName ?? 'the host'} to answer...` });
      startPeerConnectionTimer(peer, () => {
        if (core.clientPeer !== peer || peer.pc.connectionState === 'connected') return;
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: describeIceFailure(peer),
          message: describeIceFailure(peer)
        });
        scheduleClientReconnect(2_000);
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
            publish({
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
          publish({ connectionDetail: 'Checking direct ICE routes...' });
          void peer.pc.setRemoteDescription(answer.description)
            .then(() => flushRemoteCandidates(peer))
            .catch((error) => {
              clearPeerConnectionTimer(peer);
              publish({
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
        publish({
          mode: 'client',
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: 'The signaling attempt failed; preparing another attempt...',
          message: 'Reconnecting to the host...'
        });
      } else if (!silent) {
        core.allowClientReconnect = false;
        publish({
          mode: 'idle',
          connectionStatus: 'error',
          hostName: null,
          hostVersion: null,
          freeplayPaired: false,
          freeplay: false,
          audioStatus: 'unavailable',
          connectionDetail: errorMessage(error, 'Could not join that multiplayer session.'),
          message: errorMessage(error, 'Could not join that multiplayer session.')
        });
      } else {
        publish({
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

  function attachClientChannel(peer: PeerConnection): void {
    const channel = peer.channel;
    if (!channel) return;
    const decode = createMultiplayerMessageDecoder(isHostMessage);

    channel.onopen = () => {
      if (core.clientPeer !== peer) return;
      core.reconnectAttempts = 0;
      core.reconnectInFlight = false;
      clearReconnectTimer();
      logInfo('multiplayer', 'Client control channel opened', {
        peerId: peer.id,
        reconnecting: core.state.reconnecting
      });
      publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
      if (core.state.inviteCode && core.state.hostName) {
        rememberMultiplayerHost(core.state.hostName, core.state.inviteCode);
      }
      rememberMultiplayerLastSession('client', {
        inviteCode: core.state.inviteCode,
        hostId: core.clientHostId,
        hostName: core.state.hostName
      });
      sendToPeer(peer, {
        kind: 'hello',
        version: MULTIPLAYER_PROTOCOL_VERSION,
        name: peer.name,
        platform: getClientPlatform(),
        freeplayEnabled: core.multiplayerSettings.multiplayerFreeplay
      });
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = decode(event.data);
      if (!message) {
        // A hello from an incompatible protocol version fails isHostMessage
        // and would vanish here; surface it instead of failing silently.
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          parsed = null;
        }
        if (isIncompatibleProtocolHello(parsed)) {
          publish({ connectionStatus: 'error', message: 'The host uses an incompatible protocol.' });
        }
        return;
      }
      if (message.kind === 'catalog') publish({ remoteCatalog: message.catalog });
      if (message.kind === 'state') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            shuffleEnabled: message.shuffleEnabled,
            repeatMode: message.repeatMode
          }
        });
        persistFreeplayState();
      }
      if (message.kind === 'playback') {
        if (!transition.acceptPlayback(message.playback)) {
          logDebug('freeplay', 'Ignored stale multiplayer playback', {
            generationId: message.playback.generationId,
            currentGenerationId: core.state.remoteDelivery.generationId
          });
          return;
        }
        publish({ remotePlayback: message.playback });
        multiplayerSourcePlaybackService.syncPlayback(message.playback);
        if (core.state.remoteDelivery.mode === 'stream') {
          multiplayerAudioService.setRemoteAudible(
            core.state.receiveAudio
              && message.playback.snapshot.state === 'playing'
              && !(synchronizedStartGenerationId === message.playback.generationId
                && Date.now() < synchronizedStartAt)
          );
        }
        if (core.state.remoteDelivery.mode === 'render') {
          multiplayerRenderPlaybackService.syncPlayback(message.playback);
          const audible = core.state.receiveAudio
            && message.playback.snapshot.state === 'playing'
            && !(synchronizedStartGenerationId === message.playback.generationId
              && Date.now() < synchronizedStartAt);
          multiplayerRenderPlaybackService.setAudible(audible);
          publish({
            audioStatus: !core.state.receiveAudio
              ? 'refused'
              : message.playback.snapshot.state === 'playing'
              ? 'playing'
              : 'ready',
            averageAudioBitrateKbps: null
          });
        }
        persistFreeplayState();
        loadPendingClientSourceFile(peer);
        tryResumeFreeplaySelection();
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'playback.prepare') {
        if (!transition.acceptPreparation(message.preparation)) {
          logDebug('freeplay', 'Ignored mismatched playback preparation', message.preparation);
          return;
        }
        // A fresh preparation re-releases the host playback gate: the
        // ready-dedup from the previous (generation, epoch) must not swallow
        // the re-ack. Without this, pause-then-play restarts preparation
        // forever (host logs: repeated 'Freeplay preparation started', no
        // readiness) and transport controls appear dead.
        renderReadySentGeneration = null;
        renderReadySentEpoch = -1;
        logDebug('freeplay', 'Playback preparation accepted', message.preparation);
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'artwork') {
        publish({
          remoteArtwork: message.artwork,
          remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(core.state.remotePlayback.track)
        });
      }
      if (message.kind === 'render.manifest') {
        multiplayerRenderPlaybackService.updateWindowMs(
          core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
        );
        const accepted = multiplayerRenderPlaybackService.setManifest(message.manifest);
        if (accepted) {
          logInfo('multiplayer', 'Buffered Opus manifest accepted', {
            generationId: message.manifest.generationId,
            renderId: message.manifest.renderId,
            clusters: message.manifest.clusters.length,
            durationMs: message.manifest.durationMs
          });
          sendClientPlaybackReadyIfPossible(peer);
        }
      }
      if (message.kind === 'pairing') {
        if (message.paired) {
          rememberMultiplayerPairing(message.hostId, message.name, message.freeplayPaired);
        }
        else forgetMultiplayerPairing(message.hostId);
        core.clientHostId = message.paired ? message.hostId : null;
        publish({
          freeplayPaired: message.paired && message.freeplayPaired,
          freeplay: message.paired && message.freeplayActive
        });
        updateLocalTimelineMode();
        rememberMultiplayerLastSession('client', {
          inviteCode: core.state.inviteCode,
          hostId: core.clientHostId,
          hostName: message.name
        });
        if (message.paired && message.freeplayActive) {
          restoreFreeplayStateForHost(message.hostId);
          sendFreeplayQueueToPeer();
          const saved = multiplayerFreeplayState.getSnapshot();
          const resumeTrackId = saved?.hostId === message.hostId ? saved.currentTrackId : null;
          pendingFreeplayResumeTrackId = resumeTrackId;
          tryResumeFreeplaySelection();
        } else {
          pendingFreeplayResumeTrackId = null;
        }
      }
      if (message.kind === 'delivery') {
        const changed = transition.beginDelivery(message.delivery);
        if (changed === null) {
          logDebug('freeplay', 'Ignored mutated multiplayer delivery generation', {
            generationId: message.delivery.generationId
          });
          return;
        }
        if (changed) {
          cancelSynchronizedStart();
          sourceRetryGenerationId = message.delivery.generationId;
          sourceRetryCount = 0;
          multiplayerAudioService.setRemoteAudible(false);
          logInfo('freeplay', 'Multiplayer delivery generation changed', {
            generationId: message.delivery.generationId,
            trackId: message.delivery.trackId,
            delivery: message.delivery.mode
          });
        }
        core.latestDelivery = message.delivery;
        publish({ remoteDelivery: message.delivery });
        updateLocalTimelineMode();
        if (changed) {
          if (!core.state.receiveAudio) {
            multiplayerSourcePlaybackService.setEnabled(false);
            publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
          } else if (message.delivery.mode === 'source-file') {
            multiplayerSourcePlaybackService.setEnabled(true);
            publish({ audioStatus: multiplayerSourcePlaybackService.active ? 'playing' : 'connecting' });
          } else if (message.delivery.mode === 'none') {
            publish({
              audioStatus: 'disabled',
              averageAudioBitrateKbps: null
            });
            multiplayerSourcePlaybackService.clearSourceTrack();
          } else if (message.delivery.mode === 'render') {
            multiplayerSourcePlaybackService.clearSourceTrack();
            multiplayerAudioService.clearRemoteTrack();
            multiplayerRenderPlaybackService.start(
              message.delivery.generationId,
              message.delivery.trackId ?? ''
            );
            multiplayerRenderPlaybackService.updateWindowMs(
              core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
            );
            publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
          } else {
            multiplayerSourcePlaybackService.clearSourceTrack();
            multiplayerRenderPlaybackService.release();
            publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
            void attachClientRemoteAudio(peer, message.delivery.generationId);
          }
        }
        loadPendingClientSourceFile(peer);
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'clock.ping') {
        const clientReceivedAt = Date.now();
        sendToPeer(peer, {
          kind: 'clock.pong',
          generationId: message.generationId,
          hostSentAt: message.hostSentAt,
          clientReceivedAt,
          clientSentAt: Date.now()
        });
      }
      if (message.kind === 'playback.start') applySynchronizedStart(peer, message.start);
      if (message.kind === 'playback.cancel'
        && synchronizedStartGenerationId === message.generationId) {
        cancelSynchronizedStart();
      }
      if (message.kind === 'buffer') {
        core.hostAudioBufferMs = message.bufferMs;
        applyClientAudioBuffer(peer);
      }
      if (message.kind === 'kicked') {
        core.allowClientReconnect = false;
        clearMultiplayerLastSession();
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          message: 'The host removed this client.'
        });
        peer.pc.close();
      }
      if (message.kind === 'hello') {
        const hostName = sanitizeClientName(message.name);
        publish({ hostName, hostVersion: message.appVersion });
        if (core.state.inviteCode) rememberMultiplayerHost(hostName, core.state.inviteCode);
        rememberMultiplayerLastSession('client', {
          inviteCode: core.state.inviteCode,
          hostId: core.clientHostId,
          hostName
        });
      }
    };
    channel.onclose = () => {
      if (core.clientPeer !== peer) return;
      logWarning('multiplayer', 'Client control channel closed', {
        peerId: peer.id,
        connectionState: peer.pc.connectionState,
        reconnectAllowed: core.allowClientReconnect
      });
      multiplayerSourcePlaybackService.clearLoadedFile();
      if (core.state.mode === 'client' && core.state.connectionStatus !== 'error') {
        publish({
          connectionStatus: core.allowClientReconnect ? 'connecting' : 'disconnected',
          reconnecting: core.allowClientReconnect,
          audioStatus: 'unavailable',
          connectionDetail: core.allowClientReconnect
            ? 'The peer connection closed; preparing another attempt...'
            : core.state.message ?? 'Connection to the host was lost.',
          message: core.allowClientReconnect
            ? 'Reconnecting to the host...'
            : core.state.message ?? 'Connection to the host was lost.'
        });
        scheduleClientReconnect(1_000);
      }
    };
    peer.pc.onconnectionstatechange = () => {
      if (core.clientPeer !== peer) return;
      logDebug('multiplayer', 'Client peer connection state changed', {
        peerId: peer.id,
        state: peer.pc.connectionState
      });
      if (peer.pc.connectionState === 'connected') {
        clearPeerConnectionTimer(peer);
        core.reconnectAttempts = 0;
        clearReconnectTimer();
        publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
        void updateClientConnectionRoute(peer);
      }
      if (peer.pc.connectionState === 'failed') {
        publish({
          connectionStatus: 'disconnected',
          reconnecting: core.allowClientReconnect,
          audioStatus: 'unavailable',
          connectionDetail: describeIceFailure(peer),
          message: describeIceFailure(peer)
        });
        scheduleClientReconnect(1_000);
      }
      if (peer.pc.connectionState === 'disconnected') scheduleClientReconnect(4_000);
    };
    peer.pc.ontrack = (event) => {
      if (event.track.kind !== 'audio') return;
      applyReceiverBuffer(event.receiver);
      receiverMonitor.start(peer);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      event.track.enabled = true;
      void multiplayerAudioService.attachRemoteTrack(
        event.track,
        stream,
        (audioStatus) => {
          if (core.state.mode !== 'client') return;
          if (audioStatus === 'unavailable') transition.setReceiverPipelineReady(false);
          if (core.latestDelivery.mode !== 'stream'
            && (audioStatus === 'connecting' || audioStatus === 'ready' || audioStatus === 'playing')) return;
          publish({
            audioStatus,
            averageAudioBitrateKbps: audioStatus === 'playing'
              ? core.state.averageAudioBitrateKbps
              : null
          });
        }
      ).then((ready) => {
        if (core.clientPeer !== peer) return;
        transition.setReceiverPipelineReady(ready);
        if (!core.state.receiveAudio) publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
        else if (core.state.remoteDelivery.mode === 'stream') {
          multiplayerAudioService.setRemoteAudible(core.state.remotePlayback.snapshot.state === 'playing');
        }
        sendClientPlaybackReadyIfPossible(peer);
      });
    };
  }

  async function attachClientRemoteAudio(peer: PeerConnection, generationId: string): Promise<void> {
    if (core.clientPeer !== peer || !core.state.receiveAudio || core.latestDelivery.mode !== 'stream') return;
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') return;
    track.enabled = true;
    const ready = await multiplayerAudioService.attachRemoteTrack(track, new MediaStream([track]), (audioStatus) => {
      if (core.state.mode === 'client' && core.state.receiveAudio && core.latestDelivery.mode === 'stream') {
        if (audioStatus === 'unavailable') transition.setReceiverPipelineReady(false);
        publish({ audioStatus });
      }
    });
    if (core.clientPeer !== peer || core.latestDelivery.generationId !== generationId) return;
    transition.setReceiverPipelineReady(ready);
    multiplayerAudioService.setRemoteAudible(
      core.state.receiveAudio && core.state.remotePlayback.snapshot.state === 'playing'
    );
    sendClientPlaybackReadyIfPossible(peer);
  }

  function attachClientMediaChannel(peer: PeerConnection): void {
    const channel = peer.mediaChannel;
    if (!channel) return;
    channel.binaryType = 'arraybuffer';
    let pending: {
      frame: SourceFileBeginFrame;
      chunks: ArrayBuffer[];
      received: number;
    } | null = null;

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const frame = parseSourceFileFrame(event.data);
        if (!frame) return;
        if (frame.kind === 'file.begin') {
          pending = { frame, chunks: [], received: 0 };
          multiplayerAudioService.setRemoteAudible(false);
          logDebug('multiplayer', 'Source-file transfer started', {
            generationId: frame.generationId,
            trackId: frame.trackId,
            bytes: frame.size,
            generationCurrent: transition.isCurrent(frame.generationId, frame.trackId, 'source-file')
          });
          // Keep the current file audible until its replacement is completely received
          // and prepared. Stopping the only active media element here lets mobile
          // Chromium suspend a locked client before the remaining chunks can arrive.
          if (core.state.receiveAudio) publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
          return;
        }
        if (!pending || pending.frame.transferId !== frame.transferId) return;
        const complete = pending;
        pending = null;
        if (complete.received !== complete.frame.size) {
          publish({ audioStatus: 'unavailable' });
          requestSourceRetry(peer, complete.frame.generationId);
          return;
        }
        const file = new File(complete.chunks, complete.frame.name, {
          type: complete.frame.type,
          lastModified: complete.frame.lastModified
        });
        core.pendingClientSourceFile = {
          trackId: complete.frame.trackId,
          generationId: complete.frame.generationId,
          file
        };
        const generationCurrent = transition.isCurrent(
          complete.frame.generationId,
          complete.frame.trackId,
          'source-file'
        );
        logDebug('multiplayer', 'Source-file transfer completed', {
          generationId: complete.frame.generationId,
          trackId: complete.frame.trackId,
          bytes: complete.received,
          generationCurrent
        });
        if (generationCurrent) loadPendingClientSourceFile(peer);
        return;
      }
      if (!pending || !(event.data instanceof ArrayBuffer)) return;
      if (pending.received + event.data.byteLength > pending.frame.size) {
        const generationId = pending.frame.generationId;
        pending = null;
        publish({ audioStatus: 'unavailable' });
        requestSourceRetry(peer, generationId);
        return;
      }
      pending.chunks.push(event.data);
      pending.received += event.data.byteLength;
    };
    channel.onclose = () => {
      pending = null;
      if (core.clientPeer === peer && core.latestDelivery.mode === 'source-file') {
        transition.setSourceReady(
          core.latestDelivery.generationId,
          core.latestDelivery.trackId ?? '',
          false
        );
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({ audioStatus: 'unavailable' });
      }
      if (core.clientPeer === peer
        && core.allowClientReconnect
        && peer.pc.connectionState !== 'closed') peer.pc.close();
    };
  }

  function attachClientRenderChannel(peer: PeerConnection): void {
    const channel = peer.renderChannel;
    if (!channel) return;
    channel.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const frame = decodeRenderFrame(event.data);
      if (!frame) return;
      multiplayerRenderPlaybackService.ingest(
        frame.renderId,
        frame.epoch,
        frame.clusterIndex,
        frame.fragmentOffset,
        frame.payload
      );
    };
    channel.onclose = () => {
      if (core.clientPeer === peer
        && core.allowClientReconnect
        && peer.pc.connectionState !== 'closed') peer.pc.close();
    };
  }

  function loadPendingClientSourceFile(peer: PeerConnection): void {
    const pending = core.pendingClientSourceFile;
    const remoteTrack = core.state.remotePlayback.track;
    if (!pending
      || !remoteTrack
      || remoteTrack.id !== pending.trackId
      || core.state.remoteDelivery.mode !== 'source-file'
      || core.state.remoteDelivery.generationId !== pending.generationId) return;
    core.pendingClientSourceFile = null;
    void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then(async (loaded) => {
      if (core.clientPeer !== peer) return;
      const generationStillCurrent = core.state.remoteDelivery.mode === 'source-file'
        && core.state.remoteDelivery.generationId === pending.generationId;
      if (!generationStillCurrent) return;
      const audioReady = loaded && core.state.receiveAudio
        ? await multiplayerSourcePlaybackService.resume()
        : false;
      if (core.clientPeer !== peer || core.state.remoteDelivery.generationId !== pending.generationId) return;
      transition.setSourceReady(pending.generationId, pending.trackId, loaded);
      publish({
        audioStatus: !core.state.receiveAudio
          ? 'refused'
          : loaded
          ? audioReady ? 'playing' : 'blocked'
          : 'unavailable',
        averageAudioBitrateKbps: null
      });
      logInfo('freeplay', 'Source-file playback prepared', {
        generationId: pending.generationId,
        trackId: pending.trackId,
        loaded,
        audioReady
      });
      sendClientPlaybackReadyIfPossible(peer);
      if (!loaded && generationStillCurrent) requestSourceRetry(peer, pending.generationId);
    });
  }

  function sendRenderReadyMessages(peer: PeerConnection, epoch: number, positionMs: number): void {
    const state = multiplayerRenderPlaybackService.getState();
    if (!state.generationId || !state.renderId) return;
    if (renderReadySentGeneration === state.generationId && renderReadySentEpoch === epoch) return;
    renderReadySentGeneration = state.generationId;
    renderReadySentEpoch = epoch;
    logInfo('multiplayer', 'Buffered Opus client ready', {
      generationId: state.generationId,
      epoch,
      positionMs: Math.round(positionMs)
    });
    sendToPeer(peer, {
      kind: 'render.ready',
      generationId: state.generationId,
      renderId: state.renderId,
      epoch,
      positionMs: Math.round(positionMs)
    });
  }

  function sendClientPlaybackReadyIfPossible(peer: PeerConnection): void {
    if (core.clientPeer !== peer) return;
    if (core.latestDelivery.mode === 'render') {
      const state = multiplayerRenderPlaybackService.getState();
      if (!state.ready || !state.generationId) return;
      sendRenderReadyMessages(peer, state.epoch, 0);
      return;
    }
    const generationId = transition.takeReadyGeneration();
    if (!generationId) return;
    logInfo('freeplay', 'Client playback pipeline ready', { generationId });
    sendToPeer(peer, {
      kind: 'playback.ready',
      generationId
    });
  }

  function requestSourceRetry(peer: PeerConnection, generationId: string): void {
    if (!transition.isCurrent(generationId, core.state.remoteDelivery.trackId, 'source-file')) return;
    if (sourceRetryGenerationId !== generationId) {
      sourceRetryGenerationId = generationId;
      sourceRetryCount = 0;
    }
    if (sourceRetryCount >= 2) return;
    sourceRetryCount += 1;
    sendToPeer(peer, { kind: 'source.retry', generationId });
  }

  async function updateClientConnectionRoute(peer: PeerConnection): Promise<void> {
    try {
      const route = resolveMultiplayerConnectionRoute((await peer.pc.getStats()).values());
      if (core.clientPeer === peer && route) publish({ connectionRoute: route });
    } catch {
      // Connection stats are optional; the client remains usable without a route label.
    }
  }

  function applyClientAudioBuffer(peer: PeerConnection): void {
    multiplayerRenderPlaybackService.updateWindowMs(
      core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
    );
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      applyReceiverBuffer(receiver);
    }
  }

  function applyReceiverBuffer(receiver: RTCRtpReceiver): void {
    const targetMs = core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs;
    const supported = setMultiplayerReceiverBuffer(receiver, targetMs);
    const effectiveMs = 'jitterBufferTarget' in receiver
      && typeof receiver.jitterBufferTarget === 'number'
      ? receiver.jitterBufferTarget
      : null;
    logInfo('multiplayer', 'Receiver buffer target updated', {
      targetMs,
      supported,
      effectiveMs
    });
  }

  function setReceiveAudio(enabled: boolean): void {
    if (core.state.receiveAudio === enabled) return;
    writeReceiveAudioPreference(enabled);
    publish({ receiveAudio: enabled });
    transition.setReceiveAudio(enabled);
    if (core.state.mode !== 'client' || !core.clientPeer) return;

    multiplayerSourcePlaybackService.setEnabled(enabled);
    if (!enabled) sendClientPlaybackReadyIfPossible(core.clientPeer);
    if (core.latestDelivery.mode === 'source-file') {
      multiplayerAudioService.setRemoteAudible(false);
      publish({
        audioStatus: enabled
          ? multiplayerSourcePlaybackService.active ? 'playing' : 'connecting'
          : 'refused',
        averageAudioBitrateKbps: null
      });
      return;
    }
    if (core.latestDelivery.mode === 'render') {
      multiplayerRenderPlaybackService.setEnabled(enabled);
      if (enabled) multiplayerRenderPlaybackService.updateWindowMs(
        core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
      );
      publish({
        audioStatus: enabled ? 'connecting' : 'refused',
        averageAudioBitrateKbps: null
      });
      if (enabled) sendClientPlaybackReadyIfPossible(core.clientPeer);
      return;
    }

    const receiver = core.clientPeer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') {
      publish({ audioStatus: enabled ? 'unavailable' : 'refused', averageAudioBitrateKbps: null });
      return;
    }
    track.enabled = enabled;
    if (!enabled) {
      multiplayerAudioService.setRemoteAudible(false);
      publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
      return;
    }
    if (core.latestDelivery.mode !== 'stream') {
      publish({ audioStatus: 'disabled' });
      return;
    }
    void multiplayerAudioService.warmRemoteAudio();
    void attachClientRemoteAudio(core.clientPeer, core.latestDelivery.generationId);
  }

  function scheduleClientReconnect(delay?: number): void {
    if (!core.allowClientReconnect || core.state.mode !== 'client' || core.reconnectInFlight || core.reconnectTimer !== null) return;
    const inviteCode = core.state.inviteCode;
    if (!inviteCode) return;
    const backoff = [2_000, 5_000, 10_000, 20_000, 30_000];
    const wait = delay ?? backoff[Math.min(core.reconnectAttempts, backoff.length - 1)];
    logInfo('multiplayer', 'Client reconnect scheduled', {
      attempt: core.reconnectAttempts + 1,
      waitMs: wait,
      hostId: core.clientHostId
    });
    core.reconnectTimer = window.setTimeout(() => {
      core.reconnectTimer = null;
      if (!core.allowClientReconnect || core.state.mode !== 'client') return;
      core.reconnectInFlight = true;
      core.reconnectAttempts += 1;
      logInfo('multiplayer', 'Client reconnect timer fired', {
        attempt: core.reconnectAttempts,
        hostId: core.clientHostId
      });
      publish({
        connectionStatus: 'connecting',
        reconnecting: true,
        audioStatus: 'connecting',
        connectionDetail: 'Reconnecting and gathering fresh ICE candidates...',
        message: 'Reconnecting to the host...'
      });
      void (async () => {
        const directoryRoom = core.clientHostId
          ? await resolveDirectoryRoomCode(core.clientHostId)
          : null;
        return connectClient(directoryRoom ?? inviteCode, true, true);
      })()
        .then(() => {
          core.reconnectInFlight = false;
          if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
        })
        .catch((error) => {
          core.reconnectInFlight = false;
          logWarning('multiplayer', 'Client reconnect attempt will retry', {
            attempt: core.reconnectAttempts,
            error
          });
          scheduleClientReconnect();
        });
    }, wait);
  }

  function clearReconnectTimer(): void {
    if (core.reconnectTimer === null) return;
    window.clearTimeout(core.reconnectTimer);
    core.reconnectTimer = null;
  }

  function handleClientResume(): void {
    if (document.visibilityState === 'hidden') return;
    if (core.state.mode !== 'client' || !core.allowClientReconnect) return;
    if (core.clientPeer && isMultiplayerClientTransportHealthy(
      core.clientPeer.pc.connectionState,
      core.clientPeer.channel?.readyState
    )) {
      logDebug('multiplayer', 'Client resume kept healthy peer', {
        connectionState: core.clientPeer.pc.connectionState,
        channelState: core.clientPeer.channel?.readyState,
        delivery: core.latestDelivery.mode
      });
      // A long-lived background connection can remain healthy while Media Session keeps
      // mobile playback alive. Elapsed hidden time alone is not a reason to replace it.
      clearReconnectTimer();
      applyClientAudioBuffer(core.clientPeer);
      if (core.latestDelivery.mode === 'source-file') void multiplayerSourcePlaybackService.resume();
      else if (core.latestDelivery.mode === 'stream') void resumeAudio();
      return;
    }
    clearReconnectTimer();
    scheduleClientReconnect(0);
  }

  function sendCommand(command: MultiplayerCommandInput): boolean {
    if (core.state.mode !== 'client' || core.state.connectionStatus !== 'connected' || !core.clientPeer) return false;
    const completeCommand = {
      ...command,
      commandId: crypto.randomUUID()
    } as MultiplayerCommand;
    if (core.state.receiveAudio) void resumeAudio();
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    return true;
  }

  async function leave(): Promise<void> {
    if (core.state.mode !== 'client') return;
    logInfo('multiplayer', 'Client left session', { freeplay: core.state.freeplay });
    clearMultiplayerLastSession();
    core.allowClientReconnect = false;
    clearReconnectTimer();
    await core.resetSession(true);
    await multiplayerSourcePlaybackService.endClientSession();
    core.clientHostId = null;
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostVersion: null,
      freeplayPaired: false,
      freeplay: false,
      freeplayQueue: [],
      clients: [],
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: null,
      remoteArtworkResolvedTrackKey: '',
      audioStatus: 'idle',
      remoteDelivery: {
        generationId: 'idle', trackId: null, mode: 'none', reason: 'host-disabled'
      },
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: null,
      message: null
    });
  }

  async function resumeAudio(): Promise<boolean> {
    if (multiplayerSourcePlaybackService.active) {
      const ready = await multiplayerSourcePlaybackService.resume();
      if (core.state.mode === 'client' && core.state.receiveAudio) {
        publish({ audioStatus: ready ? 'playing' : 'blocked' });
      }
      if (core.clientPeer) sendClientPlaybackReadyIfPossible(core.clientPeer);
      return ready;
    }
    if (core.latestDelivery.mode === 'render') {
      multiplayerRenderPlaybackService.resumeAudible();
      if (core.clientPeer) sendClientPlaybackReadyIfPossible(core.clientPeer);
      return true;
    }
    logInfo('multiplayer', 'Remote stream audio resume requested', {
      connectionState: core.clientPeer?.pc.connectionState ?? null,
      channelState: core.clientPeer?.channel?.readyState ?? null
    });
    const ready = await multiplayerAudioService.resumeRemoteAudio();
    transition.setReceiverPipelineReady(ready);
    if (ready && core.state.remoteDelivery.mode === 'stream') {
      multiplayerAudioService.setRemoteAudible(core.state.remotePlayback.snapshot.state === 'playing');
    }
    if (core.clientPeer) sendClientPlaybackReadyIfPossible(core.clientPeer);
    return ready;
  }

  return {
    join,
    joinPaired,
    restoreClientJoin,
    leave,
    sendCommand,
    setFreeplayQueue,
    setReceiveAudio,
    resumeAudio,
    applyClientAudioBuffer,
    handleClientResume,
    clearReceiverMonitor: () => receiverMonitor.clear(),
    clearReconnectTimer,
    resetTransitions: () => {
      cancelSynchronizedStart();
      transition.reset();
      transition.setReceiveAudio(core.state.receiveAudio);
      sourceRetryGenerationId = null;
      sourceRetryCount = 0;
      pendingFreeplayResumeTrackId = null;
      renderReadySentGeneration = null;
      renderReadySentEpoch = -1;
    }
  };
}

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
