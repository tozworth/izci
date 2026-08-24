import { logDebug, logInfo } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import { resolveMultiplayerConnectionRoute } from './multiplayer-ice';
import { sendToPeer } from './multiplayer-peer';
import type { MultiplayerSynchronizedStart } from './multiplayer-protocol';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { decodeRenderFrame } from './multiplayer-render-transfer';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { parseSourceFileFrame } from './multiplayer-source-transfer';
import { writeReceiveAudioPreference } from './multiplayer-utils';
import type { PeerConnection, SourceFileBeginFrame } from './multiplayer-types';
import type { MultiplayerClientContext } from './multiplayer-client';

export function cancelSynchronizedStart(ctx: MultiplayerClientContext): void {
  if (ctx.synchronizedStartTimer !== null) window.clearTimeout(ctx.synchronizedStartTimer);
  ctx.synchronizedStartTimer = null;
  ctx.synchronizedStartGenerationId = null;
  ctx.synchronizedStartAt = 0;
  multiplayerSourcePlaybackService.cancelSynchronizedStart();
}

export function applySynchronizedStart(
  ctx: MultiplayerClientContext,
  peer: PeerConnection,
  start: MultiplayerSynchronizedStart
): void {
  const { core } = ctx;
  if (core.clientPeer !== peer
    || core.state.freeplay
    || !ctx.transition.isCurrent(start.generationId, start.trackId)) return;
  cancelSynchronizedStart(ctx);
  ctx.synchronizedStartGenerationId = start.generationId;
  ctx.synchronizedStartAt = start.startAt;
  if (core.state.remoteDelivery.mode === 'source-file') {
    multiplayerSourcePlaybackService.scheduleSynchronizedStart(
      start.generationId,
      start.trackId,
      start.positionSeconds,
      start.startAt
    );
    return;
  }
  if (core.state.remoteDelivery.mode === 'render') {
    const renderRelease = () => {
      ctx.synchronizedStartTimer = null;
      if (core.clientPeer !== peer
        || ctx.synchronizedStartGenerationId !== start.generationId
        || !ctx.transition.isCurrent(start.generationId, start.trackId, 'render')) return;
      ctx.synchronizedStartAt = 0;
      multiplayerRenderPlaybackService.resumeAudible();
    };
    ctx.synchronizedStartTimer = window.setTimeout(
      renderRelease,
      Math.max(0, start.startAt - Date.now())
    );
    return;
  }
  if (core.state.remoteDelivery.mode !== 'stream') return;
  const release = () => {
    ctx.synchronizedStartTimer = null;
    if (core.clientPeer !== peer
      || ctx.synchronizedStartGenerationId !== start.generationId
      || !ctx.transition.isCurrent(start.generationId, start.trackId, 'stream')) return;
    ctx.synchronizedStartAt = 0;
    multiplayerAudioService.setRemoteAudible(core.state.receiveAudio);
  };
  ctx.synchronizedStartTimer = window.setTimeout(release, Math.max(0, start.startAt - Date.now()));
}

export async function attachClientRemoteAudio(
  ctx: MultiplayerClientContext,
  peer: PeerConnection,
  generationId: string
): Promise<void> {
  const { core, transition } = ctx;
  if (core.clientPeer !== peer || !core.state.receiveAudio || core.latestDelivery.mode !== 'stream') return;
  const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
  const track = receiver?.track;
  if (!track || track.readyState === 'ended') return;
  track.enabled = true;
  const ready = await multiplayerAudioService.attachRemoteTrack(track, new MediaStream([track]), (audioStatus) => {
    if (core.clientPeer === peer
      && core.latestDelivery.generationId === generationId
      && core.state.mode === 'client'
      && core.state.receiveAudio
      && core.latestDelivery.mode === 'stream') {
      if (audioStatus === 'unavailable') transition.setReceiverPipelineReady(false);
      core.publish({ audioStatus });
    }
  });
  if (core.clientPeer !== peer || core.latestDelivery.generationId !== generationId) return;
  transition.setReceiverPipelineReady(ready);
  multiplayerAudioService.setRemoteAudible(
    core.state.receiveAudio && core.state.remotePlayback.snapshot.state === 'playing'
  );
  sendClientPlaybackReadyIfPossible(ctx, peer);
}

export function attachClientMediaChannel(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core, transition } = ctx;
  const channel = peer.mediaChannel;
  if (!channel) return;
  channel.binaryType = 'arraybuffer';
  let pending: {
    frame: SourceFileBeginFrame;
    chunks: ArrayBuffer[];
    received: number;
  } | null = null;

  channel.onmessage = (event) => {
    if (core.clientPeer !== peer || peer.mediaChannel !== channel) return;
    if (typeof event.data === 'string') {
      const frame = parseSourceFileFrame(event.data);
      if (!frame) return;
      if (frame.kind === 'file.begin') {
        if (!transition.isCurrent(frame.generationId, frame.trackId, 'source-file')) {
          pending = null;
          return;
        }
        pending = { frame, chunks: [], received: 0 };
        multiplayerAudioService.setRemoteAudible(false);
        logDebug('multiplayer', 'Source-file transfer started', {
          generationId: frame.generationId,
          trackId: frame.trackId,
          bytes: frame.size,
          generationCurrent: transition.isCurrent(frame.generationId, frame.trackId, 'source-file')
        });
        // Keep the current file audible until its replacement is completely received
        // and prepared. Stopping the only active media element here lets mobile
        // Chromium suspend a locked client before the remaining chunks can arrive.
        if (core.state.receiveAudio) core.publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
        return;
      }
      if (!pending || pending.frame.transferId !== frame.transferId) return;
      if (!transition.isCurrent(
        pending.frame.generationId,
        pending.frame.trackId,
        'source-file'
      )) {
        pending = null;
        return;
      }
      const complete = pending;
      pending = null;
      if (complete.received !== complete.frame.size) {
        core.publish({ audioStatus: 'unavailable' });
        requestSourceRetry(ctx, peer, complete.frame.generationId);
        return;
      }
      const file = new File(complete.chunks, complete.frame.name, {
        type: complete.frame.type,
        lastModified: complete.frame.lastModified
      });
      core.pendingClientSourceFile = {
        trackId: complete.frame.trackId,
        generationId: complete.frame.generationId,
        file
      };
      const generationCurrent = transition.isCurrent(
        complete.frame.generationId,
        complete.frame.trackId,
        'source-file'
      );
      logDebug('multiplayer', 'Source-file transfer completed', {
        generationId: complete.frame.generationId,
        trackId: complete.frame.trackId,
        bytes: complete.received,
        generationCurrent
      });
      if (generationCurrent) loadPendingClientSourceFile(ctx, peer);
      return;
    }
    if (!pending || !(event.data instanceof ArrayBuffer)) return;
    if (!transition.isCurrent(
      pending.frame.generationId,
      pending.frame.trackId,
      'source-file'
    )) {
      pending = null;
      return;
    }
    if (pending.received + event.data.byteLength > pending.frame.size) {
      const generationId = pending.frame.generationId;
      pending = null;
      core.publish({ audioStatus: 'unavailable' });
      requestSourceRetry(ctx, peer, generationId);
      return;
    }
    pending.chunks.push(event.data);
    pending.received += event.data.byteLength;
  };
  channel.onclose = () => {
    pending = null;
    if (core.clientPeer === peer && core.latestDelivery.mode === 'source-file') {
      transition.setSourceReady(
        core.latestDelivery.generationId,
        core.latestDelivery.trackId ?? '',
        false
      );
      multiplayerSourcePlaybackService.clearLoadedFile();
      core.publish({ audioStatus: 'unavailable' });
    }
    if (core.clientPeer === peer
      && core.allowClientReconnect
      && peer.pc.connectionState !== 'closed') peer.pc.close();
  };
}

export function attachClientRenderChannel(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core } = ctx;
  const channel = peer.renderChannel;
  if (!channel) return;
  channel.onmessage = (event) => {
    if (core.clientPeer !== peer || peer.renderChannel !== channel) return;
    if (!(event.data instanceof ArrayBuffer)) return;
    const frame = decodeRenderFrame(event.data);
    if (!frame) return;
    multiplayerRenderPlaybackService.ingest(
      frame.renderId,
      frame.epoch,
      frame.clusterIndex,
      frame.fragmentOffset,
      frame.payload
    );
  };
  channel.onclose = () => {
    if (core.clientPeer === peer
      && core.allowClientReconnect
      && peer.pc.connectionState !== 'closed') peer.pc.close();
  };
}

export function loadPendingClientSourceFile(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core, transition } = ctx;
  const pending = core.pendingClientSourceFile;
  const remoteTrack = core.state.remotePlayback.track;
  if (!pending
    || !remoteTrack
    || remoteTrack.id !== pending.trackId
    || core.state.remoteDelivery.mode !== 'source-file'
    || core.state.remoteDelivery.generationId !== pending.generationId) return;
  core.pendingClientSourceFile = null;
  void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then(async (loaded) => {
    if (core.clientPeer !== peer) return;
    const generationStillCurrent = core.state.remoteDelivery.mode === 'source-file'
      && core.state.remoteDelivery.generationId === pending.generationId;
    if (!generationStillCurrent) return;
    const audioReady = loaded && core.state.receiveAudio
      ? await multiplayerSourcePlaybackService.resume()
      : false;
    if (core.clientPeer !== peer || core.state.remoteDelivery.generationId !== pending.generationId) return;
    transition.setSourceReady(pending.generationId, pending.trackId, loaded);
    core.publish({
      audioStatus: !core.state.receiveAudio
        ? 'refused'
        : loaded
        ? audioReady ? 'playing' : 'blocked'
        : 'unavailable',
      averageAudioBitrateKbps: null
    });
    logInfo('freeplay', 'Source-file playback prepared', {
      generationId: pending.generationId,
      trackId: pending.trackId,
      loaded,
      audioReady
    });
    sendClientPlaybackReadyIfPossible(ctx, peer);
    if (!loaded && generationStillCurrent) requestSourceRetry(ctx, peer, pending.generationId);
  });
}

export function sendRenderReadyMessages(
  ctx: MultiplayerClientContext,
  peer: PeerConnection,
  epoch: number,
  positionMs: number
): void {
  const state = multiplayerRenderPlaybackService.getState();
  if (!state.generationId || !state.renderId) return;
  if (ctx.renderReadySentGeneration === state.generationId && ctx.renderReadySentEpoch === epoch) return;
  ctx.renderReadySentGeneration = state.generationId;
  ctx.renderReadySentEpoch = epoch;
  logInfo('multiplayer', 'Buffered Opus client ready', {
    generationId: state.generationId,
    epoch,
    positionMs: Math.round(positionMs)
  });
  sendToPeer(peer, {
    kind: 'render.ready',
    generationId: state.generationId,
    renderId: state.renderId,
    epoch,
    positionMs: Math.round(positionMs)
  });
}

export function sendClientPlaybackReadyIfPossible(
  ctx: MultiplayerClientContext,
  peer: PeerConnection
): void {
  const { core, transition } = ctx;
  if (core.clientPeer !== peer) return;
  if (core.latestDelivery.mode === 'render') {
    const state = multiplayerRenderPlaybackService.getState();
    if (!state.ready || !state.generationId) return;
    sendRenderReadyMessages(ctx, peer, state.epoch, 0);
    return;
  }
  const generationId = transition.takeReadyGeneration();
  if (!generationId) return;
  logInfo('freeplay', 'Client playback pipeline ready', { generationId });
  sendToPeer(peer, {
    kind: 'playback.ready',
    generationId
  });
}

function requestSourceRetry(
  ctx: MultiplayerClientContext,
  peer: PeerConnection,
  generationId: string
): void {
  const { core, transition } = ctx;
  if (!transition.isCurrent(generationId, core.state.remoteDelivery.trackId, 'source-file')) return;
  if (ctx.sourceRetryGenerationId !== generationId) {
    ctx.sourceRetryGenerationId = generationId;
    ctx.sourceRetryCount = 0;
  }
  if (ctx.sourceRetryCount >= 2) return;
  ctx.sourceRetryCount += 1;
  sendToPeer(peer, { kind: 'source.retry', generationId });
}

export async function updateClientConnectionRoute(
  ctx: MultiplayerClientContext,
  peer: PeerConnection
): Promise<void> {
  const { core } = ctx;
  try {
    const route = resolveMultiplayerConnectionRoute((await peer.pc.getStats()).values());
    if (core.clientPeer === peer && route) core.publish({ connectionRoute: route });
  } catch {
    // Connection stats are optional; the client remains usable without a route label.
  }
}

export function applyClientAudioBuffer(ctx: MultiplayerClientContext, peer: PeerConnection): void {
  const { core } = ctx;
  multiplayerRenderPlaybackService.updateWindowMs(
    core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
  );
  for (const receiver of peer.pc.getReceivers()) {
    if (receiver.track.kind !== 'audio') continue;
    applyReceiverBuffer(ctx, receiver);
  }
}

export function applyReceiverBuffer(ctx: MultiplayerClientContext, receiver: RTCRtpReceiver): void {
  const { core } = ctx;
  const targetMs = core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs;
  const supported = setMultiplayerReceiverBuffer(receiver, targetMs);
  const effectiveMs = 'jitterBufferTarget' in receiver
    && typeof receiver.jitterBufferTarget === 'number'
    ? receiver.jitterBufferTarget
    : null;
  logInfo('multiplayer', 'Receiver buffer target updated', {
    targetMs,
    supported,
    effectiveMs
  });
}

export function setReceiveAudio(ctx: MultiplayerClientContext, enabled: boolean): void {
  const { core, transition } = ctx;
  if (core.state.receiveAudio === enabled) return;
  writeReceiveAudioPreference(enabled);
  core.publish({ receiveAudio: enabled });
  transition.setReceiveAudio(enabled);
  if (core.state.mode !== 'client' || !core.clientPeer) return;

  const sourcePlaying = multiplayerSourcePlaybackService.setEnabled(enabled);
  if (!enabled) sendClientPlaybackReadyIfPossible(ctx, core.clientPeer);
  if (core.latestDelivery.mode === 'source-file') {
    multiplayerAudioService.setRemoteAudible(false);
    core.publish({
      audioStatus: enabled
        ? sourcePlaying ? 'playing' : multiplayerSourcePlaybackService.active ? 'ready' : 'connecting'
        : 'refused',
      averageAudioBitrateKbps: null
    });
    return;
  }
  if (core.latestDelivery.mode === 'render') {
    multiplayerRenderPlaybackService.setEnabled(enabled);
    if (enabled) multiplayerRenderPlaybackService.updateWindowMs(
      core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs
    );
    core.publish({
      audioStatus: enabled ? 'connecting' : 'refused',
      averageAudioBitrateKbps: null
    });
    if (enabled) sendClientPlaybackReadyIfPossible(ctx, core.clientPeer);
    return;
  }

  const receiver = core.clientPeer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
  const track = receiver?.track;
  if (!track || track.readyState === 'ended') {
    core.publish({ audioStatus: enabled ? 'unavailable' : 'refused', averageAudioBitrateKbps: null });
    return;
  }
  track.enabled = enabled;
  if (!enabled) {
    multiplayerAudioService.setRemoteAudible(false);
    core.publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
    return;
  }
  if (core.latestDelivery.mode !== 'stream') {
    core.publish({ audioStatus: 'disabled' });
    return;
  }
  void multiplayerAudioService.warmRemoteAudio();
  void attachClientRemoteAudio(ctx, core.clientPeer, core.latestDelivery.generationId);
}
