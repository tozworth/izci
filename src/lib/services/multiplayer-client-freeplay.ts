import { logInfo } from '$lib/services/logging';
import {
  multiplayerFreeplayState,
  rememberMultiplayerFreeplayState
} from '$lib/stores/multiplayer-freeplay-state';
import { sendToPeer } from './multiplayer-peer';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { sanitizeFreeplayQueueIds } from './multiplayer-utils';
import type { MultiplayerClientContext } from './multiplayer-client';

export function updateLocalTimelineMode(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  multiplayerSourcePlaybackService.setLocalTimeline(
    core.state.mode === 'client'
      && core.state.freeplay
      && core.state.remoteDelivery.mode === 'source-file'
  );
}

export function persistFreeplayState(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  if (core.state.mode !== 'client' || !core.state.freeplay || !core.clientHostId) return;
  const previous = multiplayerFreeplayState.getSnapshot();
  const next = {
    hostId: core.clientHostId,
    queue: core.state.freeplayQueue,
    shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
    repeatMode: core.state.remoteCatalog.repeatMode,
    currentTrackId: core.state.remotePlayback.track?.id
      ?? (previous?.hostId === core.clientHostId ? previous.currentTrackId : null)
  };
  if (previous
    && previous.hostId === next.hostId
    && previous.shuffleEnabled === next.shuffleEnabled
    && previous.repeatMode === next.repeatMode
    && previous.currentTrackId === next.currentTrackId
    && previous.queue.length === next.queue.length
    && previous.queue.every((id, index) => id === next.queue[index])) return;
  rememberMultiplayerFreeplayState(next);
}

export function sendFreeplayQueueToPeer(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  if (!core.clientPeer || !core.state.freeplay) return;
  sendToPeer(core.clientPeer, {
    kind: 'freeplay.queue',
    itemIds: core.state.freeplayQueue,
    shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
    repeatMode: core.state.remoteCatalog.repeatMode
  });
}

export function setFreeplayQueue(ctx: MultiplayerClientContext, itemIds: string[]): void {
  ctx.core.publish({ freeplayQueue: sanitizeFreeplayQueueIds(itemIds) });
  persistFreeplayState(ctx);
  sendFreeplayQueueToPeer(ctx);
}

export function restoreFreeplayStateForHost(ctx: MultiplayerClientContext, hostId: string): void {
  const { core } = ctx;
  const saved = multiplayerFreeplayState.getSnapshot();
  if (!saved || saved.hostId !== hostId) return;
  core.publish({
    freeplayQueue: saved.queue,
    remoteCatalog: {
      ...core.state.remoteCatalog,
      shuffleEnabled: saved.shuffleEnabled,
      repeatMode: saved.repeatMode
    }
  });
}

export function tryResumeFreeplaySelection(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  const trackId = ctx.pendingFreeplayResumeTrackId;
  if (!trackId || !core.state.freeplay || core.state.remotePlayback.track) return;
  if (!core.state.freeplayQueue.includes(trackId)) {
    ctx.pendingFreeplayResumeTrackId = null;
    return;
  }
  ctx.pendingFreeplayResumeTrackId = null;
  logInfo('freeplay', 'Requesting persisted Freeplay selection', { trackId });
  ctx.sendCommand({ type: 'collection.activate', collection: 'queue', itemId: trackId });
}
