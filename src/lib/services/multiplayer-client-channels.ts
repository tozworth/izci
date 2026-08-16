import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { multiplayerFreeplayState } from '$lib/stores/multiplayer-freeplay-state';
import {
  clearMultiplayerLastSession,
  rememberMultiplayerLastSession
} from '$lib/stores/multiplayer-last-session';
import {
  forgetMultiplayerPairing,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import { getMultiplayerArtworkTrackKey } from './multiplayer-artwork';
import { multiplayerAudioService } from './multiplayer-audio';
import {
  clearPeerConnectionTimer,
  describeIceFailure,
  sendToPeer
} from './multiplayer-peer';
import {
  createMultiplayerMessageDecoder,
  isHostMessage,
  MULTIPLAYER_PROTOCOL_VERSION
} from './multiplayer-protocol';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import {
  getClientPlatform,
  isIncompatibleProtocolHello,
  sanitizeClientName
} from './multiplayer-utils';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerClientContext } from './multiplayer-client';

export function attachClientChannel(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core, publish, transition } = ctx;
  const channel = peer.channel;
  if (!channel) return;
  const decode = createMultiplayerMessageDecoder(isHostMessage);

  channel.onopen = () => {
    if (core.clientPeer !== peer) return;
    core.reconnectAttempts = 0;
    core.reconnectInFlight = false;
    ctx.clearReconnectTimer();
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
      ctx.persistFreeplayState();
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
            && !(ctx.synchronizedStartGenerationId === message.playback.generationId
              && Date.now() < ctx.synchronizedStartAt)
        );
      }
      if (core.state.remoteDelivery.mode === 'render') {
        multiplayerRenderPlaybackService.syncPlayback(message.playback);
        const audible = core.state.receiveAudio
          && message.playback.snapshot.state === 'playing'
          && !(ctx.synchronizedStartGenerationId === message.playback.generationId
            && Date.now() < ctx.synchronizedStartAt);
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
      ctx.persistFreeplayState();
      ctx.loadPendingClientSourceFile(peer);
      ctx.tryResumeFreeplaySelection();
      ctx.sendClientPlaybackReadyIfPossible(peer);
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
      ctx.sendClientPlaybackReadyIfPossible(peer);
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
        ctx.sendClientPlaybackReadyIfPossible(peer);
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
      ctx.updateLocalTimelineMode();
      rememberMultiplayerLastSession('client', {
        inviteCode: core.state.inviteCode,
        hostId: core.clientHostId,
        hostName: message.name
      });
      if (message.paired && message.freeplayActive) {
        ctx.restoreFreeplayStateForHost(message.hostId);
        ctx.sendFreeplayQueueToPeer();
        const saved = multiplayerFreeplayState.getSnapshot();
        const resumeTrackId = saved?.hostId === message.hostId ? saved.currentTrackId : null;
        ctx.pendingFreeplayResumeTrackId = resumeTrackId;
        ctx.tryResumeFreeplaySelection();
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
        ctx.cancelSynchronizedStart();
        ctx.sourceRetryGenerationId = message.delivery.generationId;
        ctx.sourceRetryCount = 0;
        multiplayerAudioService.setRemoteAudible(false);
        logInfo('freeplay', 'Multiplayer delivery generation changed', {
          generationId: message.delivery.generationId,
          trackId: message.delivery.trackId,
          delivery: message.delivery.mode
        });
      }
      core.latestDelivery = message.delivery;
      publish({ remoteDelivery: message.delivery });
      ctx.updateLocalTimelineMode();
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
          void ctx.attachClientRemoteAudio(peer, message.delivery.generationId);
        }
      }
      ctx.loadPendingClientSourceFile(peer);
      ctx.sendClientPlaybackReadyIfPossible(peer);
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
    if (message.kind === 'playback.start') ctx.applySynchronizedStart(peer, message.start);
    if (message.kind === 'playback.cancel'
      && ctx.synchronizedStartGenerationId === message.generationId) {
      ctx.cancelSynchronizedStart();
    }
    if (message.kind === 'buffer') {
      core.hostAudioBufferMs = message.bufferMs;
      ctx.applyClientAudioBuffer(peer);
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
      ctx.scheduleClientReconnect(1_000);
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
      ctx.clearReconnectTimer();
      publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
      void ctx.updateClientConnectionRoute(peer);
    }
    if (peer.pc.connectionState === 'failed') {
      publish({
        connectionStatus: 'disconnected',
        reconnecting: core.allowClientReconnect,
        audioStatus: 'unavailable',
        connectionDetail: describeIceFailure(peer),
        message: describeIceFailure(peer)
      });
      ctx.scheduleClientReconnect(1_000);
    }
    if (peer.pc.connectionState === 'disconnected') ctx.scheduleClientReconnect(4_000);
  };
  peer.pc.ontrack = (event) => {
    if (event.track.kind !== 'audio') return;
    ctx.applyReceiverBuffer(event.receiver);
    ctx.receiverMonitor.start(peer);
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
      ctx.sendClientPlaybackReadyIfPossible(peer);
    });
  };
}
