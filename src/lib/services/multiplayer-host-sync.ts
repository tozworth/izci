import type { TrackItem } from '$lib/types';
import { getMultiplayerArtworkTrackKey, loadMultiplayerArtwork } from './multiplayer-artwork';
import { multiplayerAudioService } from './multiplayer-audio';
import { applyAudioBitrate, sendToPeer } from './multiplayer-peer';
import {
  sanitizeTrackItem,
  type HostMessage,
  type MultiplayerCatalog,
  type MultiplayerDeliveryMode,
  type MultiplayerDeliveryState,
  type MultiplayerPlayback
} from './multiplayer-protocol';
import { resolveMultiplayerDeliveryMode } from './multiplayer-utils';
import {
  EMPTY_REMOTE_PLAYBACK,
  type MultiplayerHostState,
  type PeerConnection
} from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

export function primeHostState(ctx: MultiplayerHostContext): void {
  const { core } = ctx;
  if (!core.latestHostState) return;
  core.catalogRevision += 1;
  core.lastCatalogSources = {
    queue: core.latestHostState.queue,
    library: core.latestHostState.library,
    favorites: core.latestHostState.favorites,
    shuffleEnabled: core.latestHostState.shuffleEnabled,
    repeatMode: core.latestHostState.repeatMode
  };
  core.lastPlaybackSource = core.latestHostState.playback;
  core.lastTrackSource = core.latestHostState.track;
  syncHostArtwork(ctx, core.latestHostState.track);
  syncHostAudio(ctx, core.latestHostState.track);
  syncHostSourceFiles(ctx, core.latestHostState.track);
}

export function sendCurrentState(ctx: MultiplayerHostContext, peer: PeerConnection): void {
  const { core } = ctx;
  if (!core.latestHostState) return;
  if (peer.freeplay) {
    ctx.sendFreeplayCatalog(peer);
    ctx.sendFreeplayState(peer);
    const player = peer.freeplayPlayer;
    const delivery = peer.freeplayDelivery ?? ctx.ensureFreeplayDelivery(
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
            track: player.track ? sanitizeTrackItem(player.track) : null
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
    ctx.syncPeerMediaSource(peer);
    return;
  }
  sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(ctx, core.latestHostState) });
  sendToPeer(peer, { kind: 'delivery', delivery: core.latestDelivery });
  sendToPeer(peer, { kind: 'playback', playback: buildPlayback(ctx, core.latestHostState) });
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
    ctx.sendClockPing(peer, core.hostPlaybackPreparation.preparation.generationId);
  }
  ctx.syncPeerMediaSource(peer);
}

export function syncHostAudio(ctx: MultiplayerHostContext, track: TrackItem | null, force = false): void {
  const { core } = ctx;
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
    broadcastShared(ctx, { kind: 'delivery', delivery: nextDelivery });
  }
}

export function syncHostSourceFiles(ctx: MultiplayerHostContext, track: TrackItem | null): void {
  const { core } = ctx;
  for (const peer of core.hostPeers.values()) {
    if (peer.freeplaySettled && !peer.freeplay) {
      const mode = core.latestDelivery.mode;
      ctx.syncPeerSourceFile(
        peer,
        mode === 'source-file' ? track : null,
        mode === 'source-file' ? core.latestDelivery.generationId : null
      );
      if (mode === 'render') {
        ctx.syncPeerRenderSource(peer, track, core.latestDelivery.generationId);
      } else {
        ctx.syncPeerRenderSource(peer, null, null);
      }
    }
  }
}

export function syncHostArtwork(ctx: MultiplayerHostContext, track: TrackItem | null): void {
  const { core } = ctx;
  const nextTrackKey = getMultiplayerArtworkTrackKey(track);
  if (nextTrackKey === core.hostArtworkTrackKey) return;

  core.hostArtworkTrackKey = nextTrackKey;
  core.hostArtworkResolvedTrackKey = '';
  core.latestHostArtwork = null;
  const loadToken = ++core.hostArtworkLoadToken;

  if (!track) {
    core.hostArtworkResolvedTrackKey = nextTrackKey;
    broadcastShared(ctx, { kind: 'artwork', artwork: null });
    return;
  }

  void loadMultiplayerArtwork(track).then((artwork) => {
    if (loadToken !== core.hostArtworkLoadToken || core.hostArtworkTrackKey !== nextTrackKey) return;
    core.latestHostArtwork = artwork;
    core.hostArtworkResolvedTrackKey = nextTrackKey;
    broadcastShared(ctx, { kind: 'artwork', artwork });
  }).catch(() => {
    if (loadToken !== core.hostArtworkLoadToken || core.hostArtworkTrackKey !== nextTrackKey) return;
    core.latestHostArtwork = null;
    core.hostArtworkResolvedTrackKey = nextTrackKey;
    broadcastShared(ctx, { kind: 'artwork', artwork: null });
  });
}

export function buildCatalog(ctx: MultiplayerHostContext, source: MultiplayerHostState): MultiplayerCatalog {
  return {
    revision: ctx.core.catalogRevision,
    queue: source.queue.map(sanitizeTrackItem),
    library: source.library.map(sanitizeTrackItem),
    favorites: source.favorites.map(sanitizeTrackItem),
    shuffleEnabled: source.shuffleEnabled,
    repeatMode: source.repeatMode
  };
}

export function buildPlayback(ctx: MultiplayerHostContext, source: MultiplayerHostState): MultiplayerPlayback {
  return {
    generationId: ctx.core.latestDelivery.generationId,
    snapshot: { ...source.playback },
    track: source.track ? sanitizeTrackItem(source.track) : null,
    sentAt: Date.now()
  };
}

export function broadcastShared(ctx: MultiplayerHostContext, message: HostMessage): void {
  for (const peer of ctx.core.hostPeers.values()) {
    if (peer.freeplaySettled && !peer.freeplay) sendToPeer(peer, message);
  }
}
