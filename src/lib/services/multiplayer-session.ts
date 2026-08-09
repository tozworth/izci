import { writable } from 'svelte/store';
import type { ExperimentalSettings } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { logDebug, logWarning } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { clearPeerConnectionTimer, sendToPeer } from './multiplayer-peer';
import { resolvePlaybackPreparationAudio, readReceiveAudioPreference } from './multiplayer-utils';
import { createMultiplayerHostSide } from './multiplayer-host';
import { createMultiplayerClientSide } from './multiplayer-client';
import {
  EMPTY_CATALOG,
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
    roomDisconnect: null,
    hostDirectoryDisconnect: null,
    peerDisconnect: null,
    stopPeersListener: null,
    stopAnswerListener: null,
    hostPeers: new Map(),
    clientPeer: null,
    pendingClientSourceFile: null,
    pendingClientPlaybackPreparation: null,
    clientRemoteAudioReady: false,
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
    latestAudioAvailability: {
      enabled: false,
      sourceFile: false,
      postRaf: false,
      reason: 'host-disabled'
    },
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
    core.stopPeersListener?.();
    core.stopAnswerListener?.();
    core.stopPeersListener = null;
    core.stopAnswerListener = null;
    for (const peer of core.hostPeers.values()) {
      clearPeerConnectionTimer(peer);
      peer.freeplayPlayer?.destroy();
      peer.pc.close();
    }
    core.hostPeers.clear();
    const previousClientPeer = core.clientPeer;
    core.clientPeer = null;
    if (previousClientPeer) clearPeerConnectionTimer(previousClientPeer);
    previousClientPeer?.pc.close();
    multiplayerAudioService.clearRemoteTrack();
    multiplayerSourcePlaybackService.clearLoadedFile();
    core.pendingClientSourceFile = null;
    core.pendingClientPlaybackPreparation = null;
    core.clientRemoteAudioReady = false;
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
    core.latestAudioAvailability = {
      enabled: false,
      sourceFile: false,
      postRaf: false,
      reason: 'host-disabled'
    };
  }
  core.resetSession = resetSession;

  const unsubscribeSettings = experimentalSettings.subscribe((settings: ExperimentalSettings) => {
    const audioBufferChanged = settings.multiplayerAudioBufferMs
      !== core.multiplayerSettings.multiplayerAudioBufferMs;
    const freeplayPreferenceChanged = settings.multiplayerFreeplay
      !== core.multiplayerSettings.multiplayerFreeplay;
    const freeplayAudioChanged = settings.multiplayerStreamAudio
      !== core.multiplayerSettings.multiplayerStreamAudio
      || settings.multiplayerFileTransferLimitMiB
        !== core.multiplayerSettings.multiplayerFileTransferLimitMiB
      || settings.multiplayerSendPostRaf !== core.multiplayerSettings.multiplayerSendPostRaf;
    const waitForClientsDisabled = core.multiplayerSettings.multiplayerWaitForClients
      && !settings.multiplayerWaitForClients;
    core.multiplayerSettings = settings;
    if (core.state.mode === 'hosting') {
      host.syncHostAudio(core.latestHostState?.track ?? null);
      host.syncHostSourceFiles(core.latestHostState?.track ?? null);
      if (freeplayPreferenceChanged) {
        for (const peer of core.hostPeers.values()) void host.syncPeerFreeplayMode(peer);
      } else if (freeplayAudioChanged) {
        for (const peer of core.hostPeers.values()) {
          if (!peer.freeplay || !peer.freeplayPlayer) continue;
          const wasPreparing = peer.freeplayPendingPreparation !== null;
          void peer.freeplayPlayer.reconfigure().then(() => {
            if (!wasPreparing || !peer.freeplay) return;
            if (core.multiplayerSettings.multiplayerWaitForClients) {
              host.beginFreeplayPlaybackPreparation(peer);
            } else {
              peer.freeplayPendingPreparation = null;
              void peer.freeplayPlayer?.play();
            }
          });
        }
      }
      if (waitForClientsDisabled) {
        host.releasePreparedHostPlayback();
        for (const peer of core.hostPeers.values()) {
          if (!peer.freeplayPendingPreparation) continue;
          peer.freeplayPendingPreparation = null;
          void peer.freeplayPlayer?.play();
        }
      } else if (core.hostPlaybackPreparation
        && core.hostPlaybackPreparation.preparation.audio
          !== resolvePlaybackPreparationAudio(core.latestAudioAvailability)) {
        host.beginHostPlaybackPreparation(core.hostPlaybackPreparation.preparation.trackId);
      }
    }
    if (core.state.mode === 'client' && core.clientPeer && audioBufferChanged) {
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

  return {
    subscribe: store.subscribe,
    getSnapshot: () => core.state,
    startHosting: () => host.startHosting(),
    stopHosting: () => host.stopHosting(),
    join: (inviteCode) => client.join(inviteCode),
    joinPaired: (hostId) => client.joinPaired(hostId),
    leave: () => client.leave(),
    kick: (clientId) => host.kick(clientId),
    togglePairing: (clientId) => host.togglePairing(clientId),
    sendCommand: (command) => client.sendCommand(command),
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
    clients: [],
    remoteCatalog: EMPTY_CATALOG,
    remotePlayback: EMPTY_REMOTE_PLAYBACK,
    remoteArtwork: null,
    remoteArtworkResolvedTrackKey: '',
    audioStatus: 'idle',
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    receiveAudio: readReceiveAudioPreference(),
    connectionStats: null,
    connectionDetail: null,
    message: null
  };
}
