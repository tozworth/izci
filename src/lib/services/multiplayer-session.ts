import { writable } from 'svelte/store';
import type { ExperimentalSettings } from '$lib/contracts/experimental-settings';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { logDebug, logWarning } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import { disposePeerConnection, sendToPeer } from './multiplayer-peer';
import { readReceiveAudioPreference } from './multiplayer-utils';
import { createMultiplayerHostSide } from './multiplayer-host';
import { createMultiplayerClientSide } from './multiplayer-client';
import {
  EMPTY_CATALOG,
  EMPTY_DELIVERY,
  EMPTY_REMOTE_PLAYBACK,
  type CreateMultiplayerSessionOptions,
  type MultiplayerSessionController,
  type MultiplayerSessionCore,
  type MultiplayerSessionState
} from './multiplayer-types';

export function createMultiplayerSession({
  handleHostCommand,
  pauseHostPlayback,
  resumeHostPlayback
}: CreateMultiplayerSessionOptions): MultiplayerSessionController {
  const store = writable<MultiplayerSessionState>(getInitialState());

  const core: MultiplayerSessionCore = {
    state: getInitialState(),
    publish: () => undefined,
    updateClient: () => undefined,
    multiplayerSettings: experimentalSettings.getSnapshot(),
    firebaseRuntime: null,
    roomRef: null,
    hostDirectoryRef: null,
    ownPeerRef: null,
    roomCode: null,
    clientHostId: null,
    roomDisconnect: null,
    hostDirectoryDisconnect: null,
    peerDisconnect: null,
    stopPeersListener: null,
    stopAnswerListener: null,
    hostPeers: new Map(),
    freeplaySelections: new Map(),
    clientPeer: null,
    pendingClientSourceFile: null,
    hostAudioBufferMs: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    reconnectInFlight: false,
    allowClientReconnect: false,
    latestHostState: null,
    catalogRevision: 0,
    lastCatalogSources: null,
    lastPlaybackSource: null,
    lastTrackSource: null,
    latestHostArtwork: null,
    hostArtworkTrackKey: '',
    hostArtworkResolvedTrackKey: '',
    hostArtworkLoadToken: 0,
    latestDelivery: { ...EMPTY_DELIVERY },
    renderFallbackTrackIds: new Set(),
    hostPlaybackPreparation: null,
    bypassHostPlaybackGateTrackId: null,
    rejectedPeerIds: new Set(),
    acceptingPeerIds: new Set(),
    answeredTurnCredentialRequestIds: new Set(),
    resetSession: () => Promise.resolve()
  };

  core.publish = (patch) => {
    core.state = { ...core.state, ...patch };
    store.set(core.state);
  };
  core.updateClient = (id, patch) => {
    const existing = core.state.clients.find((client) => client.id === id);
    const clients = existing
      ? core.state.clients.map((client) => client.id === id ? { ...client, ...patch } : client)
      : [...core.state.clients, {
          id,
          name: patch.name ?? 'Guest',
          platform: patch.platform ?? 'Unknown',
          status: patch.status ?? 'connecting',
          paired: patch.paired ?? false,
          freeplayPaired: patch.freeplayPaired ?? false,
          freeplay: patch.freeplay ?? false
        }];
    core.publish({ clients });
  };

  const host = createMultiplayerHostSide(core, {
    handleHostCommand,
    pauseHostPlayback,
    resumeHostPlayback
  });
  const client = createMultiplayerClientSide(core);

  async function resetSession(removeRemote: boolean): Promise<void> {
    logDebug('multiplayer', 'Session reset started', {
      mode: core.state.mode,
      removeRemote,
      peers: core.hostPeers.size
    });
    client.clearReceiverMonitor();
    client.resetTransitions();
    core.stopPeersListener?.();
    core.stopAnswerListener?.();
    core.stopPeersListener = null;
    core.stopAnswerListener = null;
    for (const peer of core.hostPeers.values()) {
      disposePeerConnection(peer);
    }
    core.hostPeers.clear();
    core.freeplaySelections.clear();
    const previousClientPeer = core.clientPeer;
    core.clientPeer = null;
    if (previousClientPeer) disposePeerConnection(previousClientPeer);
    multiplayerAudioService.clearRemoteTrack();
    multiplayerSourcePlaybackService.clearLoadedFile();
    multiplayerRenderPlaybackService.release();
    core.pendingClientSourceFile = null;
    core.hostAudioBufferMs = null;
    if (core.hostPlaybackPreparation?.releaseTimer !== null
      && core.hostPlaybackPreparation?.releaseTimer !== undefined) {
      window.clearTimeout(core.hostPlaybackPreparation.releaseTimer);
    }
    core.hostPlaybackPreparation = null;
    core.bypassHostPlaybackGateTrackId = null;
    multiplayerAudioService.releaseHostTrack();

    try {
      if (removeRemote && core.firebaseRuntime && core.state.mode === 'hosting' && core.roomRef) {
        await core.firebaseRuntime.remove(core.roomRef);
      } else if (removeRemote && core.firebaseRuntime && core.ownPeerRef) {
        await core.firebaseRuntime.remove(core.ownPeerRef);
      }
      if (removeRemote && core.firebaseRuntime && core.state.mode === 'hosting' && core.hostDirectoryRef) {
        await core.firebaseRuntime.remove(core.hostDirectoryRef);
      }
    } catch (error) {
      // The disconnect registration remains a best-effort cleanup fallback.
      logWarning(
        'multiplayer',
        'Remote session cleanup failed; disconnect fallback remains registered',
        error
      );
    }
    await core.roomDisconnect?.cancel().catch(() => undefined);
    await core.hostDirectoryDisconnect?.cancel().catch(() => undefined);
    await core.peerDisconnect?.cancel().catch(() => undefined);
    core.roomDisconnect = null;
    core.hostDirectoryDisconnect = null;
    core.peerDisconnect = null;
    core.roomRef = null;
    core.roomCode = null;
    core.hostDirectoryRef = null;
    core.ownPeerRef = null;
    core.firebaseRuntime = null;
    core.lastCatalogSources = null;
    core.lastPlaybackSource = null;
    core.lastTrackSource = null;
    core.latestHostArtwork = null;
    core.hostArtworkTrackKey = '';
    core.hostArtworkResolvedTrackKey = '';
    core.hostArtworkLoadToken += 1;
    core.rejectedPeerIds.clear();
    core.acceptingPeerIds.clear();
    core.answeredTurnCredentialRequestIds.clear();
    core.renderFallbackTrackIds.clear();
    core.latestDelivery = { ...EMPTY_DELIVERY };
  }
  core.resetSession = resetSession;

  const unsubscribeSettings = experimentalSettings.subscribe((settings: ExperimentalSettings) => {
    const audioBufferChanged = settings.multiplayerAudioBufferMs
      !== core.multiplayerSettings.multiplayerAudioBufferMs;
    const freeplayPreferenceChanged = settings.multiplayerFreeplay
      !== core.multiplayerSettings.multiplayerFreeplay;
    const freeplayAudioChanged = settings.multiplayerStreamAudio
      !== core.multiplayerSettings.multiplayerStreamAudio;
    const opusBitrateChanged = settings.multiplayerOpusBitrateKbps
      !== core.multiplayerSettings.multiplayerOpusBitrateKbps;
    const fileTransferLimitChanged = settings.multiplayerFileTransferLimitMiB
      !== core.multiplayerSettings.multiplayerFileTransferLimitMiB;
    const renderCacheLimitChanged = settings.multiplayerRenderCacheLimitMiB
      !== core.multiplayerSettings.multiplayerRenderCacheLimitMiB;
    const waitForClientsDisabled = core.multiplayerSettings.multiplayerWaitForClients
      && !settings.multiplayerWaitForClients;
    const synchronizedPlaybackDisabled = core.multiplayerSettings.multiplayerSynchronizedPlayback
      && !settings.multiplayerSynchronizedPlayback;
    const synchronizedPlaybackEnabled = !core.multiplayerSettings.multiplayerSynchronizedPlayback
      && settings.multiplayerSynchronizedPlayback;
    core.multiplayerSettings = settings;
    if (renderCacheLimitChanged) {
      multiplayerRenderCoordinator.setCacheLimitMiB(settings.multiplayerRenderCacheLimitMiB);
    }
    if (core.state.mode === 'hosting') {
      if (opusBitrateChanged || fileTransferLimitChanged) {
        // Bitrate is part of the render cache key and the transfer limit
        // changes the delivery decision: force a fresh delivery generation so
        // listeners rebuild their pipeline at the new mode or bitrate.
        for (const peer of core.hostPeers.values()) {
          if (peer.freeplay) {
            peer.freeplayDelivery = null;
            if (peer.freeplayPlayer) {
              void peer.freeplayPlayer.reconfigure().then((shouldResume) => {
                if (!peer.freeplay || !peer.freeplayPlayer?.track) return;
                if (shouldResume) host.beginFreeplayPlaybackPreparation(peer);
              });
            }
          }
        }
        host.syncHostAudio(core.latestHostState?.track ?? null, true);
        host.syncHostSourceFiles(core.latestHostState?.track ?? null);
      }
      if (freeplayPreferenceChanged) {
        for (const peer of core.hostPeers.values()) void host.syncPeerFreeplayMode(peer);
      } else if (freeplayAudioChanged) {
        for (const peer of core.hostPeers.values()) {
          if (!peer.freeplay || !peer.freeplayPlayer) continue;
          void peer.freeplayPlayer.reconfigure().then((shouldResume) => {
            if (!peer.freeplay || !peer.freeplayPlayer?.track) return;
            if (shouldResume) host.beginFreeplayPlaybackPreparation(peer);
          });
        }
      }
      if (audioBufferChanged) {
        for (const peer of core.hostPeers.values()) {
          sendToPeer(peer, { kind: 'buffer', bufferMs: settings.multiplayerAudioBufferMs });
        }
      }
      if (synchronizedPlaybackDisabled
        || (waitForClientsDisabled && !settings.multiplayerSynchronizedPlayback)) {
        host.releasePreparedHostPlayback(true);
      } else if (synchronizedPlaybackEnabled && core.hostPlaybackPreparation) {
        host.beginHostPlaybackPreparation(core.hostPlaybackPreparation.preparation.trackId);
      } else if (core.hostPlaybackPreparation
        && core.hostPlaybackPreparation.preparation.delivery !== core.latestDelivery.mode) {
        host.beginHostPlaybackPreparation(core.hostPlaybackPreparation.preparation.trackId);
      }
    }
    if (core.state.mode === 'client' && core.clientPeer && audioBufferChanged
      && core.hostAudioBufferMs === null) {
      client.applyClientAudioBuffer(core.clientPeer);
    }
    if (core.state.mode === 'client' && core.clientPeer && freeplayPreferenceChanged) {
      sendToPeer(core.clientPeer, {
        kind: 'freeplay.preference',
        enabled: settings.multiplayerFreeplay
      });
    }
  });
  window.addEventListener('online', client.handleClientResume);
  document.addEventListener('visibilitychange', client.handleClientResume);

  async function restoreLastSession() {
    if (core.state.mode !== 'idle') return core.state.mode;
    const last = multiplayerLastSession.getSnapshot();
    if (!last) return null;
    if (last.mode === 'hosting') {
      await host.startHosting({ silent: true });
      return 'hosting' as const;
    }
    await client.restoreClientJoin(last);
    return 'client' as const;
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => core.state,
    startHosting: (options) => host.startHosting(options),
    stopHosting: () => host.stopHosting(),
    join: (inviteCode) => client.join(inviteCode),
    joinPaired: (hostId) => client.joinPaired(hostId),
    restoreLastSession,
    leave: () => client.leave(),
    kick: (clientId) => host.kick(clientId),
    togglePairing: (clientId) => host.togglePairing(clientId),
    sendCommand: (command) => client.sendCommand(command),
    setFreeplayQueue: (itemIds) => client.setFreeplayQueue(itemIds),
    cancelPendingPlayback: () => host.cancelPendingPlayback(),
    resumeAudio: () => client.resumeAudio(),
    setReceiveAudio: (enabled) => client.setReceiveAudio(enabled),
    updateHostState: (next) => host.updateHostState(next),
    destroy() {
      core.allowClientReconnect = false;
      client.clearReconnectTimer();
      window.removeEventListener('online', client.handleClientResume);
      document.removeEventListener('visibilitychange', client.handleClientResume);
      unsubscribeSettings();
      multiplayerRenderCoordinator.clear();
      void resetSession(true);
    }
  };
}

function getInitialState(): MultiplayerSessionState {
  return {
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostVersion: null,
    freeplayPaired: false,
    freeplay: false,
    freeplayQueue: [],
    clients: [],
    remoteCatalog: EMPTY_CATALOG,
    remotePlayback: EMPTY_REMOTE_PLAYBACK,
    remoteArtwork: null,
    remoteArtworkResolvedTrackKey: '',
    audioStatus: 'idle',
    remoteDelivery: { ...EMPTY_DELIVERY },
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    receiveAudio: readReceiveAudioPreference(),
    connectionStats: null,
    connectionDetail: null,
    message: null
  };
}
