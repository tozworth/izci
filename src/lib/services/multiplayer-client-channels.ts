import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { multiplayerFreeplayState } from '$lib/stores/multiplayer-freeplay-state';
import {
  clearMultiplayerLastSession,
  rememberMultiplayerLastSession
} from '$lib/stores/multiplayer-last-session';
import {
  findServerPairing,
  forgetServerPairing,
  rememberServerPairing,
  setServerPairingInvitationByRoom
} from '$lib/stores/multiplayer-server-pairings';
import { getLocalServerIdentity, isValidServerIdentity } from './multiplayer-server-identity';
import { computePairProof, createPairNonce } from './multiplayer-server-pairing';
import { getMultiplayerArtworkTrackKey } from './multiplayer-artwork';
import { applyRemoteTrackInfo, enrichCatalog, enrichPlayback } from './multiplayer-client-track-info';
import {
  clearPeerConnectionTimer,
  describeIceFailure,
  sendToPeer
} from './multiplayer-peer';
import {
  createMultiplayerMessageDecoder,
  isHostMessage,
  MULTIPLAYER_PROTOCOL_MAJOR,
  MULTIPLAYER_PROTOCOL_MINOR,
  normalizeCapabilities
} from './multiplayer-protocol';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { multiplayerChat } from './multiplayer-chat';
import {
  getClientPlatform,
  getLocalCapabilities,
  getLocalImplementation,
  isIncompatibleProtocolHello,
  sanitizeClientName
} from './multiplayer-utils';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerClientContext } from './multiplayer-client';
import {
  applyClientAudioBuffer,
  applySynchronizedStart,
  cancelSynchronizedStart,
  loadPendingClientSourceFile,
  sendClientPlaybackReadyIfPossible,
  updateClientConnectionRoute
} from './multiplayer-client-audio';
import {
  persistFreeplayState,
  restoreFreeplayStateForHost,
  sendFreeplayQueueToPeer,
  tryResumeFreeplaySelection,
  updateLocalTimelineMode
} from './multiplayer-client-freeplay';
import {
  clearReconnectTimer,
  scheduleClientReconnect
} from './multiplayer-client-lifecycle';

export function attachClientChannel(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core, transition } = ctx;
  const channel = peer.channel;
  if (!channel) return;
  const decode = createMultiplayerMessageDecoder(isHostMessage);

  channel.onopen = () => {
    if (core.clientPeer !== peer) return;
    core.reconnectAttempts = 0;
    core.reconnectInFlight = false;
    clearReconnectTimer(ctx);
    logInfo('multiplayer', 'Client control channel opened', {
      peerId: peer.id,
      reconnecting: core.state.reconnecting
    });
    core.publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
    rememberMultiplayerLastSession('client', {
      hostName: core.state.hostName
    });
    sendToPeer(peer, {
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: MULTIPLAYER_PROTOCOL_MINOR,
      capabilities: getLocalCapabilities(),
      impl: getLocalImplementation(),
      name: peer.name,
      platform: getClientPlatform(),
      freeplayEnabled: core.multiplayerSettings.multiplayerFreeplay,
      identity: getLocalServerIdentity()
    });
    sendToPeer(peer, {
      kind: 'oda.background.preference',
      enabled: ctx.useHostOdaBackground
    });
  };
  channel.onmessage = (event) => {
    if (core.clientPeer !== peer || peer.channel !== channel) return;
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
        core.publish({ connectionStatus: 'error', message: 'The host uses an incompatible protocol.' });
      }
      return;
    }
    if (message.kind === 'catalog') core.publish({ remoteCatalog: enrichCatalog(message.catalog, ctx.trackInfoById) });
    if (message.kind === 'state') {
      core.publish({
        remoteCatalog: {
          ...core.state.remoteCatalog,
          shuffleEnabled: message.shuffleEnabled,
          repeatMode: message.repeatMode
        }
      });
      persistFreeplayState(ctx);
    }
    if (message.kind === 'playback') {
      if (!transition.acceptPlayback(message.playback)) {
        logDebug('freeplay', 'Ignored stale multiplayer playback', {
          generationId: message.playback.generationId,
          currentGenerationId: core.state.remoteDelivery.generationId
        });
        return;
      }
      core.publish({ remotePlayback: enrichPlayback({ ...message.playback, sentAt: Date.now() }, ctx.trackInfoById) });
      multiplayerSourcePlaybackService.syncPlayback(message.playback);
      if (core.state.remoteDelivery.mode === 'render') {
        multiplayerRenderPlaybackService.syncPlayback(message.playback);
        const audible = core.state.receiveAudio
          && message.playback.snapshot.state === 'playing'
          && !(ctx.synchronizedStartGenerationId === message.playback.generationId
            && Date.now() < ctx.synchronizedStartAt);
        multiplayerRenderPlaybackService.setAudible(audible);
        core.publish({
          audioStatus: !core.state.receiveAudio
            ? 'refused'
            : message.playback.snapshot.state === 'playing'
            ? 'playing'
            : 'ready',
        });
      }
      persistFreeplayState(ctx);
      loadPendingClientSourceFile(ctx, peer);
      tryResumeFreeplaySelection(ctx);
      sendClientPlaybackReadyIfPossible(ctx, peer);
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
      ctx.renderReadySentGeneration = null;
      ctx.renderReadySentEpoch = -1;
      logDebug('freeplay', 'Playback preparation accepted', message.preparation);
      sendClientPlaybackReadyIfPossible(ctx, peer);
    }
    if (message.kind === 'artwork') {
      core.publish({
        remoteArtwork: message.artwork,
        remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(core.state.remotePlayback.track)
      });
    }
    if (message.kind === 'track.info') applyRemoteTrackInfo(ctx, message.info);
    if (message.kind === 'oda.background') {
      core.publish({ remoteOdaBackground: message.background });
    }
    if (message.kind === 'oda.background.opacity' && core.state.remoteOdaBackground) {
      core.publish({
        remoteOdaBackground: {
          ...core.state.remoteOdaBackground,
          opacity: message.opacity
        }
      });
    }
    if (message.kind === 'chat.motd') {
      core.publish({ hostName: sanitizeClientName(message.hostName), hostMotd: message.motd });
    }
    if (message.kind === 'chat.message') multiplayerChat.append(message.message);
    if (message.kind === 'chat.history') multiplayerChat.mergeHistory(message.messages);
    if (message.kind === 'chat.clear') multiplayerChat.clear();
    if (message.kind === 'render.manifest') {
      multiplayerRenderPlaybackService.updateWindowMs(
        core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
      );
      const accepted = multiplayerRenderPlaybackService.setManifest(message.manifest);
      if (accepted) {
        core.publish({ audioBitrateKbps: message.manifest.bitrateKbps });
        logInfo('multiplayer', 'Buffered Opus manifest accepted', {
          generationId: message.manifest.generationId,
          renderId: message.manifest.renderId,
          clusters: message.manifest.clusters.length,
          durationMs: message.manifest.durationMs
        });
        sendClientPlaybackReadyIfPossible(ctx, peer);
      }
    }
    if (message.kind === 'pair.secret') {
      // The host chose Pair: store the secret under the host's
      // browser-local identity, namespaced away from legacy UID pairs.
      if (core.serverGuest) {
        rememberServerPairing({
          peerIdentity: message.hostIdentity,
          label: sanitizeClientName(core.state.hostName ?? message.hostIdentity),
          secret: message.secret,
          endpoint: core.serverGuest.endpoint,
          roomId: core.serverGuest.roomId,
          invitationSecret: null
        });
      }
      return;
    }
    if (message.kind === 'invitation') {
      // Rotated invitations reach currently paired guests over their
      // authorized channel; offline guests need a fresh invite link.
      if (core.serverGuest) {
        setServerPairingInvitationByRoom(
          core.serverGuest.endpoint,
          message.roomId,
          message.secret
        );
      }
      return;
    }
    if (message.kind === 'pairing') {
      if (core.serverGuest) {
        if (!message.paired) {
          forgetServerPairing(message.hostId);
        }
      }
      // Keep the host identity while unpaired Freeplay is active so its
      // independent queue/selection can persist across reconnects.
      core.clientHostId = message.paired || message.freeplayActive ? message.hostId : null;
      core.publish({
        freeplay: message.freeplayActive
      });
      updateLocalTimelineMode(ctx);
      rememberMultiplayerLastSession('client', {
        hostName: message.name
      });
      if (message.freeplayActive) {
        restoreFreeplayStateForHost(ctx, message.hostId);
        sendFreeplayQueueToPeer(ctx);
        const saved = multiplayerFreeplayState.getSnapshot();
        const resumeTrackId = saved?.hostId === message.hostId ? saved.currentTrackId : null;
        ctx.pendingFreeplayResumeTrackId = resumeTrackId;
        tryResumeFreeplaySelection(ctx);
      } else {
        ctx.pendingFreeplayResumeTrackId = null;
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
        cancelSynchronizedStart(ctx);
        ctx.sourceRetryGenerationId = message.delivery.generationId;
        ctx.sourceRetryCount = 0;
        core.pendingClientSourceFile = null;
        logInfo('freeplay', 'Multiplayer delivery generation changed', {
          generationId: message.delivery.generationId,
          trackId: message.delivery.trackId,
          delivery: message.delivery.mode
        });
      }
      core.latestDelivery = message.delivery;
      core.publish({ remoteDelivery: message.delivery });
      updateLocalTimelineMode(ctx);
      if (changed) {
        if (message.delivery.mode !== 'render') multiplayerRenderPlaybackService.release();
        if (message.delivery.mode !== 'source-file') multiplayerSourcePlaybackService.clearSourceTrack();
        if (message.delivery.mode === 'render') {
          multiplayerRenderPlaybackService.setEnabled(core.state.receiveAudio);
          multiplayerRenderPlaybackService.start(message.delivery.generationId, message.delivery.trackId ?? '');
          applyClientAudioBuffer(ctx);
        }
        multiplayerSourcePlaybackService.setEnabled(core.state.receiveAudio);
        core.publish({
          audioStatus: !core.state.receiveAudio ? 'refused'
            : message.delivery.mode === 'none' ? 'disabled' : 'connecting',
          audioBitrateKbps: null
        });
      }
      loadPendingClientSourceFile(ctx, peer);
      sendClientPlaybackReadyIfPossible(ctx, peer);
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
    if (message.kind === 'playback.start') applySynchronizedStart(ctx, peer, message.start);
    if (message.kind === 'playback.cancel'
      && ctx.synchronizedStartGenerationId === message.generationId) {
      cancelSynchronizedStart(ctx);
    }
    if (message.kind === 'buffer') {
      core.hostAudioBufferMs = message.bufferMs;
      applyClientAudioBuffer(ctx);
    }
    if (message.kind === 'kicked') {
      core.allowClientReconnect = false;
      clearMultiplayerLastSession();
      multiplayerSourcePlaybackService.clearLoadedFile();
      core.publish({
        connectionStatus: 'disconnected',
        audioStatus: 'unavailable',
        message: 'The host removed this client.'
      });
      peer.pc.close();
    }
    if (message.kind === 'hello') {
      const hostName = sanitizeClientName(message.name);
      core.publish({
        hostName,
        hostVersion: message.impl.productVersion,
        hostImplementation: message.impl,
        hostProtocol: {
          major: message.protocolMajor,
          minor: message.protocolMinor,
          capabilities: normalizeCapabilities(message.capabilities)
        }
      });
      rememberMultiplayerLastSession('client', {
        hostName
      });
      if (core.serverGuest) void sendServerPairProof(ctx, peer, message.identity, message.pairNonce);
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
      core.publish({
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
      scheduleClientReconnect(ctx, 1_000);
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
      clearReconnectTimer(ctx);
      core.publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
      void updateClientConnectionRoute(ctx, peer);
    }
    if (peer.pc.connectionState === 'failed') {
      core.publish({
        connectionStatus: 'disconnected',
        reconnecting: core.allowClientReconnect,
        audioStatus: 'unavailable',
        connectionDetail: describeIceFailure(peer),
        message: describeIceFailure(peer)
      });
      scheduleClientReconnect(ctx, 1_000);
    }
    if (peer.pc.connectionState === 'disconnected') scheduleClientReconnect(ctx, 4_000);
  };
}

/**
 * Answer a server host hello with an HMAC pair proof when this browser
 * holds a pair record for the host identity. Guests without a record stay
 * silent and remain unpaired; a failed proof simply leaves privileges off.
 */
async function sendServerPairProof(
  ctx: MultiplayerClientContext,
  peer: PeerConnection,
  hostIdentity: string | undefined,
  hostNonce: string | undefined
): Promise<void> {
  const { core } = ctx;
  const guest = core.serverGuest;
  if (!guest || core.clientPeer !== peer) return;
  if (!isValidServerIdentity(hostIdentity)
    || typeof hostNonce !== 'string'
    || !/^[A-Za-z0-9_-]{8,128}$/.test(hostNonce)) return;
  const record = findServerPairing(hostIdentity);
  if (!record) return;
  const clientIdentity = getLocalServerIdentity();
  if (clientIdentity === hostIdentity) return;
  const guestNonce = createPairNonce();
  try {
    const proof = await computePairProof(record.secret, {
      roomId: guest.roomId,
      hostIdentity,
      clientIdentity,
      hostNonce,
      guestNonce
    });
    if (core.clientPeer !== peer || core.state.mode !== 'client') return;
    sendToPeer(peer, {
      kind: 'pair.proof',
      clientIdentity,
      hostNonce,
      guestNonce,
      proof
    });
  } catch {
    // Proofs are best-effort: the guest simply stays unpaired.
  }
}
