import { logDebug, logInfo } from '$lib/services/logging';
import { sendToPeer } from './multiplayer-peer';
import { clientStartTime, estimateMultiplayerClock } from './multiplayer-sync';
import type {
  ClientMessage,
  MultiplayerPlaybackPreparation
} from './multiplayer-protocol';
import type {
  MultiplayerHostState,
  MultiplayerSessionCore,
  PeerConnection
} from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

export function updateHostState(ctx: MultiplayerHostContext, next: MultiplayerHostState): void {
  const { core, pauseHostPlayback } = ctx;
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
    && connectedHostPeers(ctx).length > 0;

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
    || core.lastCatalogSources.queue !== effectiveNext.queue
    || core.lastCatalogSources.library !== effectiveNext.library
    || core.lastCatalogSources.favorites !== effectiveNext.favorites
    || core.lastCatalogSources.shuffleEnabled !== effectiveNext.shuffleEnabled
    || core.lastCatalogSources.repeatMode !== effectiveNext.repeatMode;
  if (catalogChanged) {
    core.catalogRevision += 1;
    core.lastCatalogSources = {
      queue: effectiveNext.queue,
      library: effectiveNext.library,
      favorites: effectiveNext.favorites,
      shuffleEnabled: effectiveNext.shuffleEnabled,
      repeatMode: effectiveNext.repeatMode
    };
    for (const peer of core.hostPeers.values()) {
      if (!peer.freeplaySettled) continue;
      if (peer.freeplay) ctx.sendFreeplayCatalog(peer);
      else sendToPeer(peer, { kind: 'catalog', catalog: ctx.buildCatalog(effectiveNext) });
    }
  }

  // Delivery is published first so ordered data channels never expose a
  // playback snapshot without its generation contract.
  ctx.syncHostAudio(effectiveNext.track);
  if (core.lastPlaybackSource !== effectiveNext.playback || core.lastTrackSource !== effectiveNext.track) {
    core.lastPlaybackSource = effectiveNext.playback;
    core.lastTrackSource = effectiveNext.track;
    ctx.broadcastShared({ kind: 'playback', playback: ctx.buildPlayback(effectiveNext) });
  }

  ctx.syncHostArtwork(effectiveNext.track);
  ctx.syncHostSourceFiles(effectiveNext.track);
  if (shouldGatePlayback) beginHostPlaybackPreparation(ctx, nextTrackId);
}

export function connectedHostPeers(ctx: MultiplayerHostContext): PeerConnection[] {
  return Array.from(ctx.core.hostPeers.values()).filter(
    (peer) => !peer.freeplay && peer.channel?.readyState === 'open'
  );
}

export function beginHostPlaybackPreparation(ctx: MultiplayerHostContext, trackId: string): void {
  const { core, resumeHostPlayback } = ctx;
  clearHostPlaybackPreparation(ctx, true);
  const peers = connectedHostPeers(ctx);
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
    sendClockPing(ctx, peer, preparation.generationId);
  }
}

export function sendClockPing(ctx: MultiplayerHostContext, peer: PeerConnection, generationId: string): void {
  sendToPeer(peer, { kind: 'clock.ping', generationId, hostSentAt: Date.now() });
}

export function acceptClientClockSample(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  message: Extract<ClientMessage, { kind: 'clock.pong' }>
): void {
  const { core } = ctx;
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
  releasePreparedHostPlayback(ctx);
}

export function acceptClientPlaybackReady(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  generationId: string,
  verifiedRender = false
): void {
  const { core } = ctx;
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
  releasePreparedHostPlayback(ctx);
}

export function acceptClientRenderReady(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  message: Extract<ClientMessage, { kind: 'render.ready' }>
): void {
  const render = peer.renderState;
  if (!render
    || render.generationId !== message.generationId
    || render.renderId !== message.renderId
    || render.epoch !== message.epoch) return;
  acceptClientPlaybackReady(ctx, peer, message.generationId, true);
}

export function removePeerFromHostPlaybackPreparation(ctx: MultiplayerHostContext, peerId: string): void {
  const pending = ctx.core.hostPlaybackPreparation;
  if (!pending || !pending.peerIds.delete(peerId)) return;
  pending.pendingPeerIds.delete(peerId);
  pending.clockOffsets.delete(peerId);
  releasePreparedHostPlayback(ctx);
}

export function releasePreparedHostPlayback(ctx: MultiplayerHostContext, force = false): void {
  const { core, resumeHostPlayback } = ctx;
  const pending = core.hostPlaybackPreparation;
  if (!pending || (!force && (pending.pendingPeerIds.size > 0 || pending.releaseTimer !== null))) return;
  if (force && pending.releaseTimer !== null) {
    cancelScheduledClientStarts(ctx, pending);
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

export function cancelScheduledClientStarts(
  ctx: MultiplayerHostContext,
  pending: NonNullable<MultiplayerSessionCore['hostPlaybackPreparation']>
): void {
  for (const peerId of pending.peerIds) {
    const peer = ctx.core.hostPeers.get(peerId);
    if (peer?.channel?.readyState === 'open') {
      sendToPeer(peer, {
        kind: 'playback.cancel',
        generationId: pending.preparation.generationId
      });
    }
  }
}

export function clearHostPlaybackPreparation(ctx: MultiplayerHostContext, notifyClients = false): void {
  const pending = ctx.core.hostPlaybackPreparation;
  if (pending && notifyClients && pending.releaseTimer !== null) {
    cancelScheduledClientStarts(ctx, pending);
  }
  if (pending && pending.releaseTimer !== null) window.clearTimeout(pending.releaseTimer);
  ctx.core.hostPlaybackPreparation = null;
}

export function cancelPendingPlayback(ctx: MultiplayerHostContext): boolean {
  if (!ctx.core.hostPlaybackPreparation) return false;
  clearHostPlaybackPreparation(ctx, true);
  ctx.core.bypassHostPlaybackGateTrackId = null;
  return true;
}
