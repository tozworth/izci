import { version as appVersion } from '../../../package.json';
import { clearPeerConnectionTimer, sendToPeer } from './multiplayer-peer';
import { MULTIPLAYER_PROTOCOL_VERSION, isMultiplayerCommand } from './multiplayer-protocol';
import { flushPeerMedia } from './multiplayer-source-transfer';
import { flushPeerRender, resetPeerRenderQueue, schedulePeerRender } from './multiplayer-render-transfer';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import { multiplayerChat } from './multiplayer-chat';
import {
  handleFreeplayCommand,
  handleFreeplayTrackEnded,
  handlePeerRenderNeed,
  playheadMsForPeer,
  sendFreeplayCatalog,
  sendFreeplayState,
  syncPeerFreeplayMode,
  syncPeerMediaSource
} from './multiplayer-host-freeplay';
import {
  acceptClientClockSample,
  acceptClientPlaybackReady,
  acceptClientRenderReady,
  removePeerFromHostPlaybackPreparation
} from './multiplayer-host-playback-prep';
import {
  getLocalName,
  parseFreeplayRestoredFlags,
  sanitizeClientName,
  sanitizeFreeplayQueueIds,
  sanitizePlatform
} from './multiplayer-utils';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

export function announceHostPeerLeave(
  ctx: MultiplayerHostContext,
  peer: PeerConnection
): void {
  if (!peer.helloReceived || peer.chatLeaveAnnounced) return;
  peer.chatLeaveAnnounced = true;
  ctx.handleChatPresence(peer.name, 'leave');
}

export function attachHostChannel(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  channel: RTCDataChannel
): void {
  const { core } = ctx;
  peer.channel = channel;
  channel.onopen = () => {
    if (core.hostPeers.get(peer.id) !== peer || peer.channel !== channel) return;
    clearPeerConnectionTimer(peer);
    core.updateClient(peer.id, { status: 'connected' });
    sendToPeer(peer, {
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: getLocalName(),
      appVersion
    });
  };
  channel.onmessage = (event) => {
    if (core.hostPeers.get(peer.id) !== peer || peer.channel !== channel) return;
    if (typeof event.data !== 'string') return;
    const message = peer.decode(event.data);
    if (!message) return;
    if (message.kind === 'hello') {
      const firstHello = !peer.helloReceived;
      peer.name = sanitizeClientName(message.name);
      peer.clientFreeplayEnabled = message.freeplayEnabled;
      peer.helloReceived = true;
      core.updateClient(peer.id, { name: peer.name, platform: sanitizePlatform(message.platform) });
      sendToPeer(peer, {
        kind: 'chat.motd',
        motd: core.multiplayerSettings.multiplayerMotd,
        hostName: getLocalName()
      });
      sendToPeer(peer, { kind: 'chat.history', messages: multiplayerChat.getSnapshot() });
      if (firstHello) ctx.handleChatPresence(peer.name, 'join');
      void syncPeerFreeplayMode(ctx, peer);
      return;
    }
    if (message.kind === 'chat.send') {
      ctx.handleChatMessage(message.text, peer, message.track);
      return;
    }
    if (message.kind === 'freeplay.preference') {
      peer.clientFreeplayEnabled = message.enabled;
      void syncPeerFreeplayMode(ctx, peer);
      return;
    }
    if (message.kind === 'freeplay.queue' && peer.freeplay) {
      peer.freeplayQueue = sanitizeFreeplayQueueIds(message.itemIds);
      peer.freeplayCollection = 'queue';
      peer.freeplayNavigation?.reset();
      const restored = parseFreeplayRestoredFlags(message);
      if (restored) {
        peer.freeplayShuffle = restored.shuffleEnabled;
        peer.freeplayRepeatMode = restored.repeatMode;
        sendFreeplayState(peer);
      }
      sendFreeplayCatalog(ctx, peer);
      return;
    }
    if (message.kind === 'command' && isMultiplayerCommand(message.command)) {
      void Promise.resolve(peer.freeplay
        ? handleFreeplayCommand(ctx, peer, message.command)
        : ctx.handleHostCommand(message.command, peer))
        .then((accepted) => {
          if (core.hostPeers.get(peer.id) !== peer || peer.channel !== channel) return;
          sendToPeer(peer, {
            kind: 'ack',
            commandId: message.command.commandId,
            accepted
          });
        })
        .catch(() => {
          if (core.hostPeers.get(peer.id) !== peer || peer.channel !== channel) return;
          sendToPeer(peer, {
            kind: 'ack',
            commandId: message.command.commandId,
            accepted: false,
            message: 'The host could not apply that command.'
          });
        });
    }
    if (message.kind === 'playback.ready') {
      acceptClientPlaybackReady(ctx, peer, message.generationId);
    }
    if (message.kind === 'clock.pong') {
      acceptClientClockSample(ctx, peer, message);
    }
    if (message.kind === 'playback.ended' && peer.freeplay) {
      const activeTrackId = peer.freeplayPlayer?.track?.id;
      if (activeTrackId === message.trackId
        && peer.freeplayDelivery?.generationId === message.generationId) {
        void handleFreeplayTrackEnded(ctx, peer, message.trackId);
      }
    }
    if (message.kind === 'source.retry') {
      const delivery = peer.freeplay ? peer.freeplayDelivery : core.latestDelivery;
      if (delivery?.mode === 'source-file' && delivery.generationId === message.generationId) {
        peer.sourceTrackKey = '';
        syncPeerMediaSource(ctx, peer);
      }
    }
    if (message.kind === 'render.need') {
      handlePeerRenderNeed(ctx, peer, message.need);
    }
    if (message.kind === 'render.ready') {
      acceptClientRenderReady(ctx, peer, message);
    }
  };
  channel.onclose = () => {
    if (core.hostPeers.get(peer.id) !== peer || peer.channel !== channel) return;
    announceHostPeerLeave(ctx, peer);
    core.updateClient(peer.id, { status: 'disconnected' });
    removePeerFromHostPlaybackPreparation(ctx, peer.id);
  };
  sendToPeer(peer, {
    kind: 'hello',
    version: MULTIPLAYER_PROTOCOL_VERSION,
    name: getLocalName(),
    appVersion
  });
}

export function attachHostMediaChannel(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  channel: RTCDataChannel
): void {
  peer.mediaChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onopen = () => {
    if (ctx.core.hostPeers.get(peer.id) !== peer || peer.mediaChannel !== channel) return;
    if (peer.freeplaySettled) syncPeerMediaSource(ctx, peer);
    else peer.mediaSyncPending = true;
  };
  channel.onbufferedamountlow = () => {
    if (ctx.core.hostPeers.get(peer.id) !== peer || peer.mediaChannel !== channel) return;
    flushPeerMedia(peer);
  };
  channel.onclose = () => {
    peer.mediaTransferToken += 1;
    peer.mediaOutgoing = [];
    peer.mediaQueuedBytes = 0;
    peer.mediaFlushing = false;
    peer.sourceTrackKey = '';
    if (peer.pc.connectionState !== 'closed') peer.pc.close();
  };
}

export function attachHostRenderChannel(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  channel: RTCDataChannel
): void {
  peer.renderChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 128 * 1024;
  channel.onopen = () => {
    if (ctx.core.hostPeers.get(peer.id) !== peer || peer.renderChannel !== channel) return;
    if (peer.freeplaySettled) syncPeerMediaSource(ctx, peer);
    else peer.mediaSyncPending = true;
    // A renderState created before this channel opened never got its batch
    // (schedulePeerRender skips a non-open channel and syncPeerMediaSource
    // early-returns for an existing generation). Flush it now.
    if (peer.renderState) schedulePeerRender(peer, playheadMsForPeer(ctx, peer));
  };
  channel.onbufferedamountlow = () => {
    if (ctx.core.hostPeers.get(peer.id) !== peer || peer.renderChannel !== channel) return;
    // The render queue is a real backlog: schedulePeerRender gates on
    // renderQueuedBytes >= HIGH_WATER, so it can NOT be the drain trigger.
    // Flush the pending frames first, then re-plan for more clusters.
    flushPeerRender(peer);
    schedulePeerRender(peer, playheadMsForPeer(ctx, peer));
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
