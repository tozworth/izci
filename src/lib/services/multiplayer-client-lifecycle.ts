import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import { clearMultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { audioBusService } from './audio-bus';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { EMPTY_CATALOG, EMPTY_DELIVERY, EMPTY_REMOTE_PLAYBACK } from './multiplayer-types';
import { isMultiplayerClientTransportHealthy } from './multiplayer-utils';
import type { MultiplayerClientContext } from './multiplayer-client';
import { sendToPeer } from './multiplayer-peer';
import {
  applyClientAudioBuffer,
  sendClientPlaybackReadyIfPossible
} from './multiplayer-client-audio';

export function beginClientPlaybackSession(ctx: MultiplayerClientContext): void {
  const { core, transition } = ctx;
  core.allowClientReconnect = true;
  core.reconnectAttempts = 0;
  if (core.state.receiveAudio) void audioBusService.resume();
  multiplayerSourcePlaybackService.beginClientSession((trackId, generationId) => {
    if (!core.clientPeer || core.state.mode !== 'client'
      || !transition.isCurrent(generationId, trackId, 'source-file')) return;
    if (core.state.freeplay && core.state.remoteCatalog.repeatMode === 'one') {
      multiplayerSourcePlaybackService.replay();
      return;
    }
    if (core.state.freeplay || core.state.hostImplementation?.product === 'izci-server') {
      sendToPeer(core.clientPeer, { kind: 'playback.ended', generationId, trackId });
    }
  });
  multiplayerSourcePlaybackService.setEnabled(core.state.receiveAudio);
}

export function scheduleClientReconnect(ctx: MultiplayerClientContext, delay?: number): void {
  const { core } = ctx;
  if (!core.allowClientReconnect || core.state.mode !== 'client' || core.reconnectInFlight || core.reconnectTimer !== null) return;
  const guest = core.serverGuest;
  if (!guest) return;
  const generation = core.transportGeneration;
  const isCurrent = () => core.transportGeneration === generation && core.serverGuest === guest;
  const backoff = [2_000, 5_000, 10_000, 20_000, 30_000];
  const wait = delay ?? backoff[Math.min(core.reconnectAttempts, backoff.length - 1)];
  logInfo('multiplayer', 'Client reconnect scheduled', {
    attempt: core.reconnectAttempts + 1,
    waitMs: wait,
    hostId: core.clientHostId
  });
  core.reconnectTimer = window.setTimeout(() => {
    core.reconnectTimer = null;
    if (!isCurrent() || !core.allowClientReconnect || core.state.mode !== 'client') return;
    core.reconnectInFlight = true;
    core.reconnectAttempts += 1;
    logInfo('multiplayer', 'Client reconnect timer fired', {
      attempt: core.reconnectAttempts,
      hostId: core.clientHostId
    });
    core.publish({
      connectionStatus: 'connecting',
      reconnecting: true,
      audioStatus: 'connecting',
      connectionDetail: 'Reconnecting and gathering fresh ICE candidates...',
      message: 'Reconnecting to the host...'
    });
    const timeout = new AbortController();
    const deadline = window.setTimeout(() => timeout.abort(), 45_000);
    void guest.reconnectSignaling(timeout.signal)
      .then(() => {
        if (!isCurrent()) return;
        core.reconnectInFlight = false;
        if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(ctx, 15_000);
      })
      .catch((error) => {
        if (!isCurrent()) return;
        core.reconnectInFlight = false;
        logWarning('multiplayer', 'Client reconnect attempt will retry', {
          attempt: core.reconnectAttempts,
          error
        });
        scheduleClientReconnect(ctx);
      })
      .finally(() => window.clearTimeout(deadline));
  }, wait);
}

export function clearReconnectTimer(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  if (core.reconnectTimer === null) return;
  window.clearTimeout(core.reconnectTimer);
  core.reconnectTimer = null;
}

export function handleClientResume(ctx: MultiplayerClientContext): void {
  const { core } = ctx;
  if (document.visibilityState === 'hidden') return;
  if (core.state.mode !== 'client' || !core.allowClientReconnect) return;
  if (core.clientPeer && isMultiplayerClientTransportHealthy(
    core.clientPeer.pc.connectionState,
    core.clientPeer.channel?.readyState
  )) {
    logDebug('multiplayer', 'Client resume kept healthy peer', {
      connectionState: core.clientPeer.pc.connectionState,
      channelState: core.clientPeer.channel?.readyState,
      delivery: core.latestDelivery.mode
    });
    // A long-lived background connection can remain healthy while Media Session keeps
    // mobile playback alive. Elapsed hidden time alone is not a reason to replace it.
    clearReconnectTimer(ctx);
    applyClientAudioBuffer(ctx);
    if (core.latestDelivery.mode === 'source-file') void multiplayerSourcePlaybackService.resume();
    else if (core.latestDelivery.mode === 'render') void resumeAudio(ctx);
    return;
  }
  clearReconnectTimer(ctx);
  scheduleClientReconnect(ctx, 0);
}

export async function leave(ctx: MultiplayerClientContext): Promise<void> {
  const { core } = ctx;
  if (core.state.mode !== 'client') return;
  logInfo('multiplayer', 'Client left session', { freeplay: core.state.freeplay });
  clearMultiplayerLastSession();
  core.allowClientReconnect = false;
  clearReconnectTimer(ctx);
  await core.resetSession(true);
  await multiplayerSourcePlaybackService.endClientSession();
  core.clientHostId = null;
  core.publish({
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostMotd: '',
    hostVersion: null,
    hostImplementation: null,
    hostProtocol: null,
    freeplay: false,
    freeplayQueue: [],
    clients: [],
    remoteCatalog: EMPTY_CATALOG,
    remotePlayback: EMPTY_REMOTE_PLAYBACK,
    remoteArtwork: null,
    remoteArtworkResolvedTrackKey: '',
    remoteOdaBackground: null,
    audioStatus: 'idle',
    remoteDelivery: { ...EMPTY_DELIVERY },
    connectionRoute: null,
    audioBitrateKbps: null,
    connectionDetail: null,
    message: null
  });
}

export async function resumeAudio(ctx: MultiplayerClientContext): Promise<boolean> {
  const { core } = ctx;
  if (multiplayerSourcePlaybackService.active) {
    const ready = await multiplayerSourcePlaybackService.resume();
    if (core.state.mode === 'client' && core.state.receiveAudio) {
      core.publish({ audioStatus: ready ? 'playing' : 'blocked' });
    }
    if (core.clientPeer) sendClientPlaybackReadyIfPossible(ctx, core.clientPeer);
    return ready;
  }
  if (core.latestDelivery.mode === 'render') {
    multiplayerRenderPlaybackService.resumeAudible();
    if (core.clientPeer) sendClientPlaybackReadyIfPossible(ctx, core.clientPeer);
    return true;
  }
  return false;
}
