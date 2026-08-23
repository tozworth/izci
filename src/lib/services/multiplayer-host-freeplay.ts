import type { TrackItem } from '$lib/types';
import { materializeTrackItem } from '$lib/stores/queue-materialization';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import {
  getMultiplayerArtworkTrackKey,
  loadMultiplayerArtwork
} from './multiplayer-artwork';
import {
  MultiplayerFreeplayPlayer,
  createFreeplayStepResolver,
  type MultiplayerFreeplayPlayerUpdate
} from './multiplayer-freeplay';
import { applyAudioBitrate, sendToPeer } from './multiplayer-peer';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import { buildRenderCacheKey } from './multiplayer-render-cache';
import {
  resetPeerRenderQueue,
  schedulePeerRender
} from './multiplayer-render-transfer';
import { transferSourceFile } from './multiplayer-source-transfer';
import {
  sanitizeTrackItem,
  type MultiplayerCollection,
  type MultiplayerCommand,
  type MultiplayerDeliveryMode,
  type MultiplayerDeliveryState,
  type MultiplayerPlayback,
  type MultiplayerPlaybackPreparation,
  type MultiplayerRenderNeed
} from './multiplayer-protocol';
import {
  cycleMultiplayerRepeatMode,
  errorMessage,
  getLocalName,
  resolveMultiplayerDeliveryMode,
  resolveMultiplayerFreeplayAgreement
} from './multiplayer-utils';
import type { PairedClientRecord, PeerConnection } from './multiplayer-types';
import type { MultiplayerHostContext } from './multiplayer-host';

export async function syncPeerFreeplayMode(ctx: MultiplayerHostContext, peer: PeerConnection): Promise<void> {
  const { core, updateClient } = ctx;
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
    await persistPairingAgreement(ctx, peer, agreement);
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
    ctx.removePeerFromHostPlaybackPreparation(peer.id);
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
        if (peer.freeplayPlayer === player) syncFreeplayPlayerUpdate(ctx, peer, update);
      },
      onEnded: (trackId) => {
        if (peer.freeplayPlayer === player) void handleFreeplayTrackEnded(ctx, peer, trackId);
      }
    });
    peer.freeplayPlayer = player;
    peer.freeplayNavigation = createFreeplayStepResolver(
      () => freeplayCollectionItems(ctx, peer, peer.freeplayCollection)
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
      void activateFreeplayTrack(ctx, peer, 'queue', previousSelection.id);
    } else {
      // No restored selection (host restart wipes freeplaySelections): the
      // idle player never publishes, so a reconnecting client holding a
      // stale remote track would never re-evaluate its persisted selection
      // (tryResumeFreeplaySelection only fires on playback messages). Publish
      // the idle state once: the client sees track null and sends
      // collection.activate for its remembered track.
      syncFreeplayPlayerUpdate(ctx, peer, {
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
    await syncSharedPeerAudio(ctx, peer);
  }

  updateClient(peer.id, {
    paired: peer.paired,
    freeplayPaired: peer.freeplayPaired,
    freeplay: active
  });
  peer.freeplaySettled = true;
  if (!active) await syncSharedPeerAudio(ctx, peer);
  sendPairingState(ctx, peer);
  if (changed || peer.channel?.readyState === 'open') ctx.sendCurrentState(peer);
  if (peer.mediaSyncPending || peer.mediaChannel?.readyState === 'open') {
    peer.mediaSyncPending = false;
    syncPeerMediaSource(ctx, peer);
  }
}

export async function persistPairingAgreement(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  freeplay: boolean
): Promise<void> {
  const { core } = ctx;
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

export function syncPeerMediaSource(ctx: MultiplayerHostContext, peer: PeerConnection): void {
  const { core } = ctx;
  if (peer.freeplay) {
    const track = peer.freeplayPlayer?.track ?? null;
    const mode = peer.freeplayPlayer?.delivery ?? 'none';
    const generationId = peer.freeplayDelivery?.generationId ?? null;
    syncPeerSourceFile(
      peer,
      mode === 'source-file' ? track : null,
      mode === 'source-file' ? generationId : null
    );
    if (mode === 'render') {
      syncPeerRenderSource(ctx, peer, track, generationId);
    } else {
      syncPeerRenderSource(ctx, peer, null, null);
    }
    return;
  }
  const track = core.latestHostState?.track ?? null;
  const mode = core.latestDelivery.mode;
  const generationId = core.latestDelivery.generationId;
  syncPeerSourceFile(
    peer,
    mode === 'source-file' ? track : null,
    mode === 'source-file' ? generationId : null
  );
  if (mode === 'render') {
    syncPeerRenderSource(ctx, peer, track, generationId);
  } else {
    syncPeerRenderSource(ctx, peer, null, null);
  }
}

export function syncPeerRenderSource(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  track: TrackItem | null,
  generationId: string | null
): void {
  const { core } = ctx;
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
  void multiplayerRenderCoordinator.acquireRender(track, bitrateKbps).then((render) => {
    if (peer.renderState
      || core.state.mode !== 'hosting'
      || peer.renderChannel?.readyState !== 'open'
      || !renderStillCurrent(ctx, peer, track, generationId)) {
      multiplayerRenderCoordinator.unpin(key);
      return;
    }
    const bufferMs = effectiveRenderBufferMs(ctx);
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
      targetTimeMs: playheadMsForPeer(ctx, peer),
      aheadMs: bufferMs,
      protectionMs: bufferMs,
      receivedRanges: [],
      sent: new Set(),
      initSent: false
    };
    sendToPeer(peer, { kind: 'render.manifest', manifest: { ...render.manifest, generationId } });
    schedulePeerRender(peer, playheadMsForPeer(ctx, peer));
  }).catch((error) => {
    if (core.state.mode !== 'hosting' || !track) return;
    if (!renderStillCurrent(ctx, peer, track, generationId)) return;
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
      ctx.syncHostAudio(core.latestHostState?.track ?? null);
      ctx.syncHostSourceFiles(core.latestHostState?.track ?? null);
    }
  });
}

export function syncPeerSourceFile(
  peer: PeerConnection,
  track: TrackItem | null,
  generationId: string | null
): void {
  const channel = peer.mediaChannel;
  const key = track && generationId
    ? `${generationId}:${track.id}:${track.size}:${track.lastModified}`
    : '';
  if (key && (!channel || channel.readyState !== 'open' || !track?.file)) {
    if (peer.sourceTrackKey) {
      peer.mediaTransferToken += 1;
      peer.mediaOutgoing = [];
      peer.mediaQueuedBytes = 0;
      peer.sourceTrackKey = '';
    }
    return;
  }
  if (peer.sourceTrackKey === key) return;

  peer.mediaTransferToken += 1;
  peer.mediaOutgoing = [];
  peer.mediaQueuedBytes = 0;
  peer.sourceTrackKey = key;
  if (!track?.file || !generationId) return;
  const token = peer.mediaTransferToken;
  void transferSourceFile(peer, track, track.file, token, generationId).catch((error) => {
    logWarning('multiplayer', 'Source-file transfer failed', {
      peerId: peer.id,
      generationId,
      error
    });
  });
}

export function renderStillCurrent(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  track: TrackItem,
  generationId: string
): boolean {
  const { core } = ctx;
  if (peer.freeplay) {
    return peer.freeplayPlayer?.delivery === 'render'
      && peer.freeplayPlayer.track?.id === track.id
      && peer.freeplayDelivery?.generationId === generationId;
  }
  return core.latestDelivery.mode === 'render'
    && core.latestHostState?.track?.id === track.id
    && core.latestDelivery.generationId === generationId;
}

export function handlePeerRenderNeed(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  need: MultiplayerRenderNeed
): void {
  const { core } = ctx;
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
  schedulePeerRender(peer, playheadMsForPeer(ctx, peer));
}

export function playheadMsForPeer(ctx: MultiplayerHostContext, peer: PeerConnection): number {
  const { core } = ctx;
  const seconds = peer.freeplay
    ? peer.freeplayPlayer?.snapshot.currentTime ?? 0
    : core.latestHostState?.playback.currentTime ?? 0;
  return Math.max(0, seconds * 1_000);
}

export function effectiveRenderBufferMs(ctx: MultiplayerHostContext): number {
  return ctx.core.multiplayerSettings.multiplayerAudioBufferMs;
}

export function sendPairingState(ctx: MultiplayerHostContext, peer: PeerConnection): void {
  const { core } = ctx;
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

export async function syncSharedPeerAudio(ctx: MultiplayerHostContext, peer: PeerConnection): Promise<void> {
  const { core } = ctx;
  const track = core.latestDelivery.mode === 'stream'
    ? multiplayerAudioService.getHostTrack()
    : null;
  if (peer.audioSender?.track !== track) {
    await peer.audioSender?.replaceTrack(track).catch(() => undefined);
  }
  await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
}

export function syncFreeplayPlayerUpdate(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  update: MultiplayerFreeplayPlayerUpdate
): void {
  if (!peer.freeplay || peer.channel?.readyState !== 'open') return;
  const delivery = ensureFreeplayDelivery(peer, update.delivery);
  sendToPeer(peer, { kind: 'delivery', delivery });
  const playback: MultiplayerPlayback = {
    ...update.playback,
    generationId: delivery.generationId,
    track: update.playback.track ? sanitizeTrackItem(update.playback.track) : null
  };
  sendToPeer(peer, { kind: 'playback', playback });
  syncPeerMediaSource(ctx, peer);
  syncFreeplayArtwork(peer, peer.freeplayPlayer?.track ?? null);
}

export function ensureFreeplayDelivery(
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

export async function handleFreeplayCommand(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  command: MultiplayerCommand
): Promise<boolean> {
  const { core } = ctx;
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
      return stepFreeplayTrack(ctx, peer, -1, false);
    case 'transport.next':
      return stepFreeplayTrack(ctx, peer, 1, false);
    case 'transport.seek': {
      const duration = player.snapshot.duration;
      return duration <= 0 || command.seconds <= duration + 1
        ? player.seek(command.seconds)
        : false;
    }
    case 'queue.shuffle':
      peer.freeplayShuffle = !peer.freeplayShuffle;
      peer.freeplayNavigation?.reset();
      sendFreeplayState(peer);
      return true;
    case 'queue.repeat':
      peer.freeplayRepeatMode = cycleMultiplayerRepeatMode(peer.freeplayRepeatMode);
      sendFreeplayState(peer);
      return true;
    case 'collection.activate':
      return activateFreeplayTrack(ctx, peer, command.collection, command.itemId);
  }
}

export async function activateFreeplayTrack(
  ctx: MultiplayerHostContext,
  peer: PeerConnection,
  collection: MultiplayerCollection,
  itemId: string
): Promise<boolean> {
  const { core } = ctx;
  if (!core.latestHostState || !peer.freeplayPlayer) return false;
  const items = freeplayCollectionItems(ctx, peer, collection);
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
  const track = await materializeTrackItem(source, false);
  if (peer.freeplayActivation !== activation
    || !track
    || !peer.freeplay
    || !peer.freeplayPlayer) {
    if (peer.freeplayActivation === activation) peer.freeplayActivation = null;
    return false;
  }
  if (peer.freeplayCollection !== collection) peer.freeplayNavigation?.reset();
  peer.freeplayCollection = collection;
  core.freeplaySelections.set(peer.id, track);
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

export function beginFreeplayPlaybackPreparation(peer: PeerConnection): void {
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

export async function stepFreeplayTrack(
  ctx: MultiplayerHostContext,
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
  return next ? activateFreeplayTrack(ctx, peer, peer.freeplayCollection, next.id) : false;
}

export async function handleFreeplayTrackEnded(ctx: MultiplayerHostContext, peer: PeerConnection, trackId: string): Promise<void> {
  if (!peer.freeplay || peer.freeplayPlayer?.track?.id !== trackId) return;
  await stepFreeplayTrack(ctx, peer, 1, true);
}

export function freeplayCollectionItems(ctx: MultiplayerHostContext, peer: PeerConnection, collection: MultiplayerCollection): TrackItem[] {
  const { core } = ctx;
  if (!core.latestHostState) return [];
  if (collection === 'queue') return resolveFreeplayQueueItems(ctx, peer);
  return collection === 'favorites' ? core.latestHostState.favorites : core.latestHostState.library;
}

export function resolveFreeplayQueueItems(ctx: MultiplayerHostContext, peer: PeerConnection): TrackItem[] {
  const { core } = ctx;
  if (!core.latestHostState) return [];
  const byId = new Map<string, TrackItem>();
  for (const item of [
    ...core.latestHostState.library,
    ...core.latestHostState.favorites,
    ...core.latestHostState.queue
  ]) if (!byId.has(item.id)) byId.set(item.id, item);
  return peer.freeplayQueue.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function sendFreeplayCatalog(ctx: MultiplayerHostContext, peer: PeerConnection): void {
  const { core } = ctx;
  if (!core.latestHostState) return;
  sendToPeer(peer, {
    kind: 'catalog',
    catalog: {
      revision: core.catalogRevision,
      queue: resolveFreeplayQueueItems(ctx, peer).map(sanitizeTrackItem),
      library: core.latestHostState.library.map(sanitizeTrackItem),
      favorites: core.latestHostState.favorites.map(sanitizeTrackItem),
      shuffleEnabled: peer.freeplayShuffle,
      repeatMode: peer.freeplayRepeatMode
    }
  });
}

export function sendFreeplayState(peer: PeerConnection): void {
  if (!peer.freeplay) return;
  sendToPeer(peer, {
    kind: 'state',
    shuffleEnabled: peer.freeplayShuffle,
    repeatMode: peer.freeplayRepeatMode
  });
}

export function syncFreeplayArtwork(peer: PeerConnection, track: TrackItem | null): void {
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
