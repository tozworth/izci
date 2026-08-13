import { version as appVersion } from '../../../package.json';
import type { MediaEntity } from '$lib/contracts/catalog';
import { materializeMediaEntity } from '$lib/stores/playlist-materialization';
import { clearMultiplayerLastSession, rememberMultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { logDebug, logError, logInfo, logWarning } from '$lib/logging/api';
import { multiplayerAudioService } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import { buildRenderCacheKey } from './multiplayer-render-cache';
import {
  flushPeerRender,
  resetPeerRenderQueue,
  schedulePeerRender
} from './multiplayer-render-transfer';
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
  projectMultiplayerPlaybackSnapshot,
  sanitizeMediaEntity
} from './multiplayer-host-projection';
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
import { clientStartTime, estimateMultiplayerClock } from './multiplayer-sync';
import {
  createInviteCode,
  isNewSignalOfferForPeer,
  isSignalOffer,
  loadFirebase
} from './multiplayer-signaling';
import {
  errorMessage,
  cycleMultiplayerRepeatMode,
  getLocalName,
  parseFreeplayRestoredFlags,
  resolveMultiplayerDeliveryMode,
  resolveMultiplayerFreeplayAgreement,
  sanitizeFreeplayQueueIds,
  sanitizeClientName,
  sanitizePlatform
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
            }
          }
          for (const [id, peerSignal] of Object.entries(peers ?? {})) {
            if (isMultiplayerTurnCredentialRequest(peerSignal.credentialRequest)
              && !core.answeredTurnCredentialRequestIds.has(peerSignal.credentialRequest.requestId)) {
              void answerTurnCredentialRequest(inviteCode, id, peerSignal.credentialRequest);
            }
            const peer = core.hostPeers.get(id);
            if (isNewSignalOfferForPeer(peerSignal.client, peer?.signalingCreatedAt ?? null)
              && !core.acceptingPeerIds.has(id)
            ) {
              core.acceptingPeerIds.add(id);
              void acceptClientOffer(
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
      disposePeerConnection(previousPeer);
      removePeerFromHostPlaybackPreparation(id);
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
      else if (event.channel.label === 'izci-render') attachHostRenderChannel(peer, event.channel);
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
        { description: peer.pc.localDescription?.toJSON(), createdAt: offer.createdAt }
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
        acceptClientPlaybackReady(peer, message.generationId);
      }
      if (message.kind === 'clock.pong') {
        acceptClientClockSample(peer, message);
      }
      if (message.kind === 'playback.ended' && peer.freeplay) {
        const activeTrackId = peer.freeplayPlayer?.track?.id;
        if (activeTrackId === message.trackId
          && peer.freeplayDelivery?.generationId === message.generationId) {
          void handleFreeplayTrackEnded(peer, message.trackId);
        }
      }
      if (message.kind === 'source.retry') {
        const delivery = peer.freeplay ? peer.freeplayDelivery : core.latestDelivery;
        if (delivery?.mode === 'source-file' && delivery.generationId === message.generationId) {
          peer.sourceTrackKey = '';
          syncPeerMediaSource(peer);
        }
      }
      if (message.kind === 'render.need') {
        handlePeerRenderNeed(peer, message.need);
      }
      if (message.kind === 'render.ready') {
        acceptClientRenderReady(peer, message);
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
      peer.sourceTrackKey = '';
      if (peer.pc.connectionState !== 'closed') peer.pc.close();
    };
  }

  function attachHostRenderChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.renderChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 128 * 1024;
    channel.onopen = () => {
      if (peer.freeplaySettled) syncPeerMediaSource(peer);
      else peer.mediaSyncPending = true;
      // A renderState created before this channel opened never got its batch
      // (schedulePeerRender skips a non-open channel and syncPeerMediaSource
      // early-returns for an existing generation). Flush it now.
      if (peer.renderState) schedulePeerRender(peer, playheadMsForPeer(peer));
    };
    channel.onbufferedamountlow = () => {
      // The render queue is a real backlog: schedulePeerRender gates on
      // renderQueuedBytes >= HIGH_WATER, so it can NOT be the drain trigger.
      // Flush the pending frames first, then re-plan for more clusters.
      flushPeerRender(peer);
      schedulePeerRender(peer, playheadMsForPeer(peer));
    };
    channel.onclose = () => {
      const state = peer.renderState;
      if (state) {
        multiplayerRenderCoordinator.unpin(state.key);
        peer.renderState = null;
      }
      resetPeerRenderQueue(peer);
      if (peer.pc.connectionState !== 'closed') peer.pc.close();
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
          delivery: core.renderFallbackTrackIds.has(track.id)
            ? 'source-file'
            : resolveMultiplayerDeliveryMode(
                track,
                core.multiplayerSettings.multiplayerStreamAudio,
                core.multiplayerSettings.multiplayerFileTransferLimitMiB
              )
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
      // The stable wire only matters for streamed (video) Freeplay; buffered
      // Opus peers do not need it. A missing wire must not kill the session.
      const wireTrack = await player.ensureWire().catch(() => null);
      if (peer.freeplayPlayer !== player || !peer.freeplay) return;
      try {
        if (wireTrack && peer.audioSender) {
          await peer.audioSender.replaceTrack(wireTrack);
          await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
          logInfo('freeplay', 'Freeplay stable wire attached', {
            peerId: peer.id,
            trackId: wireTrack.id
          });
        }
      } catch (error) {
        logWarning('freeplay', 'Freeplay stable wire attach failed', {
          peerId: peer.id,
          error
        });
        player.destroy();
        peer.freeplayPlayer = null;
        peer.pc.close();
        return;
      }
      const previousSelection = core.freeplaySelections.get(peer.id);
      if (previousSelection) {
        void activateFreeplayTrack(peer, 'playlist', previousSelection.id);
      } else {
        // No restored selection (host restart wipes freeplaySelections): the
        // idle player never publishes, so a reconnecting client holding a
        // stale remote track would never re-evaluate its persisted selection
        // (tryResumeFreeplaySelection only fires on playback messages). Publish
        // the idle state once: the client sees track null and sends
        // collection.activate for its remembered track.
        syncFreeplayPlayerUpdate(peer, {
          playback: player.playback,
          delivery: player.delivery
        });
      }
    } else if (changed && !active) {
      peer.freeplayActivation = null;
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
      if (peer.renderState) {
        multiplayerRenderCoordinator.unpin(peer.renderState.key);
        peer.renderState = null;
        resetPeerRenderQueue(peer);
      }
      core.freeplaySelections.delete(peer.id);
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
      const track = peer.freeplayPlayer?.track ?? null;
      const mode = peer.freeplayPlayer?.delivery ?? 'none';
      const generationId = peer.freeplayDelivery?.generationId ?? null;
      if (mode === 'render') {
        syncPeerRenderSource(peer, track, generationId);
      } else {
        syncPeerRenderSource(peer, null, null);
        if (mode === 'source-file' && track && generationId) {
          syncPeerSourceFile(peer, track, generationId);
        }
      }
      return;
    }
    const track = core.latestHostState?.track ?? null;
    const mode = core.latestDelivery.mode;
    const generationId = core.latestDelivery.generationId;
    if (mode === 'render') {
      syncPeerRenderSource(peer, track, generationId);
    } else {
      syncPeerRenderSource(peer, null, null);
      if (mode === 'source-file' && track && generationId) {
        syncPeerSourceFile(peer, track, generationId);
      }
    }
  }

  function syncPeerRenderSource(
    peer: PeerConnection,
    track: MediaEntity | null,
    generationId: string | null
  ): void {
    const previous = peer.renderState;
    if (!track || !generationId) {
      if (previous) {
        multiplayerRenderCoordinator.unpin(previous.key);
        peer.renderState = null;
        resetPeerRenderQueue(peer);
      }
      return;
    }
    if (previous && previous.generationId === generationId) return;
    if (previous) multiplayerRenderCoordinator.unpin(previous.key);
    peer.renderState = null;
    resetPeerRenderQueue(peer);

    const bitrateKbps = core.multiplayerSettings.multiplayerOpusBitrateKbps;
    const key = buildRenderCacheKey(track, bitrateKbps);
    void materializeMediaEntity(track, false, 'file-read').then((lease) => {
      if (!lease) throw new Error('No source file available for rendering.');
      return multiplayerRenderCoordinator.acquireRender(lease, bitrateKbps)
        .finally(() => lease.release());
    }).then((render) => {
      if (peer.renderState
        || core.state.mode !== 'hosting'
        || peer.renderChannel?.readyState !== 'open'
        || !renderStillCurrent(peer, track, generationId)) {
        multiplayerRenderCoordinator.unpin(key);
        return;
      }
      const bufferMs = effectiveRenderBufferMs();
      peer.renderState = {
        generationId,
        renderId: render.renderId,
        key,
        render,
        epoch: 0,
        // A fresh peer (reconnect / new listener) joins the generation at the
        // current playhead, not at the beginning of the track. The initial
        // batch must cover the host position or the client starts from 0 and
        // gap-crawls toward it.
        targetTimeMs: playheadMsForPeer(peer),
        aheadMs: bufferMs,
        protectionMs: bufferMs,
        receivedRanges: [],
        sent: new Set(),
        initSent: false
      };
      sendToPeer(peer, { kind: 'render.manifest', manifest: { ...render.manifest, generationId } });
      schedulePeerRender(peer, playheadMsForPeer(peer));
    }).catch((error) => {
      if (core.state.mode !== 'hosting' || !track) return;
      if (!renderStillCurrent(peer, track, generationId)) return;
      logWarning('multiplayer', 'Buffered Opus render failed; sending the source file instead', {
        peerId: peer.id,
        trackId: track.id,
        error: errorMessage(error, 'render failed')
      });
      core.renderFallbackTrackIds.add(track.id);
      if (peer.freeplay) {
        void peer.freeplayPlayer?.reconfigure().then((shouldResume) => {
          if (!peer.freeplay || !peer.freeplayPlayer?.track) return;
          if (shouldResume) beginFreeplayPlaybackPreparation(peer);
        });
      } else {
        syncHostAudio(core.latestHostState?.track ?? null);
        syncHostSourceFiles(core.latestHostState?.track ?? null);
      }
    });
  }

  function syncPeerSourceFile(
    peer: PeerConnection,
    track: MediaEntity | null,
    generationId: string | null
  ): void {
    const channel = peer.mediaChannel;
    const key = track && generationId
      ? `${generationId}:${track.id}:${track.size}:${track.lastModified}`
      : '';
    if (!channel || channel.readyState !== 'open' || peer.sourceTrackKey === key) return;

    peer.mediaTransferToken += 1;
    peer.mediaOutgoing = [];
    peer.mediaQueuedBytes = 0;
    peer.sourceTrackKey = key;
    if (!track || !generationId) return;
    const token = peer.mediaTransferToken;
    void materializeMediaEntity(track, false, 'file-read').then(async (lease) => {
      if (!lease) return;
      try {
        await transferSourceFile(peer, track, lease.file, token, generationId);
      } finally {
        lease.release();
      }
    }).catch((error) => {
      logWarning('multiplayer', 'Source-file transfer failed', {
        peerId: peer.id,
        generationId,
        error
      });
    });
  }

  function renderStillCurrent(
    peer: PeerConnection,
    track: MediaEntity,
    generationId: string
  ): boolean {
    if (peer.freeplay) {
      return peer.freeplayPlayer?.delivery === 'render'
        && peer.freeplayPlayer.track?.id === track.id
        && peer.freeplayDelivery?.generationId === generationId;
    }
    return core.latestDelivery.mode === 'render'
      && core.latestHostState?.track?.id === track.id
      && core.latestDelivery.generationId === generationId;
  }

  function handlePeerRenderNeed(
    peer: PeerConnection,
    need: import('./multiplayer-protocol').MultiplayerRenderNeed
  ): void {
    const expectedGeneration = peer.freeplay
      ? peer.freeplayDelivery?.generationId
      : core.latestDelivery.generationId;
    const state = peer.renderState;
    if (!state || state.generationId !== need.generationId || expectedGeneration !== need.generationId) return;
    if (state.renderId !== need.renderId) return;
    if (state.epoch !== need.epoch) {
      state.sent = new Set();
      resetPeerRenderQueue(peer);
    }
    // The init rides the unordered render channel and can beat the manifest
    // (ordered control channel); a client that dropped it would otherwise
    // never see it again. Re-send on every need — the client dedups
    // post-append init frames.
    state.initSent = false;
    state.epoch = need.epoch;
    state.targetTimeMs = Math.max(0, need.targetTimeMs);
    state.aheadMs = Math.max(0, need.aheadMs);
    state.receivedRanges = need.ranges;
    schedulePeerRender(peer, playheadMsForPeer(peer));
  }

  function playheadMsForPeer(peer: PeerConnection): number {
    const seconds = peer.freeplay
      ? peer.freeplayPlayer?.snapshot.currentTime ?? 0
      : core.latestHostState?.playback.currentTime ?? 0;
    return Math.max(0, seconds * 1_000);
  }

  function effectiveRenderBufferMs(): number {
    return core.multiplayerSettings.multiplayerAudioBufferMs;
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
      ? multiplayerAudioService.getHostTrack()
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
    const delivery = ensureFreeplayDelivery(peer, update.delivery);
    sendToPeer(peer, { kind: 'delivery', delivery });
    const playback: MultiplayerPlayback = {
      ...update.playback,
      generationId: delivery.generationId,
      snapshot: projectMultiplayerPlaybackSnapshot(update.playback.snapshot),
      track: update.playback.track
    };
    sendToPeer(peer, { kind: 'playback', playback });
    syncPeerMediaSource(peer);
    syncFreeplayArtwork(peer, peer.freeplayPlayer?.track ?? null);
  }

  function ensureFreeplayDelivery(
    peer: PeerConnection,
    mode: MultiplayerDeliveryMode
  ): MultiplayerDeliveryState {
    const trackId = peer.freeplayPlayer?.track?.id ?? null;
    const previous = peer.freeplayDelivery;
    if (previous
      && previous.trackId === trackId
      && previous.mode === mode) return previous;
    const delivery: MultiplayerDeliveryState = {
      generationId: crypto.randomUUID(),
      trackId,
      mode,
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
        if (peer.freeplayActivation) {
          peer.freeplayActivation.autoPlay = !peer.freeplayActivation.autoPlay;
          return true;
        }
        if (player.snapshot.state === 'playing') return player.pause();
        beginFreeplayPlaybackPreparation(peer);
        return true;
      case 'transport.play':
        if (peer.freeplayActivation) {
          peer.freeplayActivation.autoPlay = true;
          return true;
        }
        beginFreeplayPlaybackPreparation(peer);
        return true;
      case 'transport.pause':
        if (peer.freeplayActivation) peer.freeplayActivation.autoPlay = false;
        peer.freeplayPendingPreparation = null;
        return player.pause();
      case 'transport.stop':
        if (peer.freeplayActivation) peer.freeplayActivation.autoPlay = false;
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
    const activation = {
      autoPlay: true
    };
    peer.freeplayActivation = activation;
    logInfo('freeplay', 'Freeplay track activation requested', {
      peerId: peer.id,
      collection,
      itemId
    });
    peer.freeplayPendingPreparation = null;
    // Silence the stable wire before file materialization. This gives the
    // continuously consuming receiver route the entire load interval to drain
    // prior audio while leaving source-file clients on their local timeline.
    peer.freeplayPlayer.pause();
    const track = await materializeMediaEntity(source, false, source.kind === 'module' ? 'file-read' : 'media-element');
    if (peer.freeplayActivation !== activation
      || !track
      || !peer.freeplay
      || !peer.freeplayPlayer) {
      track?.release();
      if (peer.freeplayActivation === activation) peer.freeplayActivation = null;
      return false;
    }
    if (peer.freeplayCollection !== collection) peer.freeplayNavigation?.reset();
    peer.freeplayCollection = collection;
    core.freeplaySelections.set(peer.id, track.entity);
    peer.freeplayPendingPreparation = null;
    peer.freeplayDelivery = null;
    peer.sourceTrackKey = '';
    const loaded = await peer.freeplayPlayer.load(track, false);
    if (peer.freeplayActivation !== activation || !loaded || !peer.freeplay) {
      if (peer.freeplayActivation === activation) peer.freeplayActivation = null;
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
      delivery: peer.freeplayPlayer.delivery
    });

    const autoPlay = activation.autoPlay;
    peer.freeplayActivation = null;
    if (!autoPlay) return true;
    // The stable receiver route must be ready before a streamed renderer starts;
    // source-file delivery uses the same generation ack only to confirm that the
    // complete file is locally loadable. Its host timeline remains passive.
    beginFreeplayPlaybackPreparation(peer);
    return true;
  }

  function beginFreeplayPlaybackPreparation(peer: PeerConnection): void {
    const track = peer.freeplayPlayer?.track;
    if (!track || !peer.freeplayPlayer) return;
    const preparation: MultiplayerPlaybackPreparation = {
      generationId: peer.freeplayDelivery?.generationId ?? crypto.randomUUID(),
      trackId: track.id,
      delivery: peer.freeplayPlayer.delivery
    };
    peer.freeplayPendingPreparation = preparation;
    logInfo('freeplay', 'Freeplay preparation started', {
      peerId: peer.id,
      generationId: preparation.generationId,
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

  function freeplayCollectionItems(peer: PeerConnection, collection: MultiplayerCollection): MediaEntity[] {
    if (!core.latestHostState) return [];
    if (collection === 'playlist') return resolveFreeplayQueueItems(peer);
    return collection === 'favorites' ? core.latestHostState.favorites : core.latestHostState.library;
  }

  function resolveFreeplayQueueItems(peer: PeerConnection): MediaEntity[] {
    if (!core.latestHostState) return [];
    const byId = new Map<string, MediaEntity>();
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
        playlist: resolveFreeplayQueueItems(peer).map(sanitizeMediaEntity),
        library: core.latestHostState.library.map(sanitizeMediaEntity),
        favorites: core.latestHostState.favorites.map(sanitizeMediaEntity),
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

  function syncFreeplayArtwork(peer: PeerConnection, track: MediaEntity | null): void {
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
    const synchronizedPlayback = core.multiplayerSettings.multiplayerSynchronizedPlayback
      && core.multiplayerSettings.multiplayerStreamAudio
      && !core.multiplayerSettings.multiplayerFreeplay;
    const shouldGatePlayback = (core.multiplayerSettings.multiplayerWaitForClients
      || synchronizedPlayback)
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

    // Delivery is published first so ordered data channels never expose a
    // playback snapshot without its generation contract.
    syncHostAudio(effectiveNext.track);
    if (core.lastPlaybackSource !== effectiveNext.playback || core.lastTrackSource !== effectiveNext.track) {
      core.lastPlaybackSource = effectiveNext.playback;
      core.lastTrackSource = effectiveNext.track;
      broadcastShared({ kind: 'playback', playback: buildPlayback(effectiveNext) });
    }

    syncHostArtwork(effectiveNext.track);
    syncHostSourceFiles(effectiveNext.track);
    if (shouldGatePlayback) beginHostPlaybackPreparation(nextTrackId);
  }

  function connectedHostPeers(): PeerConnection[] {
    return Array.from(core.hostPeers.values()).filter(
      (peer) => !peer.freeplay && peer.channel?.readyState === 'open'
    );
  }

  function beginHostPlaybackPreparation(trackId: string): void {
    clearHostPlaybackPreparation(true);
    const peers = connectedHostPeers();
    if (peers.length === 0) {
      core.bypassHostPlaybackGateTrackId = trackId;
      resumeHostPlayback();
      return;
    }
    const preparation: MultiplayerPlaybackPreparation = {
      generationId: core.latestDelivery.generationId,
      trackId,
      delivery: core.latestDelivery.mode
    };
    core.hostPlaybackPreparation = {
      preparation,
      pendingPeerIds: new Set(peers.map((peer) => peer.id)),
      peerIds: new Set(peers.map((peer) => peer.id)),
      clockOffsets: new Map(),
      releaseTimer: null
    };
    for (const peer of peers) {
      sendToPeer(peer, { kind: 'playback.prepare', preparation });
      sendClockPing(peer, preparation.generationId);
    }
  }

  function sendClockPing(peer: PeerConnection, generationId: string): void {
    sendToPeer(peer, { kind: 'clock.ping', generationId, hostSentAt: Date.now() });
  }

  function acceptClientClockSample(
    peer: PeerConnection,
    message: Extract<import('./multiplayer-protocol').ClientMessage, { kind: 'clock.pong' }>
  ): void {
    const pending = core.hostPlaybackPreparation;
    if (!pending
      || pending.preparation.generationId !== message.generationId
      || !pending.peerIds.has(peer.id)) return;
    const estimate = estimateMultiplayerClock({
      hostSentAt: message.hostSentAt,
      clientReceivedAt: message.clientReceivedAt,
      clientSentAt: message.clientSentAt,
      hostReceivedAt: Date.now()
    });
    pending.clockOffsets.set(peer.id, estimate.clientOffsetMs);
    logDebug('multiplayer', 'Listener clock calibrated', {
      peerId: peer.id,
      generationId: message.generationId,
      offsetMs: Math.round(estimate.clientOffsetMs),
      roundTripMs: Math.round(estimate.roundTripMs)
    });
    releasePreparedHostPlayback();
  }

  function acceptClientPlaybackReady(
    peer: PeerConnection,
    generationId: string,
    verifiedRender = false
  ): void {
    const delivery = peer.freeplay ? peer.freeplayDelivery : core.latestDelivery;
    if (delivery?.mode === 'render' && !verifiedRender) return;
    const freeplayPreparation = peer.freeplayPendingPreparation;
    if (peer.freeplay
      && freeplayPreparation?.generationId === generationId
      && peer.freeplayDelivery?.generationId === generationId) {
      peer.freeplayPendingPreparation = null;
      void peer.freeplayPlayer?.play().then((playing) => {
        logInfo('freeplay', 'Freeplay playback readiness applied', {
          peerId: peer.id,
          generationId,
          playing
        });
      });
      return;
    }
    const pending = core.hostPlaybackPreparation;
    if (!pending || pending.preparation.generationId !== generationId) return;
    pending.pendingPeerIds.delete(peer.id);
    releasePreparedHostPlayback();
  }

  function acceptClientRenderReady(
    peer: PeerConnection,
    message: Extract<import('./multiplayer-protocol').ClientMessage, { kind: 'render.ready' }>
  ): void {
    const render = peer.renderState;
    if (!render
      || render.generationId !== message.generationId
      || render.renderId !== message.renderId
      || render.epoch !== message.epoch) return;
    acceptClientPlaybackReady(peer, message.generationId, true);
  }

  function removePeerFromHostPlaybackPreparation(peerId: string): void {
    const pending = core.hostPlaybackPreparation;
    if (!pending || !pending.peerIds.delete(peerId)) return;
    pending.pendingPeerIds.delete(peerId);
    pending.clockOffsets.delete(peerId);
    releasePreparedHostPlayback();
  }

  function releasePreparedHostPlayback(force = false): void {
    const pending = core.hostPlaybackPreparation;
    if (!pending || (!force && (pending.pendingPeerIds.size > 0 || pending.releaseTimer !== null))) return;
    if (force && pending.releaseTimer !== null) {
      cancelScheduledClientStarts(pending);
      window.clearTimeout(pending.releaseTimer);
      pending.releaseTimer = null;
    }
    if (core.state.mode !== 'hosting'
      || core.latestHostState?.track?.id !== pending.preparation.trackId
      || core.latestHostState.playback.state === 'playing') return;
    const synchronized = core.multiplayerSettings.multiplayerSynchronizedPlayback
      && core.multiplayerSettings.multiplayerStreamAudio
      && !core.multiplayerSettings.multiplayerFreeplay;
    if (synchronized
      && Array.from(pending.peerIds).some((peerId) => !pending.clockOffsets.has(peerId))) return;
    if (!synchronized) {
      core.hostPlaybackPreparation = null;
      core.bypassHostPlaybackGateTrackId = pending.preparation.trackId;
      resumeHostPlayback();
      return;
    }

    const hostStartAt = Date.now() + core.multiplayerSettings.multiplayerSyncLeadTimeMs;
    const positionSeconds = core.latestHostState.playback.currentTime;
    for (const peerId of pending.peerIds) {
      const peer = core.hostPeers.get(peerId);
      const offset = pending.clockOffsets.get(peerId);
      if (!peer || offset === undefined || peer.channel?.readyState !== 'open') continue;
      sendToPeer(peer, {
        kind: 'playback.start',
        start: {
          generationId: pending.preparation.generationId,
          trackId: pending.preparation.trackId,
          positionSeconds,
          startAt: clientStartTime(hostStartAt, offset)
        }
      });
    }
    pending.releaseTimer = window.setTimeout(() => {
      if (core.hostPlaybackPreparation !== pending) return;
      core.hostPlaybackPreparation = null;
      core.bypassHostPlaybackGateTrackId = pending.preparation.trackId;
      resumeHostPlayback();
    }, Math.max(0, hostStartAt - Date.now()));
    logInfo('multiplayer', 'Synchronized playback armed', {
      generationId: pending.preparation.generationId,
      listeners: pending.peerIds.size,
      leadTimeMs: core.multiplayerSettings.multiplayerSyncLeadTimeMs,
      delivery: pending.preparation.delivery
    });
  }

  function cancelScheduledClientStarts(
    pending: NonNullable<MultiplayerSessionCore['hostPlaybackPreparation']>
  ): void {
    for (const peerId of pending.peerIds) {
      const peer = core.hostPeers.get(peerId);
      if (peer?.channel?.readyState === 'open') {
        sendToPeer(peer, {
          kind: 'playback.cancel',
          generationId: pending.preparation.generationId
        });
      }
    }
  }

  function clearHostPlaybackPreparation(notifyClients = false): void {
    const pending = core.hostPlaybackPreparation;
    if (pending && notifyClients && pending.releaseTimer !== null) {
      cancelScheduledClientStarts(pending);
    }
    if (pending && pending.releaseTimer !== null) window.clearTimeout(pending.releaseTimer);
    core.hostPlaybackPreparation = null;
  }

  function cancelPendingPlayback(): boolean {
    if (!core.hostPlaybackPreparation) return false;
    clearHostPlaybackPreparation(true);
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
      const delivery = peer.freeplayDelivery ?? ensureFreeplayDelivery(
        peer,
        player?.delivery ?? 'none'
      );
      sendToPeer(peer, { kind: 'delivery', delivery });
      sendToPeer(peer, {
        kind: 'playback',
        playback: player
          ? {
              ...player.playback,
              generationId: delivery.generationId,
              snapshot: projectMultiplayerPlaybackSnapshot(player.playback.snapshot),
              track: player.track ? sanitizeMediaEntity(player.track) : null
            }
          : { ...EMPTY_REMOTE_PLAYBACK, generationId: delivery.generationId }
      });
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
      syncPeerMediaSource(peer);
      return;
    }
    sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(core.latestHostState) });
    sendToPeer(peer, { kind: 'delivery', delivery: core.latestDelivery });
    sendToPeer(peer, { kind: 'playback', playback: buildPlayback(core.latestHostState) });
    if (core.hostArtworkResolvedTrackKey === core.hostArtworkTrackKey) {
      sendToPeer(peer, { kind: 'artwork', artwork: core.latestHostArtwork });
    }
    sendToPeer(peer, { kind: 'buffer', bufferMs: core.multiplayerSettings.multiplayerAudioBufferMs });
    if (core.hostPlaybackPreparation?.releaseTimer === null) {
      core.hostPlaybackPreparation.pendingPeerIds.add(peer.id);
      core.hostPlaybackPreparation.peerIds.add(peer.id);
      sendToPeer(peer, {
        kind: 'playback.prepare',
        preparation: core.hostPlaybackPreparation.preparation
      });
      sendClockPing(peer, core.hostPlaybackPreparation.preparation.generationId);
    }
    syncPeerMediaSource(peer);
  }

  function syncHostAudio(track: MediaEntity | null, force = false): void {
    const mode: MultiplayerDeliveryMode = !track
      ? 'none'
      : !core.multiplayerSettings.multiplayerStreamAudio
      ? 'none'
      : core.renderFallbackTrackIds.has(track.id)
      ? 'source-file'
      : resolveMultiplayerDeliveryMode(
          track,
          true,
          core.multiplayerSettings.multiplayerFileTransferLimitMiB
        );
    const enabled = mode === 'stream';
    const trackId = track?.id ?? null;
    const changed = force
      || core.latestDelivery.trackId !== trackId
      || core.latestDelivery.mode !== mode;
    const nextDelivery: MultiplayerDeliveryState = changed
      ? {
          generationId: crypto.randomUUID(),
          trackId,
          mode,
          reason: mode === 'none'
            ? track ? 'host-disabled' : 'no-track'
            : null
        }
      : core.latestDelivery;
    multiplayerAudioService.setHostAudible(enabled);

    if (enabled) {
      const hostTrack = multiplayerAudioService.getHostTrack();
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

  function syncHostSourceFiles(track: MediaEntity | null): void {
    for (const peer of core.hostPeers.values()) {
      if (peer.freeplaySettled && !peer.freeplay) {
        const mode = core.latestDelivery.mode;
        if (mode === 'render') {
          syncPeerRenderSource(peer, track, core.latestDelivery.generationId);
        } else if (mode === 'source-file') {
          syncPeerSourceFile(peer, track, core.latestDelivery.generationId);
        }
      }
    }
  }

  function syncHostArtwork(track: MediaEntity | null): void {
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
      playlist: source.playlist.map(sanitizeMediaEntity),
      library: source.library.map(sanitizeMediaEntity),
      favorites: source.favorites.map(sanitizeMediaEntity),
      shuffleEnabled: source.shuffleEnabled,
      repeatMode: source.repeatMode
    };
  }

  function buildPlayback(source: MultiplayerHostState): MultiplayerPlayback {
    return {
      generationId: core.latestDelivery.generationId,
      snapshot: projectMultiplayerPlaybackSnapshot(source.playback),
      track: source.track ? sanitizeMediaEntity(source.track) : null,
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
