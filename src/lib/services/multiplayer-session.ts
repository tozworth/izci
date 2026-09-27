import { writable } from 'svelte/store';
import type { MultiplayerSettings, TrackItem } from '$lib/types';
import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { getRememberedServerInvitation } from '$lib/stores/multiplayer-server-recents';
import { logDebug, logWarning } from '$lib/services/logging';
import { multiplayerAudioService } from './multiplayer-audio';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerRenderCoordinator } from './multiplayer-render-coordinator';
import { disposePeerConnection, sendToPeer } from './multiplayer-peer';
import { getLocalName, readReceiveAudioPreference } from './multiplayer-utils';
import { getTrackDisplayTitle } from '$lib/utils/files';
import {
  createMultiplayerChatMessage,
  createMultiplayerChatNotice,
  multiplayerChat,
  normalizeMultiplayerChatText,
  parseMultiplayerChatSubmission
} from './multiplayer-chat';
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
import type {
  MultiplayerChatTrackLink,
  MultiplayerCollection
} from './multiplayer-protocol';
import { closeServerHostRoom } from './multiplayer-server-host';

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
    multiplayerSettings: multiplayerSettings.getSnapshot(),
    clientHostId: null,
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
    serverHost: null,
    serverGuest: null,
    transportGeneration: 0,
    disposeServerTransport: null,
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
          freeplay: patch.freeplay ?? false,
          freeplayTrack: patch.freeplayTrack ?? null,
          freeplayPlaybackState: patch.freeplayPlaybackState ?? 'idle',
          freeplayArtworkUrl: patch.freeplayArtworkUrl ?? null
        }];
    core.publish({ clients });
  };

  const host = createMultiplayerHostSide(core, {
    handleHostCommand,
    handleChatMessage: (text, client, track, action) => handleChatMessage(text, client, track, action),
    handleChatPresence: (name, action) => handleChatPresence(name, action),
    pauseHostPlayback,
    resumeHostPlayback
  });
  const client = createMultiplayerClientSide(core);

  function handleChatMessage(
    text: string,
    client: Pick<MultiplayerSessionState['clients'][number], 'id' | 'name'>,
    track?: MultiplayerChatTrackLink,
    action?: 'now-playing'
  ): void {
    if (core.state.mode !== 'hosting') return;
    const command = parseMultiplayerChatSubmission(text, track, action);
    if (!command) return;
    if (command.action === 'clear') return;
    const resolvedTrack = track ? resolveChatTrackLink(track) : undefined;
    if (command.action === 'now-playing' && !resolvedTrack) return;
    const message = createMultiplayerChatMessage(
      client.name,
      resolvedTrack?.title ?? command.text,
      Date.now(),
      resolvedTrack,
      command.action === 'now-playing'
        ? 'now-playing'
        : resolvedTrack ? undefined : command.action
    );
    if (!message.text) return;
    multiplayerChat.append(message);
    for (const peer of core.hostPeers.values()) {
      if (peer.channel?.readyState !== 'open') continue;
      sendToPeer(peer, { kind: 'chat.message', message });
    }
  }

  function handleChatPresence(
    name: string,
    action: 'join' | 'leave'
  ): void {
    if (core.state.mode !== 'hosting') return;
    const message = createMultiplayerChatNotice(name, action);
    multiplayerChat.append(message);
    for (const peer of core.hostPeers.values()) {
      if (peer.channel?.readyState !== 'open') continue;
      sendToPeer(peer, { kind: 'chat.message', message });
    }
  }

  function resolveChatTrackLink(track: MultiplayerChatTrackLink): MultiplayerChatTrackLink | undefined {
    if (!core.latestHostState) return undefined;
    const collections = Array.from(new Set<MultiplayerCollection>([
      track.collection,
      'queue',
      'library',
      'favorites'
    ]));
    let source: TrackItem | undefined;
    let collection: MultiplayerCollection | undefined;
    for (const candidate of collections) {
      source = core.latestHostState[candidate].find((item) => item.id === track.itemId);
      if (source) {
        collection = candidate;
        break;
      }
    }
    if (!source || !collection) return undefined;
    return {
      collection,
      itemId: source.id,
      title: getTrackDisplayTitle(source) || source.name
    };
  }

  function sendChatMessage(text: string): boolean {
    return sendChatPayload(text);
  }

  function sendChatNowPlaying(track: MultiplayerChatTrackLink): boolean {
    return sendChatPayload('/np', track, 'now-playing');
  }

  function sendChatTrack(track: MultiplayerChatTrackLink): boolean {
    return sendChatPayload(track.title, track);
  }

  function sendChatPayload(
    text: string,
    track?: MultiplayerChatTrackLink,
    action?: 'now-playing'
  ): boolean {
    const normalizedText = normalizeMultiplayerChatText(text);
    const command = parseMultiplayerChatSubmission(normalizedText, track, action);
    if (!command
      || (command.action === 'now-playing' && !track)
      || (command.action === 'clear' && core.state.mode !== 'hosting')
      || core.state.connectionStatus !== 'connected') return false;

    if (core.state.mode === 'hosting') {
      if (command.action === 'clear') {
        multiplayerChat.clear();
        for (const peer of core.hostPeers.values()) {
          if (peer.channel?.readyState === 'open') sendToPeer(peer, { kind: 'chat.clear' });
        }
        return true;
      }
      handleChatMessage(normalizedText, { id: 'host', name: getLocalName() }, track, action);
      return true;
    }
    if (core.state.mode !== 'client' || !core.clientPeer) return false;
    sendToPeer(core.clientPeer, {
      kind: 'chat.send',
      text: normalizedText,
      ...(track ? { track } : {}),
      ...(action ? { action } : {})
    });
    return true;
  }

  async function resetSession(removeRemote: boolean): Promise<void> {
    logDebug('multiplayer', 'Session reset started', {
      mode: core.state.mode,
      removeRemote,
      peers: core.hostPeers.size
    });
    // Bump the transport generation first so late server callbacks from a
    // previous attempt cannot mutate the session being torn down.
    core.transportGeneration += 1;
    core.allowClientReconnect = false;
    core.reconnectInFlight = false;
    client.clearReconnectTimer();
    // Tell the server to release our slot before the socket goes
    // away; the reader generation guard already invalidated late frames.
    if (core.serverGuest) {
      try {
        core.serverGuest.sendRelease();
      } catch {
        // Best effort: expiry reaps the slot server-side.
      }
    }
    const serverHost = core.serverHost;
    core.disposeServerTransport?.();
    core.disposeServerTransport = null;
    core.serverHost?.dispose();
    core.serverHost = null;
    core.serverGuest?.dispose();
    core.serverGuest = null;
    client.clearReceiverMonitor();
    client.resetTransitions();
    for (const peer of core.hostPeers.values()) {
      disposePeerConnection(peer);
    }
    core.hostPeers.clear();
    multiplayerChat.stopPersisting();
    multiplayerChat.clear();
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

    if (removeRemote && serverHost) {
      // Close the hosted room and revoke the login bearer server-side.
      // Established RTC keeps playing until renegotiated; new admissions
      // stop immediately. Never throws: teardown must complete locally.
      try {
        await closeServerHostRoom(serverHost.room);
      } catch {
        // The lease lapses server-side; local state is already cleared.
      }
    }
    core.lastCatalogSources = null;
    core.lastPlaybackSource = null;
    core.lastTrackSource = null;
    core.latestHostArtwork = null;
    core.hostArtworkTrackKey = '';
    core.hostArtworkResolvedTrackKey = '';
    core.hostArtworkLoadToken += 1;
    core.rejectedPeerIds.clear();
    core.acceptingPeerIds.clear();
    core.renderFallbackTrackIds.clear();
    core.latestDelivery = { ...EMPTY_DELIVERY };
    // Server transport health resets with the session; media health
    // lives in audioStatus/connectionRoute and host-login expiry is set
    // by the failure that observed the 401.
    core.publish({ serverSignaling: null, serverHostAuth: null });
  }
  core.resetSession = resetSession;

  const unsubscribeSettings = multiplayerSettings.subscribe((settings: MultiplayerSettings) => {
    const audioBufferChanged = settings.multiplayerAudioBufferMs
      !== core.multiplayerSettings.multiplayerAudioBufferMs;
    const motdChanged = settings.multiplayerMotd !== core.multiplayerSettings.multiplayerMotd;
    const chatHistoryLimitChanged = settings.multiplayerChatHistoryLines
      !== core.multiplayerSettings.multiplayerChatHistoryLines;
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
    if (chatHistoryLimitChanged && settings.multiplayerChatHistoryLines === 0) {
      multiplayerChat.restorePersistedHistory(0);
    }
    if (renderCacheLimitChanged) {
      multiplayerRenderCoordinator.setCacheLimitMiB(settings.multiplayerRenderCacheLimitMiB);
    }
    if (core.state.mode === 'hosting') {
      if (chatHistoryLimitChanged && settings.multiplayerChatHistoryLines > 0) {
        multiplayerChat.restorePersistedHistory(settings.multiplayerChatHistoryLines);
      }
      if (motdChanged) host.syncHostMotd();
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
        host.syncHostSourceFiles();
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
    // Hosting stops at login after reload. Guests restore only when the
    // invitation was explicitly retained on this device.
    if (last.mode === 'hosting') {
      core.publish({
        mode: 'idle',
        connectionStatus: 'idle',
        connectionDetail: 'Open Server setup to log in and resume hosting.',
        message: 'Open Server setup to log in and resume hosting.'
      });
      return 'idle' as const;
    }
    const secret = last.serverEndpoint && last.serverRoomId
      ? getRememberedServerInvitation(last.serverEndpoint, last.serverRoomId)
      : null;
    if (!secret || !last.serverEndpoint || !last.serverRoomId) {
      core.publish({
        mode: 'idle',
        connectionStatus: 'idle',
        connectionDetail: 'That server invitation needs to be opened again.',
        message: 'That server invitation needs to be opened again.'
      });
      return 'idle' as const;
    }
    await joinServer(last.serverEndpoint, last.serverRoomId, secret);
    return 'client' as const;
  }

  // Load signaling on demand.
  async function startServerHosting(
    endpoint: string,
    hostKey: string,
    options?: {
      silent?: boolean;
      sessionToken?: string;
      resume?: { roomId: string; ownerSecret: string };
      capacity?: number;
      signal?: AbortSignal;
    }
  ) {
    const mod = await import('./multiplayer-server-session');
    void options?.silent;
    return mod.startServerHosting(host.ctx, {
      endpoint,
      hostKey,
      sessionToken: options?.sessionToken,
      resume: options?.resume,
      capacity: options?.capacity,
      signal: options?.signal
    });
  }

  async function joinServer(endpoint: string, roomId: string, secret: string, signal?: AbortSignal) {
    const mod = await import('./multiplayer-server-session');
    return mod.joinServer(client.ctx, { endpoint, roomId, secret, signal });
  }

  async function rotateServerInvitation(): Promise<string> {
    const mod = await import('./multiplayer-server-session');
    return mod.rotateServerInvitation(host.ctx);
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => core.state,
    startServerHosting,
    rotateServerInvitation,
    stopHosting: () => host.stopHosting(),
    joinServer,
    restoreLastSession,
    leave: () => client.leave(),
    kick: (clientId) => host.kick(clientId),
    togglePairing: (clientId) => host.togglePairing(clientId),
    sendCommand: (command) => client.sendCommand(command),
    requestTrackInfo: (trackId: string) => client.requestTrackInfo(trackId),
    sendChatMessage,
    sendChatNowPlaying,
    sendChatTrack,
    setFreeplayQueue: (itemIds) => client.setFreeplayQueue(itemIds),
    cancelPendingPlayback: () => host.cancelPendingPlayback(),
    resumeAudio: () => client.resumeAudio(),
    setReceiveAudio: (enabled) => client.setReceiveAudio(enabled),
    setUseHostOdaBackground: (enabled) => client.setUseHostOdaBackground(enabled),
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
    serverSignaling: null,
    serverHostAuth: null,
    remoteDelivery: { ...EMPTY_DELIVERY },
    connectionRoute: null,
    averageAudioBitrateKbps: null,
    receiveAudio: readReceiveAudioPreference(),
    connectionStats: null,
    connectionDetail: null,
    message: null
  };
}
