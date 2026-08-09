import { version as appVersion } from '../../../package.json';
import type { PlaylistItem } from '$lib/types';
import { materializePlaylistItem } from '$lib/stores/playlist-materialization';
import { clearMultiplayerLastSession, rememberMultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import {
  createMultiplayerTurnCredentialResponse,
  createMultiplayerTurnIceSettings,
  hasMultiplayerTurnIssuer,
  isMultiplayerTurnCredentialRequest,
  type MultiplayerTurnCredentialRequest
} from './multiplayer-turn-credentials';
import {
  getMultiplayerArtworkTrackKey,
  loadMultiplayerArtwork
} from './multiplayer-artwork';
import {
  MultiplayerFreeplayPlayer,
  createFreeplayStepResolver,
  type MultiplayerFreeplayPlayerUpdate
} from './multiplayer-freeplay';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  isMultiplayerCommand,
  sanitizePlaylistItem,
  type HostMessage,
  type MultiplayerCatalog,
  type MultiplayerCollection,
  type MultiplayerCommand,
  type MultiplayerDeliveryMode,
  type MultiplayerDeliveryState,
  type MultiplayerPlayback,
  type MultiplayerPlaybackPreparation
} from './multiplayer-protocol';
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
import { flushPeerMedia, transferSourceFile } from './multiplayer-source-transfer';
import { createInviteCode, isSignalOffer, loadFirebase } from './multiplayer-signaling';
import {
  errorMessage,
  cycleMultiplayerRepeatMode,
  getLocalName,
  parseFreeplayRestoredFlags,
  resolveMultiplayerFreeplayAgreement,
  sanitizeFreeplayQueueIds,
  sanitizeClientName,
  sanitizePlatform,
  shouldTransferMultiplayerSourceFile
} from './multiplayer-utils';
import {
  EMPTY_REMOTE_PLAYBACK,
  type CreateMultiplayerSessionOptions,
  type MultiplayerClient,
  type MultiplayerHostSide,
  type MultiplayerHostState,
  type MultiplayerSessionCore,
  type PairedClientRecord,
  type PeerConnection,
  type SignalAnswer,
  type SignalCandidates,
  type SignalOffer,
  type SignalPeerRecord
} from './multiplayer-types';

export function createMultiplayerHostSide(
  core: MultiplayerSessionCore,
  options: Pick<
    CreateMultiplayerSessionOptions,
    'handleHostCommand' | 'pauseHostPlayback' | 'resumeHostPlayback'
  >
): MultiplayerHostSide {
  const { handleHostCommand, pauseHostPlayback, resumeHostPlayback } = options;

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  function updateClient(id: string, patch: Partial<MultiplayerClient>): void {
    core.updateClient(id, patch);
  }

  async function startHosting(options: { silent?: boolean } = {}): Promise<string> {
    const silent = options.silent === true;
    logInfo('multiplayer', 'Hosting requested', {
      maxListeners: core.multiplayerSettings.multiplayerMaxListeners
    });
    core.allowClientReconnect = false;
    await core.resetSession(true);
    publish({
      mode: 'hosting',
      connectionStatus: 'connecting',
      hostName: getLocalName(),
      freeplayPaired: false,
      freeplay: false,
      audioStatus: 'idle',
      connectionDetail: 'Creating a Firebase signaling room...',
      message: null
    });

    try {
      const firebase = await loadFirebase();
      publish({ connectionDetail: 'Publishing the multiplayer room...' });
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
          protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
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
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
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
              disposePeerConnection(peer);
              core.hostPeers.delete(id);
              core.freeplaySelections.delete(id);
              removePeerFromHostPlaybackPreparation(id);
              publish({ clients: core.state.clients.filter((client) => client.id !== id) });
              if (core.firebaseRuntime && core.state.mode === 'hosting') {
                void core.firebaseRuntime.remove(core.firebaseRuntime.ref(
                  core.firebaseRuntime.database,
                  `multiplayer/rooms/${inviteCode}/peers/${id}`
                ));
              }
            }
          }
          for (const [id, peerSignal] of Object.entries(peers ?? {})) {
            if (isMultiplayerTurnCredentialRequest(peerSignal.credentialRequest)
              && !core.answeredTurnCredentialRequestIds.has(peerSignal.credentialRequest.requestId)) {
              void answerTurnCredentialRequest(inviteCode, id, peerSignal.credentialRequest);
            }
            if (!core.hostPeers.has(id)
              && !core.acceptingPeerIds.has(id)
              && isSignalOffer(peerSignal.client)) {
              core.acceptingPeerIds.add(id);
              void acceptClientOffer(
                inviteCode,
                id,
                peerSignal.client,
                peerSignal.clientCandidates ?? {}
              ).finally(() => core.acceptingPeerIds.delete(id));
            } else {
              const peer = core.hostPeers.get(id);
              if (peer) stageRemoteCandidates(peer, peerSignal.clientCandidates ?? {});
            }
          }
        }
      );

      publish({
        mode: 'hosting',
        connectionStatus: 'connected',
        inviteCode: silent ? null : inviteCode,
        connectionDetail: null
      });
      logInfo('multiplayer', 'Hosting started', {
        protocol: MULTIPLAYER_PROTOCOL_VERSION,
        turnRelay: hasMultiplayerTurnIssuer(core.multiplayerSettings)
      });
      rememberMultiplayerLastSession('hosting', { hostName: getLocalName() });
      primeHostState();
      return inviteCode;
    } catch (error) {
      logError('multiplayer', 'Hosting failed', error);
      await core.resetSession(true);
      const message = errorMessage(error, 'Could not start multiplayer hosting.');
      publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        hostVersion: null,
        freeplayPaired: false,
        freeplay: false,
        connectionDetail: message,
        message
      });
      throw new Error(message);
    }
  }

  async function answerTurnCredentialRequest(
    inviteCode: string,
    clientId: string,
    request: MultiplayerTurnCredentialRequest
  ): Promise<void> {
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
      publish({
        message: `Could not issue temporary TURN credentials: ${errorMessage(error, 'credential exchange failed')}`
      });
    }
  }

  async function acceptClientOffer(
    inviteCode: string,
    id: string,
    offer: SignalOffer,
    candidates: SignalCandidates
  ): Promise<void> {
    if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
    if (core.hostPeers.size >= core.multiplayerSettings.multiplayerMaxListeners) {
      if (!core.rejectedPeerIds.has(id)) {
        core.rejectedPeerIds.add(id);
        await core.firebaseRuntime.set(
          core.firebaseRuntime.ref(
            core.firebaseRuntime.database,
            `multiplayer/rooms/${inviteCode}/peers/${id}/host`
          ),
          { error: 'host-full', createdAt: Date.now() } satisfies SignalAnswer
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
    const peer = createPeer(
      id,
      sanitizeClientName(offer.name),
      await createMultiplayerTurnIceSettings(core.multiplayerSettings, `host-${id}`)
    );
    core.hostPeers.set(id, peer);
    void core.firebaseRuntime.remove(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/rooms/${inviteCode}/peers/${id}/credentialResponse`
    ));
    const pairingSnapshot = await core.firebaseRuntime.get(core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/hosts/${core.firebaseRuntime.uid}/paired/${id}`
    ));
    const pairingRecord = pairingSnapshot.val() as Partial<PairedClientRecord> | null;
    peer.paired = pairingSnapshot.exists();
    peer.freeplayPaired = peer.paired && pairingRecord?.freeplay === true;
    updateClient(id, {
      name: peer.name,
      platform: sanitizePlatform(offer.platform),
      status: 'connecting',
      paired: peer.paired,
      freeplayPaired: peer.freeplayPaired,
      freeplay: false
    });

    peer.pc.ondatachannel = (event) => {
      if (event.channel.label === 'izci-media') attachHostMediaChannel(peer, event.channel);
      else attachHostChannel(peer, event.channel);
    };
    peer.pc.onconnectionstatechange = () => {
      const status = peer.pc.connectionState;
      if (status === 'connected') {
        clearPeerConnectionTimer(peer);
        updateClient(id, { status: 'connected' });
        publish({ message: null });
      }
      if (status === 'failed' || status === 'disconnected' || status === 'closed') {
        updateClient(id, { status: 'disconnected' });
        removePeerFromHostPlaybackPreparation(id);
      }
      if (status === 'failed') publish({ message: describeIceFailure(peer, peer.name) });
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
        `${answerPath}Candidates`,
        () => core.firebaseRuntime,
        () => {
          clearPeerConnectionTimer(peer);
          publish({
            message: `Could not send ICE candidates for ${peer.name}. The deployed Firebase rules may be out of date.`
          });
        }
      );
      await peer.pc.setLocalDescription(answer);
      await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
      if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
      await core.firebaseRuntime.set(
        core.firebaseRuntime.ref(core.firebaseRuntime.database, answerPath),
        { description: peer.pc.localDescription?.toJSON(), createdAt: Date.now() }
      );
      startCandidatePublishing();
      startPeerConnectionTimer(peer, () => {
        if (peer.pc.connectionState === 'connected' || core.state.mode !== 'hosting') return;
        updateClient(id, { status: 'disconnected' });
        publish({ message: describeIceFailure(peer, peer.name) });
      });
    } catch (error) {
      disposePeerConnection(peer);
      core.hostPeers.delete(id);
      updateClient(id, { status: 'disconnected' });
      publish({
        message: `Could not finish the connection to ${peer.name}: ${errorMessage(error, 'ICE signaling failed.')}`
      });
    }
  }

  async function togglePairing(clientId: string): Promise<void> {
    if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
    const client = core.state.clients.find((candidate) => candidate.id === clientId);
    const peer = core.hostPeers.get(clientId);
    if (!client || !peer) return;

    const pairingRef = core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/hosts/${core.firebaseRuntime.uid}/paired/${clientId}`
    );
    const paired = !client.paired;
    const freeplayPaired = paired
      && core.multiplayerSettings.multiplayerFreeplay
      && peer.clientFreeplayEnabled;
    if (paired) {
      await core.firebaseRuntime.set(pairingRef, {
        name: client.name,
        platform: client.platform,
        pairedAt: Date.now(),
        freeplay: freeplayPaired
      } satisfies PairedClientRecord);
    } else {
      await core.firebaseRuntime.remove(pairingRef);
    }
    peer.paired = paired;
    peer.freeplayPaired = freeplayPaired;
    await syncPeerFreeplayMode(peer);
  }

  function attachHostChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => {
      clearPeerConnectionTimer(peer);
      updateClient(peer.id, { status: 'connected' });
      sendToPeer(peer, {
        kind: 'hello',
        version: MULTIPLAYER_PROTOCOL_VERSION,
        name: getLocalName(),
        appVersion
      });
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = peer.decode(event.data);
      if (!message) return;
      if (message.kind === 'hello') {
        peer.name = sanitizeClientName(message.name);
        peer.clientFreeplayEnabled = message.freeplayEnabled;
        peer.helloReceived = true;
        updateClient(peer.id, { name: peer.name, platform: sanitizePlatform(message.platform) });
        void syncPeerFreeplayMode(peer);
        return;
      }
      if (message.kind === 'freeplay.preference') {
        peer.clientFreeplayEnabled = message.enabled;
        void syncPeerFreeplayMode(peer);
        return;
      }
      if (message.kind === 'freeplay.queue' && peer.freeplay) {
        peer.freeplayQueue = sanitizeFreeplayQueueIds(message.itemIds);
        peer.freeplayCollection = 'playlist';
        peer.freeplayNavigation?.reset();
        const restored = parseFreeplayRestoredFlags(message);
        if (restored) {
          peer.freeplayShuffle = restored.shuffleEnabled;
          peer.freeplayRepeatMode = restored.repeatMode;
          sendFreeplayState(peer);
        }
        sendFreeplayCatalog(peer);
        return;
      }
      if (message.kind === 'command' && isMultiplayerCommand(message.command)) {
        void Promise.resolve(peer.freeplay
          ? handleFreeplayCommand(peer, message.command)
          : handleHostCommand(message.command, peer))
          .then((accepted) => sendToPeer(peer, {
            kind: 'ack',
            commandId: message.command.commandId,
            accepted
          }))
          .catch(() => sendToPeer(peer, {
            kind: 'ack',
            commandId: message.command.commandId,
            accepted: false,
            message: 'The host could not apply that command.'
          }));
      }
      if (message.kind === 'playback.ready') {
        acceptClientPlaybackReady(peer, message.preparationId);
      }
      if (message.kind === 'playback.ended' && peer.freeplay) {
        const activeTrackId = peer.freeplayPlayer?.track?.id;
        if (activeTrackId === message.trackId) void handleFreeplayTrackEnded(peer, message.trackId);
      }
    };
    channel.onclose = () => {
      updateClient(peer.id, { status: 'disconnected' });
      removePeerFromHostPlaybackPreparation(peer.id);
    };
    sendToPeer(peer, {
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: getLocalName(),
      appVersion
    });
  }

  function attachHostMediaChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.mediaChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => {
      if (peer.freeplaySettled) syncPeerMediaSource(peer);
      else peer.mediaSyncPending = true;
    };
    channel.onbufferedamountlow = () => flushPeerMedia(peer);
    channel.onclose = () => {
      peer.mediaTransferToken += 1;
      peer.mediaOutgoing = [];
      peer.mediaQueuedBytes = 0;
      peer.mediaFlushing = false;
    };
  }

  async function syncPeerFreeplayMode(peer: PeerConnection): Promise<void> {
    if (!core.firebaseRuntime || core.state.mode !== 'hosting') return;
    if (!peer.helloReceived) return;
    const modeToken = ++peer.freeplayModeToken;
    const agreement = resolveMultiplayerFreeplayAgreement({
      paired: peer.paired,
      hostEnabled: core.multiplayerSettings.multiplayerFreeplay,
      clientEnabled: peer.clientFreeplayEnabled
    });
    if (peer.paired && agreement !== peer.freeplayPaired) {
      peer.freeplayPaired = agreement;
      await persistPairingAgreement(peer, agreement);
      if (modeToken !== peer.freeplayModeToken || core.state.mode !== 'hosting') return;
    }
    const active = peer.paired && peer.freeplayPaired && agreement;
    const changed = peer.freeplay !== active;
    peer.freeplay = active;
    if (changed) {
      logInfo(
        'freeplay',
        active ? 'Freeplay activated for peer' : 'Freeplay deactivated for peer',
        { peerId: peer.id }
      );
    }

    if (changed && active) {
      removePeerFromHostPlaybackPreparation(peer.id);
      peer.mediaTransferToken += 1;
      peer.mediaOutgoing = [];
      peer.mediaQueuedBytes = 0;
      peer.sourceTrackKey = '';
      let player: MultiplayerFreeplayPlayer;
      player = new MultiplayerFreeplayPlayer({
        getAudioSettings: (track) => ({
          enabled: core.multiplayerSettings.multiplayerStreamAudio,
          sourceFile: shouldTransferMultiplayerSourceFile(
            track,
            core.multiplayerSettings.multiplayerFileTransferLimitMiB,
            core.multiplayerSettings.multiplayerStreamAudio
          ),
          postRaf: core.multiplayerSettings.multiplayerSendPostRaf
        }),
        onUpdate: (update) => {
          if (peer.freeplayPlayer === player) syncFreeplayPlayerUpdate(peer, update);
        },
        onEnded: (trackId) => {
          if (peer.freeplayPlayer === player) void handleFreeplayTrackEnded(peer, trackId);
        }
      });
      peer.freeplayPlayer = player;
      peer.freeplayNavigation = createFreeplayStepResolver(
        () => freeplayCollectionItems(peer, peer.freeplayCollection)
      );
      await peer.audioSender?.replaceTrack(null).catch(() => undefined);
      const previousSelection = core.freeplaySelections.get(peer.id);
      if (previousSelection) {
        void activateFreeplayTrack(peer, 'playlist', previousSelection.id);
      }
    } else if (changed && !active) {
      peer.freeplayActivationToken += 1;
      peer.freeplayPendingPreparation = null;
      peer.freeplayPlayer?.destroy();
      core.freeplaySelections.delete(peer.id);
      peer.freeplayPlayer = null;
      peer.freeplayNavigation = null;
      peer.freeplayQueue = [];
      peer.freeplayCollection = 'library';
      peer.freeplayShuffle = false;
      peer.freeplayRepeatMode = 'off';
      peer.freeplayDelivery = null;
      peer.freeplayArtwork = null;
      peer.freeplayArtworkTrackKey = '';
      peer.freeplayArtworkResolvedTrackKey = '';
      peer.freeplayArtworkLoadToken += 1;
      peer.sourceTrackKey = '';
      core.freeplaySelections.delete(peer.id);
      syncPeerSourceFile(
        peer,
        core.latestHostState?.track ?? null,
        core.latestDelivery.generationId
      );
      await syncSharedPeerAudio(peer);
    }

    updateClient(peer.id, {
      paired: peer.paired,
      freeplayPaired: peer.freeplayPaired,
      freeplay: active
    });
    peer.freeplaySettled = true;
    if (!active) await syncSharedPeerAudio(peer);
    sendPairingState(peer);
    if (changed || peer.channel?.readyState === 'open') sendCurrentState(peer);
    if (peer.mediaSyncPending || peer.mediaChannel?.readyState === 'open') {
      peer.mediaSyncPending = false;
      syncPeerMediaSource(peer);
    }
  }

  async function persistPairingAgreement(peer: PeerConnection, freeplay: boolean): Promise<void> {
    if (!core.firebaseRuntime || !peer.paired) return;
    const pairingRef = core.firebaseRuntime.ref(
      core.firebaseRuntime.database,
      `multiplayer/hosts/${core.firebaseRuntime.uid}/paired/${peer.id}`
    );
    const client = core.state.clients.find((candidate) => candidate.id === peer.id);
    await core.firebaseRuntime.set(pairingRef, {
      name: client?.name ?? peer.name,
      platform: client?.platform ?? 'Unknown',
      pairedAt: Date.now(),
      freeplay
    } satisfies PairedClientRecord);
  }

  function syncPeerMediaSource(peer: PeerConnection): void {
    if (peer.freeplay) {
      const player = peer.freeplayPlayer;
      syncPeerSourceFile(
        peer,
        player?.delivery === 'source-file' ? player.track : null,
        peer.freeplayDelivery?.generationId ?? null
      );
      return;
    }
    syncPeerSourceFile(
      peer,
      core.latestHostState?.track ?? null,
      core.latestDelivery.generationId
    );
  }

  function sendPairingState(peer: PeerConnection): void {
    if (!core.firebaseRuntime) return;
    sendToPeer(peer, {
      kind: 'pairing',
      paired: peer.paired,
      freeplayPaired: peer.freeplayPaired,
      freeplayActive: peer.freeplay,
      hostId: core.firebaseRuntime.uid,
      name: getLocalName()
    });
  }

  async function syncSharedPeerAudio(peer: PeerConnection): Promise<void> {
    const track = core.latestDelivery.mode === 'stream'
      ? multiplayerAudioService.getHostTrack(core.multiplayerSettings.multiplayerSendPostRaf)
      : null;
    if (peer.audioSender?.track !== track) {
      await peer.audioSender?.replaceTrack(track).catch(() => undefined);
    }
    await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
  }

  function syncFreeplayPlayerUpdate(
    peer: PeerConnection,
    update: MultiplayerFreeplayPlayerUpdate
  ): void {
    if (!peer.freeplay || peer.channel?.readyState !== 'open') return;
    const playback: MultiplayerPlayback = {
      ...update.playback,
      track: update.playback.track ? sanitizePlaylistItem(update.playback.track) : null
    };
    sendToPeer(peer, { kind: 'playback', playback });
    const delivery = ensureFreeplayDelivery(peer, update.delivery, update.postRaf);
    sendToPeer(peer, { kind: 'delivery', delivery });
    const sender = peer.audioSender;
    if (sender?.track !== update.streamTrack) {
      void sender?.replaceTrack(update.streamTrack).then(() => applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps)).catch(() => undefined);
    }
    syncPeerSourceFile(
      peer,
      update.sourceFile ? peer.freeplayPlayer?.track ?? null : null,
      delivery.generationId
    );
    syncFreeplayArtwork(peer, peer.freeplayPlayer?.track ?? null);
  }

  function ensureFreeplayDelivery(
    peer: PeerConnection,
    mode: MultiplayerDeliveryMode,
    postRaf: boolean
  ): MultiplayerDeliveryState {
    const trackId = peer.freeplayPlayer?.track?.id ?? null;
    const previous = peer.freeplayDelivery;
    if (previous
      && previous.trackId === trackId
      && previous.mode === mode
      && previous.postRaf === postRaf) return previous;
    const delivery: MultiplayerDeliveryState = {
      generationId: crypto.randomUUID(),
      trackId,
      mode,
      postRaf: mode === 'stream' && postRaf,
      reason: mode === 'none'
        ? trackId ? 'host-disabled' : 'no-track'
        : null
    };
    peer.freeplayDelivery = delivery;
    peer.freeplayPendingPreparation = null;
    return delivery;
  }

  async function handleFreeplayCommand(
    peer: PeerConnection,
    command: MultiplayerCommand
  ): Promise<boolean> {
    const player = peer.freeplayPlayer;
    if (!player || !core.latestHostState) return false;
    logDebug('freeplay', 'Freeplay command received', {
      peerId: peer.id,
      type: command.type
    });
    switch (command.type) {
      case 'transport.toggle':
        return player.snapshot.state === 'playing' ? player.pause() : player.play();
      case 'transport.play':
        return player.play();
      case 'transport.pause':
        peer.freeplayPendingPreparation = null;
        return player.pause();
      case 'transport.stop':
        peer.freeplayPendingPreparation = null;
        return player.stop();
      case 'transport.previous':
        return stepFreeplayTrack(peer, -1, false);
      case 'transport.next':
        return stepFreeplayTrack(peer, 1, false);
      case 'transport.seek': {
        const duration = player.snapshot.duration;
        return duration <= 0 || command.seconds <= duration + 1
          ? player.seek(command.seconds)
          : false;
      }
      case 'playlist.shuffle':
        peer.freeplayShuffle = !peer.freeplayShuffle;
        peer.freeplayNavigation?.reset();
        sendFreeplayState(peer);
        return true;
      case 'playlist.repeat':
        peer.freeplayRepeatMode = cycleMultiplayerRepeatMode(peer.freeplayRepeatMode);
        sendFreeplayState(peer);
        return true;
      case 'collection.activate':
        return activateFreeplayTrack(peer, command.collection, command.itemId);
    }
  }

  async function activateFreeplayTrack(
    peer: PeerConnection,
    collection: MultiplayerCollection,
    itemId: string
  ): Promise<boolean> {
    if (!core.latestHostState || !peer.freeplayPlayer) return false;
    const items = freeplayCollectionItems(peer, collection);
    const source = items.find((item) => item.id === itemId);
    if (!source) return false;
    const activationToken = ++peer.freeplayActivationToken;
    logInfo('freeplay', 'Freeplay track activation requested', {
      peerId: peer.id,
      collection,
      itemId
    });
    const track = await materializePlaylistItem(source, false);
    if (activationToken !== peer.freeplayActivationToken
      || !track
      || !peer.freeplay
      || !peer.freeplayPlayer) return false;
    if (peer.freeplayCollection !== collection) peer.freeplayNavigation?.reset();
    peer.freeplayCollection = collection;
    core.freeplaySelections.set(peer.id, track);
    peer.freeplayPendingPreparation = null;
    peer.freeplayDelivery = null;
    peer.sourceTrackKey = '';
    const loaded = await peer.freeplayPlayer.load(track, false);
    if (!loaded || !peer.freeplay) {
      logWarning('freeplay', 'Freeplay track activation failed', {
        peerId: peer.id,
        itemId,
        active: peer.freeplay
      });
      return false;
    }
    logInfo('freeplay', 'Freeplay track loaded', {
      peerId: peer.id,
      itemId,
      sourceFile: peer.freeplayPlayer.sourceFile
    });

    if (peer.freeplayPlayer.delivery === 'source-file') {
      beginFreeplayPlaybackPreparation(peer);
      return true;
    }
    if (!core.multiplayerSettings.multiplayerWaitForClients) {
      return peer.freeplayPlayer.play();
    }
    beginFreeplayPlaybackPreparation(peer);
    return true;
  }

  function beginFreeplayPlaybackPreparation(peer: PeerConnection): void {
    const track = peer.freeplayPlayer?.track;
    if (!track || !peer.freeplayPlayer) return;
    const preparation: MultiplayerPlaybackPreparation = {
      preparationId: peer.freeplayDelivery?.generationId ?? crypto.randomUUID(),
      trackId: track.id,
      delivery: peer.freeplayPlayer.delivery
    };
    peer.freeplayPendingPreparation = preparation;
    logInfo('freeplay', 'Freeplay preparation started', {
      peerId: peer.id,
      preparationId: preparation.preparationId,
      trackId: track.id,
      delivery: preparation.delivery
    });
    sendToPeer(peer, { kind: 'playback.prepare', preparation });
  }

  async function stepFreeplayTrack(
    peer: PeerConnection,
    direction: -1 | 1,
    fromEnded: boolean
  ): Promise<boolean> {
    const player = peer.freeplayPlayer;
    if (!player) return false;
    const navigation = peer.freeplayNavigation;
    if (!navigation) return false;
    const next = fromEnded
      ? navigation.resolveEnd({
          currentId: player.track?.id ?? null,
          shuffle: peer.freeplayShuffle,
          repeatMode: peer.freeplayRepeatMode
        })
      : navigation.resolveStep({
          currentId: player.track?.id ?? null,
          direction,
          shuffle: peer.freeplayShuffle,
          wrap: peer.freeplayRepeatMode === 'all'
        });
    if (!next) return true;
    return next ? activateFreeplayTrack(peer, peer.freeplayCollection, next.id) : false;
  }

  async function handleFreeplayTrackEnded(peer: PeerConnection, trackId: string): Promise<void> {
    if (!peer.freeplay || peer.freeplayPlayer?.track?.id !== trackId) return;
    await stepFreeplayTrack(peer, 1, true);
  }

  function freeplayCollectionItems(peer: PeerConnection, collection: MultiplayerCollection): PlaylistItem[] {
    if (!core.latestHostState) return [];
    if (collection === 'playlist') return resolveFreeplayQueueItems(peer);
    return collection === 'favorites' ? core.latestHostState.favorites : core.latestHostState.library;
  }

  function resolveFreeplayQueueItems(peer: PeerConnection): PlaylistItem[] {
    if (!core.latestHostState) return [];
    const byId = new Map<string, PlaylistItem>();
    for (const item of [
      ...core.latestHostState.library,
      ...core.latestHostState.favorites,
      ...core.latestHostState.playlist
    ]) if (!byId.has(item.id)) byId.set(item.id, item);
    return peer.freeplayQueue.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }

  function sendFreeplayCatalog(peer: PeerConnection): void {
    if (!core.latestHostState) return;
    sendToPeer(peer, {
      kind: 'catalog',
      catalog: {
        revision: core.catalogRevision,
        playlist: resolveFreeplayQueueItems(peer).map(sanitizePlaylistItem),
        library: core.latestHostState.library.map(sanitizePlaylistItem),
        favorites: core.latestHostState.favorites.map(sanitizePlaylistItem),
        shuffleEnabled: peer.freeplayShuffle,
        repeatMode: peer.freeplayRepeatMode
      }
    });
  }

  function sendFreeplayState(peer: PeerConnection): void {
    if (!peer.freeplay) return;
    sendToPeer(peer, {
      kind: 'state',
      shuffleEnabled: peer.freeplayShuffle,
      repeatMode: peer.freeplayRepeatMode
    });
  }

  function syncFreeplayArtwork(peer: PeerConnection, track: PlaylistItem | null): void {
    const nextTrackKey = getMultiplayerArtworkTrackKey(track);
    if (nextTrackKey === peer.freeplayArtworkTrackKey) return;
    peer.freeplayArtworkTrackKey = nextTrackKey;
    peer.freeplayArtworkResolvedTrackKey = '';
    peer.freeplayArtwork = null;
    const loadToken = ++peer.freeplayArtworkLoadToken;
    if (!track) {
      peer.freeplayArtworkResolvedTrackKey = nextTrackKey;
      sendToPeer(peer, { kind: 'artwork', artwork: null });
      return;
    }
    void loadMultiplayerArtwork(track).then((artwork) => {
      if (!peer.freeplay
        || loadToken !== peer.freeplayArtworkLoadToken
        || peer.freeplayArtworkTrackKey !== nextTrackKey) return;
      peer.freeplayArtwork = artwork;
      peer.freeplayArtworkResolvedTrackKey = nextTrackKey;
      sendToPeer(peer, { kind: 'artwork', artwork });
    }).catch(() => {
      if (!peer.freeplay || loadToken !== peer.freeplayArtworkLoadToken) return;
      peer.freeplayArtwork = null;
      peer.freeplayArtworkResolvedTrackKey = nextTrackKey;
      sendToPeer(peer, { kind: 'artwork', artwork: null });
    });
  }

  function updateHostState(next: MultiplayerHostState): void {
    let effectiveNext = next;
    if (core.state.mode !== 'hosting') {
      core.latestHostState = next;
      return;
    }

    const nextTrackId = next.track?.id ?? null;
    const shouldGatePlayback = core.multiplayerSettings.multiplayerWaitForClients
      && next.playback.state === 'playing'
      && nextTrackId !== null
      && (core.lastPlaybackSource?.state !== 'playing' || core.lastTrackSource?.id !== nextTrackId)
      && core.bypassHostPlaybackGateTrackId !== nextTrackId
      && connectedHostPeers().length > 0;

    if (core.bypassHostPlaybackGateTrackId === nextTrackId && next.playback.state === 'playing') {
      core.bypassHostPlaybackGateTrackId = null;
    } else if (shouldGatePlayback) {
      pauseHostPlayback();
      effectiveNext = {
        ...next,
        playback: { ...next.playback, state: 'paused' }
      };
    }

    core.latestHostState = effectiveNext;

    const catalogChanged = !core.lastCatalogSources
      || core.lastCatalogSources.playlist !== effectiveNext.playlist
      || core.lastCatalogSources.library !== effectiveNext.library
      || core.lastCatalogSources.favorites !== effectiveNext.favorites
      || core.lastCatalogSources.shuffleEnabled !== effectiveNext.shuffleEnabled
      || core.lastCatalogSources.repeatMode !== effectiveNext.repeatMode;
    if (catalogChanged) {
      core.catalogRevision += 1;
      core.lastCatalogSources = {
        playlist: effectiveNext.playlist,
        library: effectiveNext.library,
        favorites: effectiveNext.favorites,
        shuffleEnabled: effectiveNext.shuffleEnabled,
        repeatMode: effectiveNext.repeatMode
      };
      for (const peer of core.hostPeers.values()) {
        if (!peer.freeplaySettled) continue;
        if (peer.freeplay) sendFreeplayCatalog(peer);
        else sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(effectiveNext) });
      }
    }

    if (core.lastPlaybackSource !== effectiveNext.playback || core.lastTrackSource !== effectiveNext.track) {
      core.lastPlaybackSource = effectiveNext.playback;
      core.lastTrackSource = effectiveNext.track;
      broadcastShared({ kind: 'playback', playback: buildPlayback(effectiveNext) });
    }

    syncHostArtwork(effectiveNext.track);
    syncHostAudio(effectiveNext.track);
    syncHostSourceFiles(effectiveNext.track);
    if (shouldGatePlayback) beginHostPlaybackPreparation(nextTrackId);
  }

  function connectedHostPeers(): PeerConnection[] {
    return Array.from(core.hostPeers.values()).filter(
      (peer) => !peer.freeplay && peer.channel?.readyState === 'open'
    );
  }

  function beginHostPlaybackPreparation(trackId: string): void {
    const peers = connectedHostPeers();
    if (peers.length === 0) {
      core.bypassHostPlaybackGateTrackId = trackId;
      resumeHostPlayback();
      return;
    }
    const preparation: MultiplayerPlaybackPreparation = {
      preparationId: core.latestDelivery.generationId,
      trackId,
      delivery: core.latestDelivery.mode
    };
    core.hostPlaybackPreparation = {
      preparation,
      pendingPeerIds: new Set(peers.map((peer) => peer.id))
    };
    for (const peer of peers) {
      sendToPeer(peer, { kind: 'playback.prepare', preparation });
    }
  }

  function acceptClientPlaybackReady(peer: PeerConnection, preparationId: string): void {
    const freeplayPreparation = peer.freeplayPendingPreparation;
    if (peer.freeplay && freeplayPreparation?.preparationId === preparationId) {
      peer.freeplayPendingPreparation = null;
      void peer.freeplayPlayer?.play();
      return;
    }
    const pending = core.hostPlaybackPreparation;
    if (!pending || pending.preparation.preparationId !== preparationId) return;
    pending.pendingPeerIds.delete(peer.id);
    if (pending.pendingPeerIds.size === 0) releasePreparedHostPlayback();
  }

  function removePeerFromHostPlaybackPreparation(peerId: string): void {
    const pending = core.hostPlaybackPreparation;
    if (!pending || !pending.pendingPeerIds.delete(peerId)) return;
    if (pending.pendingPeerIds.size === 0) releasePreparedHostPlayback();
  }

  function releasePreparedHostPlayback(): void {
    const pending = core.hostPlaybackPreparation;
    if (!pending) return;
    core.hostPlaybackPreparation = null;
    if (core.state.mode !== 'hosting'
      || core.latestHostState?.track?.id !== pending.preparation.trackId
      || core.latestHostState.playback.state === 'playing') return;
    core.bypassHostPlaybackGateTrackId = pending.preparation.trackId;
    resumeHostPlayback();
  }

  function cancelPendingPlayback(): boolean {
    if (!core.hostPlaybackPreparation) return false;
    core.hostPlaybackPreparation = null;
    core.bypassHostPlaybackGateTrackId = null;
    return true;
  }

  function primeHostState(): void {
    if (!core.latestHostState) return;
    core.catalogRevision += 1;
    core.lastCatalogSources = {
      playlist: core.latestHostState.playlist,
      library: core.latestHostState.library,
      favorites: core.latestHostState.favorites,
      shuffleEnabled: core.latestHostState.shuffleEnabled,
      repeatMode: core.latestHostState.repeatMode
    };
    core.lastPlaybackSource = core.latestHostState.playback;
    core.lastTrackSource = core.latestHostState.track;
    syncHostArtwork(core.latestHostState.track);
    syncHostAudio(core.latestHostState.track);
    syncHostSourceFiles(core.latestHostState.track);
  }

  function sendCurrentState(peer: PeerConnection): void {
    if (!core.latestHostState) return;
    if (peer.freeplay) {
      sendFreeplayCatalog(peer);
      sendFreeplayState(peer);
      const player = peer.freeplayPlayer;
      sendToPeer(peer, {
        kind: 'playback',
        playback: player
          ? {
              ...player.playback,
              track: player.track ? sanitizePlaylistItem(player.track) : null
            }
          : EMPTY_REMOTE_PLAYBACK
      });
      const delivery = peer.freeplayDelivery ?? ensureFreeplayDelivery(
        peer,
        player?.delivery ?? 'none',
        player?.postRaf ?? false
      );
      sendToPeer(peer, { kind: 'delivery', delivery });
      sendToPeer(peer, { kind: 'buffer', bufferMs: core.multiplayerSettings.multiplayerAudioBufferMs });
      if (peer.freeplayArtworkResolvedTrackKey === peer.freeplayArtworkTrackKey) {
        sendToPeer(peer, { kind: 'artwork', artwork: peer.freeplayArtwork });
      }
      if (peer.freeplayPendingPreparation) {
        sendToPeer(peer, {
          kind: 'playback.prepare',
          preparation: peer.freeplayPendingPreparation
        });
      }
      return;
    }
    sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(core.latestHostState) });
    sendToPeer(peer, { kind: 'playback', playback: buildPlayback(core.latestHostState) });
    if (core.hostArtworkResolvedTrackKey === core.hostArtworkTrackKey) {
      sendToPeer(peer, { kind: 'artwork', artwork: core.latestHostArtwork });
    }
    sendToPeer(peer, { kind: 'delivery', delivery: core.latestDelivery });
    sendToPeer(peer, { kind: 'buffer', bufferMs: core.multiplayerSettings.multiplayerAudioBufferMs });
    if (core.hostPlaybackPreparation) {
      core.hostPlaybackPreparation.pendingPeerIds.add(peer.id);
      sendToPeer(peer, {
        kind: 'playback.prepare',
        preparation: core.hostPlaybackPreparation.preparation
      });
    }
  }

  function syncHostAudio(track: PlaylistItem | null): void {
    const sourceFile = shouldTransferMultiplayerSourceFile(
      track,
      core.multiplayerSettings.multiplayerFileTransferLimitMiB,
      core.multiplayerSettings.multiplayerStreamAudio
    );
    const mode: MultiplayerDeliveryMode = !track
      ? 'none'
      : !core.multiplayerSettings.multiplayerStreamAudio
      ? 'none'
      : sourceFile ? 'source-file' : 'stream';
    const enabled = mode === 'stream';
    const trackId = track?.id ?? null;
    const postRaf = enabled && core.multiplayerSettings.multiplayerSendPostRaf;
    const changed = core.latestDelivery.trackId !== trackId
      || core.latestDelivery.mode !== mode
      || core.latestDelivery.postRaf !== postRaf;
    const nextDelivery: MultiplayerDeliveryState = changed
      ? {
          generationId: crypto.randomUUID(),
          trackId,
          mode,
          postRaf,
          reason: mode === 'none'
            ? track ? 'host-disabled' : 'no-track'
            : null
        }
      : core.latestDelivery;
    multiplayerAudioService.setHostAudible(enabled);

    if (enabled) {
      const hostTrack = multiplayerAudioService.getHostTrack(core.multiplayerSettings.multiplayerSendPostRaf);
      for (const peer of core.hostPeers.values()) {
        if (!peer.freeplaySettled || peer.freeplay) continue;
        if (peer.audioSender?.track !== hostTrack) {
          void peer.audioSender?.replaceTrack(hostTrack).catch(() => undefined);
        }
        void applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
      }
    } else {
      for (const peer of core.hostPeers.values()) {
        if (!peer.freeplaySettled || peer.freeplay) continue;
        if (peer.audioSender?.track) void peer.audioSender.replaceTrack(null).catch(() => undefined);
      }
    }

    if (changed) {
      core.latestDelivery = nextDelivery;
      broadcastShared({ kind: 'delivery', delivery: nextDelivery });
    }
  }

  function syncHostSourceFiles(track: PlaylistItem | null): void {
    for (const peer of core.hostPeers.values()) {
      if (peer.freeplaySettled && !peer.freeplay) {
        syncPeerSourceFile(peer, track, core.latestDelivery.generationId);
      }
    }
  }

  function syncPeerSourceFile(
    peer: PeerConnection,
    track: PlaylistItem | null,
    generationId: string | null
  ): void {
    const channel = peer.mediaChannel;
    const shouldTransfer = shouldTransferMultiplayerSourceFile(
      track,
      core.multiplayerSettings.multiplayerFileTransferLimitMiB,
      core.multiplayerSettings.multiplayerStreamAudio
    );
    const key = shouldTransfer && track
      ? `${track.id}:${track.size}:${track.lastModified}`
      : '';
    if (!channel || channel.readyState !== 'open' || peer.sourceTrackKey === key) return;

    peer.mediaTransferToken += 1;
    peer.mediaOutgoing = [];
    peer.mediaQueuedBytes = 0;
    peer.sourceTrackKey = key;
    if (!shouldTransfer || !track?.file || !generationId) return;
    const token = peer.mediaTransferToken;
    void transferSourceFile(peer, track, track.file, token, generationId).catch(() => undefined);
  }

  function syncHostArtwork(track: PlaylistItem | null): void {
    const nextTrackKey = getMultiplayerArtworkTrackKey(track);
    if (nextTrackKey === core.hostArtworkTrackKey) return;

    core.hostArtworkTrackKey = nextTrackKey;
    core.hostArtworkResolvedTrackKey = '';
    core.latestHostArtwork = null;
    const loadToken = ++core.hostArtworkLoadToken;

    if (!track) {
      core.hostArtworkResolvedTrackKey = nextTrackKey;
      broadcastShared({ kind: 'artwork', artwork: null });
      return;
    }

    void loadMultiplayerArtwork(track).then((artwork) => {
      if (loadToken !== core.hostArtworkLoadToken || core.hostArtworkTrackKey !== nextTrackKey) return;
      core.latestHostArtwork = artwork;
      core.hostArtworkResolvedTrackKey = nextTrackKey;
      broadcastShared({ kind: 'artwork', artwork });
    }).catch(() => {
      if (loadToken !== core.hostArtworkLoadToken || core.hostArtworkTrackKey !== nextTrackKey) return;
      core.latestHostArtwork = null;
      core.hostArtworkResolvedTrackKey = nextTrackKey;
      broadcastShared({ kind: 'artwork', artwork: null });
    });
  }

  function buildCatalog(source: MultiplayerHostState): MultiplayerCatalog {
    return {
      revision: core.catalogRevision,
      playlist: source.playlist.map(sanitizePlaylistItem),
      library: source.library.map(sanitizePlaylistItem),
      favorites: source.favorites.map(sanitizePlaylistItem),
      shuffleEnabled: source.shuffleEnabled,
      repeatMode: source.repeatMode
    };
  }

  function buildPlayback(source: MultiplayerHostState): MultiplayerPlayback {
    return {
      snapshot: { ...source.playback },
      track: source.track ? sanitizePlaylistItem(source.track) : null,
      sentAt: Date.now()
    };
  }

  function broadcastShared(message: HostMessage): void {
    for (const peer of core.hostPeers.values()) {
      if (peer.freeplaySettled && !peer.freeplay) sendToPeer(peer, message);
    }
  }

  async function kick(clientId: string): Promise<void> {
    if (core.state.mode !== 'hosting') return;
    logInfo('multiplayer', 'Client kick requested', { clientId });
    const peer = core.hostPeers.get(clientId);
    if (peer) {
      clearPeerConnectionTimer(peer);
      sendToPeer(peer, { kind: 'kicked' });
      window.setTimeout(() => disposePeerConnection(peer), 80);
      core.freeplaySelections.delete(clientId);
      core.hostPeers.delete(clientId);
      removePeerFromHostPlaybackPreparation(clientId);
    }
    publish({ clients: core.state.clients.filter((client) => client.id !== clientId) });
    const roomCode = core.roomCode ?? core.state.inviteCode;
    if (core.firebaseRuntime && roomCode) {
      await core.firebaseRuntime.remove(core.firebaseRuntime.ref(
        core.firebaseRuntime.database,
        `multiplayer/rooms/${roomCode}/peers/${clientId}`
      ));
    }
  }

  async function stopHosting(): Promise<void> {
    if (core.state.mode !== 'hosting') return;
    logInfo('multiplayer', 'Hosting stopped');
    clearMultiplayerLastSession();
    core.allowClientReconnect = false;
    await core.resetSession(true);
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostVersion: null,
      freeplayPaired: false,
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

  return {
    startHosting,
    stopHosting,
    kick,
    togglePairing,
    updateHostState,
    cancelPendingPlayback,
    syncHostAudio,
    syncHostSourceFiles,
    syncPeerFreeplayMode,
    beginFreeplayPlaybackPreparation,
    releasePreparedHostPlayback,
    beginHostPlaybackPreparation
  };
}
