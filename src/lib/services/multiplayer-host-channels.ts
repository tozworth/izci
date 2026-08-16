import { version as appVersion } from '../../../package.json';
import { clearPeerConnectionTimer, sendToPeer } from './multiplayer-peer';
import { MULTIPLAYER_PROTOCOL_VERSION, isMultiplayerCommand } from './multiplayer-protocol';
import { flushPeerMedia } from './multiplayer-source-transfer';
import { flushPeerRender, resetPeerRenderQueue, schedulePeerRender } from './multiplayer-render-transfer';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import {
  getLocalName,
  parseFreeplayRestoredFlags,
  sanitizeClientName,
  sanitizeFreeplayQueueIds,
  sanitizePlatform
} from './multiplayer-utils';
import type { PeerConnection } from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

export function attachHostChannel(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  channel: RTCDataChannel
): void {
  const { core, updateClient } = ctx;
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
      void ctx.syncPeerFreeplayMode(peer);
      return;
    }
    if (message.kind === 'freeplay.preference') {
      peer.clientFreeplayEnabled = message.enabled;
      void ctx.syncPeerFreeplayMode(peer);
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
        ctx.sendFreeplayState(peer);
      }
      ctx.sendFreeplayCatalog(peer);
      return;
    }
    if (message.kind === 'command' && isMultiplayerCommand(message.command)) {
      void Promise.resolve(peer.freeplay
        ? ctx.handleFreeplayCommand(peer, message.command)
        : ctx.handleHostCommand(message.command, peer))
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
      ctx.acceptClientPlaybackReady(peer, message.generationId);
    }
    if (message.kind === 'clock.pong') {
      ctx.acceptClientClockSample(peer, message);
    }
    if (message.kind === 'playback.ended' && peer.freeplay) {
      const activeTrackId = peer.freeplayPlayer?.track?.id;
      if (activeTrackId === message.trackId
        && peer.freeplayDelivery?.generationId === message.generationId) {
        void ctx.handleFreeplayTrackEnded(peer, message.trackId);
      }
    }
    if (message.kind === 'source.retry') {
      const delivery = peer.freeplay ? peer.freeplayDelivery : core.latestDelivery;
      if (delivery?.mode === 'source-file' && delivery.generationId === message.generationId) {
        peer.sourceTrackKey = '';
        ctx.syncPeerMediaSource(peer);
      }
    }
    if (message.kind === 'render.need') {
      ctx.handlePeerRenderNeed(peer, message.need);
    }
    if (message.kind === 'render.ready') {
      ctx.acceptClientRenderReady(peer, message);
    }
  };
  channel.onclose = () => {
    updateClient(peer.id, { status: 'disconnected' });
    ctx.removePeerFromHostPlaybackPreparation(peer.id);
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
    if (peer.freeplaySettled) ctx.syncPeerMediaSource(peer);
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

export function attachHostRenderChannel(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  channel: RTCDataChannel
): void {
  peer.renderChannel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 128 * 1024;
  channel.onopen = () => {
    if (peer.freeplaySettled) ctx.syncPeerMediaSource(peer);
    else peer.mediaSyncPending = true;
    // A renderState created before this channel opened never got its batch
    // (schedulePeerRender skips a non-open channel and syncPeerMediaSource
    // early-returns for an existing generation). Flush it now.
    if (peer.renderState) schedulePeerRender(peer, ctx.playheadMsForPeer(peer));
  };
  channel.onbufferedamountlow = () => {
    // The render queue is a real backlog: schedulePeerRender gates on
    // renderQueuedBytes >= HIGH_WATER, so it can NOT be the drain trigger.
    // Flush the pending frames first, then re-plan for more clusters.
    flushPeerRender(peer);
    schedulePeerRender(peer, ctx.playheadMsForPeer(peer));
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
