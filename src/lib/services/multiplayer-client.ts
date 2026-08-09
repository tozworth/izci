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
import { logError, logInfo } from '$lib/services/logging';
import {
  forgetMultiplayerPairing,
  multiplayerPairings,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import { multiplayerAudioService } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import { resolveMultiplayerConnectionRoute } from './multiplayer-ice';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { getMultiplayerArtworkTrackKey } from './multiplayer-artwork';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  isHostMessage,
  type MultiplayerCommand,
  type MultiplayerCommandInput
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
import {
  createDirectIceSettings,
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
  isMultiplayerClientTransportHealthy,
  isMultiplayerPlaybackPreparationReady,
  cycleMultiplayerRepeatMode,
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
  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
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
    rememberMultiplayerFreeplayState({
      hostId: core.clientHostId,
      queue: core.state.freeplayQueue,
      shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
      repeatMode: core.state.remoteCatalog.repeatMode,
      currentTrackId: core.state.remotePlayback.track?.id
        ?? (previous?.hostId === core.clientHostId ? previous.currentTrackId : null)
    });
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

  async function join(
    rawInviteCode: string,
    options: { silent?: boolean; preserveHostId?: boolean } = {}
  ): Promise<void> {
    logInfo('multiplayer', 'Join requested', { paired: false });
    core.allowClientReconnect = true;
    core.reconnectAttempts = 0;
    if (!options.preserveHostId) core.clientHostId = null;
    multiplayerSourcePlaybackService.beginClientSession((trackId) => {
      if (core.clientPeer && core.state.mode === 'client' && core.state.freeplay) {
        if (core.state.remoteDelivery.mode === 'source-file'
          && core.state.remoteCatalog.repeatMode === 'one') {
          multiplayerSourcePlaybackService.replay();
        } else {
          sendToPeer(core.clientPeer, { kind: 'playback.ended', trackId });
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
    const firebase = await loadFirebase();
    const directory = (await firebase.get(firebase.ref(
      firebase.database,
      `multiplayer/hosts/${hostId}/directory`
    ))).val() as {
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
      const firebase = core.firebaseRuntime ?? await loadFirebase();
      const directory = (await firebase.get(firebase.ref(
        firebase.database,
        `multiplayer/hosts/${hostId}/directory`
      ))).val() as { currentRoom?: string; protocolVersion?: number } | null;
      return directory?.protocolVersion === MULTIPLAYER_PROTOCOL_VERSION
        ? normalizeInviteCode(directory.currentRoom ?? '')
        : null;
    } catch {
      return null;
    }
  }

  async function restoreClientJoin(last: MultiplayerLastSession): Promise<void> {
    core.clientHostId = last.hostId;
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
        generationId: 'idle', trackId: null, mode: 'none', postRaf: false, reason: 'host-disabled'
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
      const firebase = await loadFirebase();
      core.firebaseRuntime = firebase;
      publish({ connectionDetail: 'Looking up the multiplayer session...' });
      const metaRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/meta`);
      const meta = (await firebase.get(metaRef)).val() as {
        protocolVersion?: number;
        hostName?: string;
        turnRelay?: boolean;
      } | null;
      if (!meta || meta.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new Error('That multiplayer session is unavailable or incompatible.');
      }
      publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });
      const turnSettings = meta.turnRelay
        ? await requestTemporaryTurnCredentials(firebase, inviteCode)
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
      core.clientPeer = peer;
      core.pendingClientPlaybackPreparation = null;
      core.clientRemoteAudioReady = false;
      attachClientChannel(peer);
      attachClientMediaChannel(peer);

      const nextPeerRef = firebase.ref(
        firebase.database,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}`
      );
      const clientSignalRef = firebase.ref(
        firebase.database,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/client`
      );
      const disconnect = firebase.onDisconnect(clientSignalRef);
      await disconnect.remove();
      core.ownPeerRef = clientSignalRef;
      core.peerDisconnect = disconnect;

      const offer = enableOpusStereo(await peer.pc.createOffer());
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
      await firebase.set(clientSignalRef, {
        name: peer.name,
        platform: getClientPlatform(),
        description: peer.pc.localDescription?.toJSON(),
        createdAt: Date.now()
      });
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

      core.stopAnswerListener = firebase.onValue(
        nextPeerRef,
        (snapshot) => {
          const signal = snapshot.val() as {
            host?: SignalAnswer;
            hostCandidates?: SignalCandidates;
          } | null;
          const answer = signal?.host;
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
          if (!answer?.description || peer.pc.remoteDescription) return;
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
      if (!message) return;
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
        publish({ remotePlayback: message.playback });
        multiplayerSourcePlaybackService.syncPlayback(message.playback);
        persistFreeplayState();
        loadPendingClientSourceFile(peer);
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'playback.prepare') {
        core.pendingClientPlaybackPreparation = message.preparation;
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'artwork') {
        publish({
          remoteArtwork: message.artwork,
          remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(core.state.remotePlayback.track)
        });
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
          if (!core.state.remotePlayback.track
            && resumeTrackId
            && core.state.freeplayQueue.includes(resumeTrackId)) {
            sendCommand({ type: 'collection.activate', collection: 'playlist', itemId: resumeTrackId });
          }
        }
      }
      if (message.kind === 'delivery') {
        core.latestDelivery = message.delivery;
        publish({ remoteDelivery: message.delivery });
        updateLocalTimelineMode();
        if (message.delivery.mode !== 'stream') core.clientRemoteAudioReady = false;
        if (message.delivery.mode !== 'source-file') core.clientLoadedSourceGenerationId = null;
        if (!core.state.receiveAudio) {
          multiplayerSourcePlaybackService.setEnabled(false);
          publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
        } else if (message.delivery.mode === 'source-file') {
          multiplayerAudioService.clearRemoteTrack();
          multiplayerSourcePlaybackService.setEnabled(true);
          publish({ audioStatus: multiplayerSourcePlaybackService.active ? 'playing' : 'connecting' });
        } else if (message.delivery.mode === 'none') {
          publish({
            audioStatus: 'disabled',
            averageAudioBitrateKbps: null
          });
          multiplayerSourcePlaybackService.clearSourceTrack();
        } else if (core.state.audioStatus === 'disabled') {
          publish({ audioStatus: 'connecting' });
        }
        if (message.delivery.mode === 'stream' && core.state.receiveAudio) {
          multiplayerSourcePlaybackService.clearSourceTrack();
          attachClientRemoteAudio(peer);
        }
        loadPendingClientSourceFile(peer);
        sendClientPlaybackReadyIfPossible(peer);
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
      if (message.kind === 'hello' && message.version !== MULTIPLAYER_PROTOCOL_VERSION) {
        publish({ connectionStatus: 'error', message: 'The host uses an incompatible protocol.' });
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
      setMultiplayerReceiverBuffer(
        event.receiver,
        core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
      );
      receiverMonitor.start(peer);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (!core.state.receiveAudio || core.latestDelivery.mode !== 'stream') {
        event.track.enabled = false;
        publish({
          audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
          averageAudioBitrateKbps: null
        });
        return;
      }
      void multiplayerAudioService.attachRemoteTrack(
        event.track,
        stream,
        (audioStatus) => {
          if (core.state.mode !== 'client') return;
          if (core.latestDelivery.mode !== 'stream'
            && (audioStatus === 'connecting' || audioStatus === 'playing')) return;
          publish({
            audioStatus,
            averageAudioBitrateKbps: audioStatus === 'playing'
              ? core.state.averageAudioBitrateKbps
              : null
          });
          core.clientRemoteAudioReady = audioStatus === 'playing';
          sendClientPlaybackReadyIfPossible(peer);
        }
      );
    };
  }

  function attachClientRemoteAudio(peer: PeerConnection): void {
    if (core.clientPeer !== peer || !core.state.receiveAudio || core.latestDelivery.mode !== 'stream') return;
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') return;
    track.enabled = true;
    void multiplayerAudioService.attachRemoteTrack(track, new MediaStream([track]), (audioStatus) => {
      if (core.state.mode === 'client' && core.state.receiveAudio && core.latestDelivery.mode === 'stream') {
        publish({ audioStatus });
        core.clientRemoteAudioReady = audioStatus === 'playing';
        sendClientPlaybackReadyIfPossible(peer);
      }
    });
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
          multiplayerAudioService.clearRemoteTrack();
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
        loadPendingClientSourceFile(peer);
        return;
      }
      if (!pending || !(event.data instanceof ArrayBuffer)) return;
      if (pending.received + event.data.byteLength > pending.frame.size) {
        pending = null;
        publish({ audioStatus: 'unavailable' });
        return;
      }
      pending.chunks.push(event.data);
      pending.received += event.data.byteLength;
    };
    channel.onclose = () => {
      pending = null;
      if (core.clientPeer === peer && core.latestDelivery.mode === 'source-file') {
        core.clientLoadedSourceGenerationId = null;
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({ audioStatus: 'unavailable' });
      }
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
    void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then((loaded) => {
      if (core.clientPeer !== peer || !core.state.receiveAudio) return;
      const generationStillCurrent = core.state.remoteDelivery.mode === 'source-file'
        && core.state.remoteDelivery.generationId === pending.generationId;
      core.clientLoadedSourceGenerationId = loaded && generationStillCurrent
        ? pending.generationId
        : null;
      publish({
        audioStatus: loaded
          ? generationStillCurrent ? 'playing' : 'connecting'
          : 'unavailable',
        averageAudioBitrateKbps: null
      });
      sendClientPlaybackReadyIfPossible(peer);
    });
  }

  function sendClientPlaybackReadyIfPossible(peer: PeerConnection): void {
    const preparation = core.pendingClientPlaybackPreparation;
    if (!preparation || core.clientPeer !== peer) return;
    const remoteTrackId = core.state.remotePlayback.track?.id ?? null;
    if (!isMultiplayerPlaybackPreparationReady(preparation, {
      remoteTrackId,
      receiveAudio: core.state.receiveAudio,
      loadedSourceTrackId: multiplayerSourcePlaybackService.isTrackReady(preparation.trackId)
        ? preparation.trackId
        : null,
      loadedSourceGenerationId: core.clientLoadedSourceGenerationId,
      streamReady: core.clientRemoteAudioReady
    })) return;
    core.pendingClientPlaybackPreparation = null;
    sendToPeer(peer, {
      kind: 'playback.ready',
      preparationId: preparation.preparationId
    });
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
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      setMultiplayerReceiverBuffer(
        receiver,
        core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
      );
    }
  }

  function setReceiveAudio(enabled: boolean): void {
    if (core.state.receiveAudio === enabled) return;
    writeReceiveAudioPreference(enabled);
    publish({ receiveAudio: enabled });
    if (core.state.mode !== 'client' || !core.clientPeer) return;

    multiplayerSourcePlaybackService.setEnabled(enabled);
    if (!enabled) sendClientPlaybackReadyIfPossible(core.clientPeer);
    if (core.latestDelivery.mode === 'source-file') {
      multiplayerAudioService.clearRemoteTrack();
      publish({
        audioStatus: enabled
          ? multiplayerSourcePlaybackService.active ? 'playing' : 'connecting'
          : 'refused',
        averageAudioBitrateKbps: null
      });
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
      multiplayerAudioService.clearRemoteTrack();
      publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
      return;
    }
    if (core.latestDelivery.mode !== 'stream') {
      publish({ audioStatus: 'disabled' });
      return;
    }
    attachClientRemoteAudio(core.clientPeer);
  }

  function scheduleClientReconnect(delay?: number): void {
    if (!core.allowClientReconnect || core.state.mode !== 'client' || core.reconnectInFlight || core.reconnectTimer !== null) return;
    const inviteCode = core.state.inviteCode;
    if (!inviteCode) return;
    const backoff = [2_000, 5_000, 10_000, 20_000, 30_000];
    const wait = delay ?? backoff[Math.min(core.reconnectAttempts, backoff.length - 1)];
    core.reconnectTimer = window.setTimeout(() => {
      core.reconnectTimer = null;
      if (!core.allowClientReconnect || core.state.mode !== 'client') return;
      core.reconnectInFlight = true;
      core.reconnectAttempts += 1;
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
        .catch(() => {
          core.reconnectInFlight = false;
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
      // A long-lived background connection can remain healthy while Media Session keeps
      // mobile playback alive. Elapsed hidden time alone is not a reason to replace it.
      clearReconnectTimer();
      applyClientAudioBuffer(core.clientPeer);
      if (core.latestDelivery.mode === 'source-file') multiplayerSourcePlaybackService.resume();
      else if (core.latestDelivery.mode === 'stream') void multiplayerAudioService.resumeRemoteAudio();
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
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    if (core.state.freeplay && command.type === 'playlist.shuffle') {
      publish({
        remoteCatalog: {
          ...core.state.remoteCatalog,
          shuffleEnabled: !core.state.remoteCatalog.shuffleEnabled
        }
      });
      persistFreeplayState();
    }
    if (core.state.freeplay && command.type === 'playlist.repeat') {
      publish({
        remoteCatalog: {
          ...core.state.remoteCatalog,
          repeatMode: cycleMultiplayerRepeatMode(core.state.remoteCatalog.repeatMode)
        }
      });
      persistFreeplayState();
    }
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
        generationId: 'idle', trackId: null, mode: 'none', postRaf: false, reason: 'host-disabled'
      },
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: null,
      message: null
    });
  }

  function resumeAudio(): Promise<boolean> {
    return multiplayerSourcePlaybackService.resume()
      ? Promise.resolve(true)
      : multiplayerAudioService.resumeRemoteAudio();
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
    clearReconnectTimer
  };
}
