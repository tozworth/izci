import { writable, type Readable } from 'svelte/store';
import type { Database, DatabaseReference, OnDisconnect, Unsubscribe } from 'firebase/database';
import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
  sanitizePlaylistItem,
  type ClientMessage,
  type HostMessage,
  type MultiplayerCatalog,
  type MultiplayerCommand,
  type MultiplayerCommandInput,
  type MultiplayerPlayback
} from './multiplayer-protocol';

const FIREBASE_CONFIG = {
  projectId: 'izci-pwa',
  appId: '1:397825145921:web:92d428cf3c65fa2fab5ac0',
  storageBucket: 'izci-pwa.firebasestorage.app',
  apiKey: 'AIzaSyBZ1hxyPdzo3xQyb9Urk7XQG708-R5S-3w',
  authDomain: 'izci-pwa.firebaseapp.com',
  messagingSenderId: '397825145921',
  databaseURL: 'https://izci-pwa-default-rtdb.europe-west1.firebasedatabase.app'
} as const;

const EMPTY_PLAYBACK: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  backend: null
};

const EMPTY_CATALOG: MultiplayerCatalog = {
  revision: 0,
  playlist: [],
  library: [],
  favorites: [],
  shuffleEnabled: false,
  repeatMode: 'off'
};

const EMPTY_REMOTE_PLAYBACK: MultiplayerPlayback = {
  snapshot: EMPTY_PLAYBACK,
  track: null,
  sentAt: 0
};

export type MultiplayerMode = 'idle' | 'hosting' | 'client';
export type MultiplayerConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface MultiplayerClient {
  id: string;
  name: string;
  platform: string;
  status: 'connecting' | 'connected' | 'disconnected';
}

export interface MultiplayerSessionState {
  mode: MultiplayerMode;
  connectionStatus: MultiplayerConnectionStatus;
  inviteCode: string | null;
  hostName: string | null;
  clients: MultiplayerClient[];
  remoteCatalog: MultiplayerCatalog;
  remotePlayback: MultiplayerPlayback;
  message: string | null;
}

export interface MultiplayerHostState {
  playlist: PlaylistItem[];
  library: PlaylistItem[];
  favorites: PlaylistItem[];
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  playback: PlaybackSnapshot;
  track: PlaylistItem | null;
}

interface FirebaseRuntime {
  database: Database;
  uid: string;
  ref: typeof import('firebase/database')['ref'];
  set: typeof import('firebase/database')['set'];
  get: typeof import('firebase/database')['get'];
  remove: typeof import('firebase/database')['remove'];
  onValue: typeof import('firebase/database')['onValue'];
  onDisconnect: typeof import('firebase/database')['onDisconnect'];
}

interface SignalOffer {
  name: string;
  platform: string;
  description: RTCSessionDescriptionInit;
  createdAt: number;
}

interface PeerConnection {
  id: string;
  name: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  outgoing: string[];
  flushing: boolean;
  decode: ReturnType<typeof createMultiplayerMessageDecoder<ClientMessage>>;
}

interface CreateMultiplayerSessionOptions {
  handleHostCommand: (
    command: MultiplayerCommand,
    client: Pick<MultiplayerClient, 'id' | 'name'>
  ) => boolean | Promise<boolean>;
}

export interface MultiplayerSessionController extends Readable<MultiplayerSessionState> {
  getSnapshot(): MultiplayerSessionState;
  startHosting(): Promise<string>;
  stopHosting(): Promise<void>;
  join(inviteCode: string): Promise<void>;
  leave(): Promise<void>;
  kick(clientId: string): Promise<void>;
  sendCommand(command: MultiplayerCommandInput): boolean;
  updateHostState(next: MultiplayerHostState): void;
  destroy(): void;
}

export function createMultiplayerSession({
  handleHostCommand
}: CreateMultiplayerSessionOptions): MultiplayerSessionController {
  let state: MultiplayerSessionState = {
    mode: 'idle',
    connectionStatus: 'idle',
    inviteCode: null,
    hostName: null,
    clients: [],
    remoteCatalog: EMPTY_CATALOG,
    remotePlayback: EMPTY_REMOTE_PLAYBACK,
    message: null
  };
  const store = writable(state);
  const hostPeers = new Map<string, PeerConnection>();
  let firebaseRuntime: FirebaseRuntime | null = null;
  let roomRef: DatabaseReference | null = null;
  let ownPeerRef: DatabaseReference | null = null;
  let roomDisconnect: OnDisconnect | null = null;
  let peerDisconnect: OnDisconnect | null = null;
  let stopPeersListener: Unsubscribe | null = null;
  let stopAnswerListener: Unsubscribe | null = null;
  let clientPeer: PeerConnection | null = null;
  let latestHostState: MultiplayerHostState | null = null;
  let catalogRevision = 0;
  let lastCatalogSources: Pick<MultiplayerHostState, 'playlist' | 'library' | 'favorites' | 'shuffleEnabled' | 'repeatMode'> | null = null;
  let lastPlaybackSource: PlaybackSnapshot | null = null;
  let lastTrackSource: PlaylistItem | null = null;

  function publish(patch: Partial<MultiplayerSessionState>): void {
    state = { ...state, ...patch };
    store.set(state);
  }

  function updateClient(id: string, patch: Partial<MultiplayerClient>): void {
    const existing = state.clients.find((client) => client.id === id);
    const clients = existing
      ? state.clients.map((client) => client.id === id ? { ...client, ...patch } : client)
      : [...state.clients, {
          id,
          name: patch.name ?? 'Guest',
          platform: patch.platform ?? 'Unknown',
          status: patch.status ?? 'connecting'
        }];
    publish({ clients });
  }

  async function startHosting(): Promise<string> {
    await resetSession(true);
    publish({
      mode: 'hosting',
      connectionStatus: 'connecting',
      hostName: getLocalName(),
      message: null
    });

    try {
      const firebase = await loadFirebase();
      const inviteCode = createInviteCode();
      const nextRoomRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}`);
      firebaseRuntime = firebase;
      roomRef = nextRoomRef;
      await firebase.set(nextRoomRef, {
        meta: {
          hostUid: firebase.uid,
          protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
          hostName: getLocalName(),
          createdAt: Date.now()
        }
      });
      const disconnect = firebase.onDisconnect(nextRoomRef);
      await disconnect.remove();

      roomDisconnect = disconnect;
      stopPeersListener = firebase.onValue(
        firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/peers`),
        (snapshot) => {
          const peers = snapshot.val() as Record<string, { client?: SignalOffer }> | null;
          const liveIds = new Set(
            Object.entries(peers ?? {})
              .filter(([, peerSignal]) => isSignalOffer(peerSignal.client))
              .map(([id]) => id)
          );
          for (const [id, peer] of hostPeers) {
            if (!liveIds.has(id)) {
              peer.pc.close();
              hostPeers.delete(id);
              publish({ clients: state.clients.filter((client) => client.id !== id) });
              if (firebaseRuntime && state.mode === 'hosting') {
                void firebaseRuntime.remove(firebaseRuntime.ref(
                  firebaseRuntime.database,
                  `multiplayer/rooms/${inviteCode}/peers/${id}`
                ));
              }
            }
          }
          for (const [id, peerSignal] of Object.entries(peers ?? {})) {
            if (!hostPeers.has(id) && isSignalOffer(peerSignal.client)) {
              void acceptClientOffer(inviteCode, id, peerSignal.client);
            }
          }
        }
      );

      publish({
        mode: 'hosting',
        connectionStatus: 'connected',
        inviteCode
      });
      primeHostState();
      return inviteCode;
    } catch (error) {
      await resetSession(false);
      publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        message: errorMessage(error, 'Could not start multiplayer hosting.')
      });
      throw error;
    }
  }

  async function acceptClientOffer(inviteCode: string, id: string, offer: SignalOffer): Promise<void> {
    if (!firebaseRuntime || state.mode !== 'hosting') return;
    const peer = createPeer(id, sanitizeClientName(offer.name));
    hostPeers.set(id, peer);
    updateClient(id, {
      name: peer.name,
      platform: sanitizePlatform(offer.platform),
      status: 'connecting'
    });

    peer.pc.ondatachannel = (event) => attachHostChannel(peer, event.channel);
    peer.pc.onconnectionstatechange = () => {
      const status = peer.pc.connectionState;
      if (status === 'connected') updateClient(id, { status: 'connected' });
      if (status === 'failed' || status === 'disconnected' || status === 'closed') {
        updateClient(id, { status: 'disconnected' });
      }
    };

    try {
      await peer.pc.setRemoteDescription(offer.description);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await waitForIceGathering(peer.pc);
      if (!firebaseRuntime || state.mode !== 'hosting') return;
      await firebaseRuntime.set(
        firebaseRuntime.ref(
          firebaseRuntime.database,
          `multiplayer/rooms/${inviteCode}/peers/${id}/host`
        ),
        { description: peer.pc.localDescription?.toJSON(), createdAt: Date.now() }
      );
    } catch {
      peer.pc.close();
      hostPeers.delete(id);
      updateClient(id, { status: 'disconnected' });
    }
  }

  function attachHostChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => {
      updateClient(peer.id, { status: 'connected' });
      sendToPeer(peer, {
        kind: 'hello',
        version: MULTIPLAYER_PROTOCOL_VERSION,
        name: getLocalName()
      });
      sendCurrentState(peer);
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = peer.decode(event.data);
      if (!message) return;
      if (message.kind === 'hello') {
        peer.name = sanitizeClientName(message.name);
        updateClient(peer.id, { name: peer.name, platform: sanitizePlatform(message.platform) });
        return;
      }
      if (message.kind === 'command' && isMultiplayerCommand(message.command)) {
        void Promise.resolve(handleHostCommand(message.command, peer))
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
    };
    channel.onclose = () => updateClient(peer.id, { status: 'disconnected' });
    sendToPeer(peer, {
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: getLocalName()
    });
  }

  async function join(rawInviteCode: string): Promise<void> {
    await resetSession(true);
    const inviteCode = normalizeInviteCode(rawInviteCode);
    if (!inviteCode) {
      const error = new Error('Enter a valid multiplayer invite code.');
      publish({ connectionStatus: 'error', message: error.message });
      throw error;
    }

    publish({
      mode: 'client',
      connectionStatus: 'connecting',
      inviteCode,
      hostName: null,
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      message: null
    });

    try {
      const firebase = await loadFirebase();
      firebaseRuntime = firebase;
      const metaRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/meta`);
      const meta = (await firebase.get(metaRef)).val() as {
        protocolVersion?: number;
        hostName?: string;
      } | null;
      if (!meta || meta.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new Error('That multiplayer session is unavailable or incompatible.');
      }
      publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });

      const peer = createPeer(firebase.uid, getLocalName());
      const channel = peer.pc.createDataChannel('izci-control', { ordered: true });
      peer.channel = channel;
      clientPeer = peer;
      attachClientChannel(peer);

      const nextPeerRef = firebase.ref(
        firebase.database,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}`
      );
      const clientSignalRef = firebase.ref(
        firebase.database,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/client`
      );
      const disconnect = firebase.onDisconnect(clientSignalRef);
      await disconnect.remove();
      ownPeerRef = clientSignalRef;
      peerDisconnect = disconnect;

      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await waitForIceGathering(peer.pc);
      await firebase.set(firebase.ref(
        firebase.database,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/client`
      ), {
        name: peer.name,
        platform: getClientPlatform(),
        description: peer.pc.localDescription?.toJSON(),
        createdAt: Date.now()
      });

      stopAnswerListener = firebase.onValue(
        firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/host`),
        (snapshot) => {
          const answer = snapshot.val() as { description?: RTCSessionDescriptionInit } | null;
          if (!answer?.description || peer.pc.remoteDescription) return;
          void peer.pc.setRemoteDescription(answer.description).catch(() => {
            publish({ connectionStatus: 'error', message: 'The host answer could not be applied.' });
          });
        }
      );
    } catch (error) {
      await resetSession(false);
      publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        message: errorMessage(error, 'Could not join that multiplayer session.')
      });
      throw error;
    }
  }

  function attachClientChannel(peer: PeerConnection): void {
    const channel = peer.channel;
    if (!channel) return;
    const decode = createMultiplayerMessageDecoder(isHostMessage);

    channel.onopen = () => {
      publish({ connectionStatus: 'connected', message: null });
      if (state.inviteCode && state.hostName) {
        rememberMultiplayerHost(state.hostName, state.inviteCode);
      }
      sendToPeer(peer, {
        kind: 'hello',
        version: MULTIPLAYER_PROTOCOL_VERSION,
        name: peer.name,
        platform: getClientPlatform()
      });
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = decode(event.data);
      if (!message) return;
      if (message.kind === 'catalog') publish({ remoteCatalog: message.catalog });
      if (message.kind === 'playback') publish({ remotePlayback: message.playback });
      if (message.kind === 'kicked') {
        publish({ connectionStatus: 'disconnected', message: 'The host removed this client.' });
        peer.pc.close();
      }
      if (message.kind === 'hello' && message.version !== MULTIPLAYER_PROTOCOL_VERSION) {
        publish({ connectionStatus: 'error', message: 'The host uses an incompatible protocol.' });
      }
      if (message.kind === 'hello') {
        const hostName = sanitizeClientName(message.name);
        publish({ hostName });
        if (state.inviteCode) rememberMultiplayerHost(hostName, state.inviteCode);
      }
    };
    channel.onclose = () => {
      if (state.mode === 'client' && state.connectionStatus !== 'error') {
        publish({ connectionStatus: 'disconnected', message: state.message ?? 'Connection to the host was lost.' });
      }
    };
    peer.pc.onconnectionstatechange = () => {
      if (peer.pc.connectionState === 'connected') publish({ connectionStatus: 'connected' });
      if (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected') {
        publish({ connectionStatus: 'disconnected', message: 'Connection to the host was lost.' });
      }
    };
  }

  function sendCommand(command: MultiplayerCommandInput): boolean {
    if (state.mode !== 'client' || state.connectionStatus !== 'connected' || !clientPeer) return false;
    const completeCommand = {
      ...command,
      commandId: crypto.randomUUID()
    } as MultiplayerCommand;
    sendToPeer(clientPeer, { kind: 'command', command: completeCommand });
    return true;
  }

  function updateHostState(next: MultiplayerHostState): void {
    latestHostState = next;
    if (state.mode !== 'hosting') return;

    const catalogChanged = !lastCatalogSources
      || lastCatalogSources.playlist !== next.playlist
      || lastCatalogSources.library !== next.library
      || lastCatalogSources.favorites !== next.favorites
      || lastCatalogSources.shuffleEnabled !== next.shuffleEnabled
      || lastCatalogSources.repeatMode !== next.repeatMode;
    if (catalogChanged) {
      catalogRevision += 1;
      lastCatalogSources = {
        playlist: next.playlist,
        library: next.library,
        favorites: next.favorites,
        shuffleEnabled: next.shuffleEnabled,
        repeatMode: next.repeatMode
      };
      broadcast({ kind: 'catalog', catalog: buildCatalog(next) });
    }

    if (lastPlaybackSource !== next.playback || lastTrackSource !== next.track) {
      lastPlaybackSource = next.playback;
      lastTrackSource = next.track;
      broadcast({ kind: 'playback', playback: buildPlayback(next) });
    }
  }

  function primeHostState(): void {
    if (!latestHostState) return;
    catalogRevision += 1;
    lastCatalogSources = {
      playlist: latestHostState.playlist,
      library: latestHostState.library,
      favorites: latestHostState.favorites,
      shuffleEnabled: latestHostState.shuffleEnabled,
      repeatMode: latestHostState.repeatMode
    };
    lastPlaybackSource = latestHostState.playback;
    lastTrackSource = latestHostState.track;
  }

  function sendCurrentState(peer: PeerConnection): void {
    if (!latestHostState) return;
    sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(latestHostState) });
    sendToPeer(peer, { kind: 'playback', playback: buildPlayback(latestHostState) });
  }

  function buildCatalog(source: MultiplayerHostState): MultiplayerCatalog {
    return {
      revision: catalogRevision,
      playlist: source.playlist.map(sanitizePlaylistItem),
      library: source.library.map(sanitizePlaylistItem),
      favorites: source.favorites.map(sanitizePlaylistItem),
      shuffleEnabled: source.shuffleEnabled,
      repeatMode: source.repeatMode
    };
  }

  function buildPlayback(source: MultiplayerHostState): MultiplayerPlayback {
    return {
      snapshot: { ...source.playback },
      track: source.track ? sanitizePlaylistItem(source.track) : null,
      sentAt: Date.now()
    };
  }

  function broadcast(message: HostMessage): void {
    for (const peer of hostPeers.values()) sendToPeer(peer, message);
  }

  function sendToPeer(peer: PeerConnection, message: HostMessage | ClientMessage): void {
    peer.outgoing.push(...encodeMultiplayerMessage(message));
    flushPeer(peer);
  }

  function flushPeer(peer: PeerConnection): void {
    const channel = peer.channel;
    if (peer.flushing || !channel || channel.readyState !== 'open') return;
    peer.flushing = true;
    const flush = () => {
      if (!peer.channel || peer.channel.readyState !== 'open') {
        peer.flushing = false;
        return;
      }
      while (peer.outgoing.length > 0 && peer.channel.bufferedAmount < 512_000) {
        peer.channel.send(peer.outgoing.shift()!);
      }
      if (peer.outgoing.length === 0) {
        peer.flushing = false;
        return;
      }
      window.setTimeout(flush, 20);
    };
    flush();
  }

  async function kick(clientId: string): Promise<void> {
    if (state.mode !== 'hosting') return;
    const peer = hostPeers.get(clientId);
    if (peer) {
      sendToPeer(peer, { kind: 'kicked' });
      window.setTimeout(() => peer.pc.close(), 80);
      hostPeers.delete(clientId);
    }
    publish({ clients: state.clients.filter((client) => client.id !== clientId) });
    if (firebaseRuntime && state.inviteCode) {
      await firebaseRuntime.remove(firebaseRuntime.ref(
        firebaseRuntime.database,
        `multiplayer/rooms/${state.inviteCode}/peers/${clientId}`
      ));
    }
  }

  async function stopHosting(): Promise<void> {
    if (state.mode !== 'hosting') return;
    await resetSession(true);
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      inviteCode: null,
      hostName: null,
      clients: [],
      message: null
    });
  }

  async function leave(): Promise<void> {
    if (state.mode !== 'client') return;
    await resetSession(true);
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      inviteCode: null,
      hostName: null,
      clients: [],
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      message: null
    });
  }

  async function resetSession(removeRemote: boolean): Promise<void> {
    stopPeersListener?.();
    stopAnswerListener?.();
    stopPeersListener = null;
    stopAnswerListener = null;
    for (const peer of hostPeers.values()) peer.pc.close();
    hostPeers.clear();
    clientPeer?.pc.close();
    clientPeer = null;

    try {
      if (removeRemote && firebaseRuntime && state.mode === 'hosting' && roomRef) {
        await firebaseRuntime.remove(roomRef);
      } else if (removeRemote && firebaseRuntime && ownPeerRef) {
        await firebaseRuntime.remove(ownPeerRef);
      }
    } catch {
      // The disconnect registration remains a best-effort cleanup fallback.
    }
    await roomDisconnect?.cancel().catch(() => undefined);
    await peerDisconnect?.cancel().catch(() => undefined);
    roomDisconnect = null;
    peerDisconnect = null;
    roomRef = null;
    ownPeerRef = null;
    firebaseRuntime = null;
    lastCatalogSources = null;
    lastPlaybackSource = null;
    lastTrackSource = null;
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    startHosting,
    stopHosting,
    join,
    leave,
    kick,
    sendCommand,
    updateHostState,
    destroy() {
      void resetSession(true);
    }
  };
}

async function loadFirebase(): Promise<FirebaseRuntime> {
  const [appModule, authModule, databaseModule] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/database')
  ]);
  const app = appModule.getApps().find((candidate) => candidate.options.projectId === FIREBASE_CONFIG.projectId)
    ?? appModule.initializeApp(FIREBASE_CONFIG);
  const auth = authModule.getAuth(app);
  const credential = auth.currentUser
    ? { user: auth.currentUser }
    : await authModule.signInAnonymously(auth);

  return {
    database: databaseModule.getDatabase(app),
    uid: credential.user.uid,
    ref: databaseModule.ref,
    set: databaseModule.set,
    get: databaseModule.get,
    remove: databaseModule.remove,
    onValue: databaseModule.onValue,
    onDisconnect: databaseModule.onDisconnect
  };
}

function createPeer(id: string, name: string): PeerConnection {
  return {
    id,
    name,
    pc: new RTCPeerConnection({ iceServers: [] }),
    channel: null,
    outgoing: [],
    flushing: false,
    decode: createMultiplayerMessageDecoder(isClientMessage)
  };
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ClientMessage> & Record<string, unknown>;
  if (message.kind === 'hello') {
    return message.version === MULTIPLAYER_PROTOCOL_VERSION
      && typeof message.name === 'string'
      && typeof message.platform === 'string';
  }
  return message.kind === 'command' && isMultiplayerCommand(message.command);
}

function isSignalOffer(value: unknown): value is SignalOffer {
  if (!value || typeof value !== 'object') return false;
  const offer = value as Partial<SignalOffer>;
  return typeof offer.name === 'string'
    && typeof offer.platform === 'string'
    && typeof offer.createdAt === 'number'
    && Boolean(offer.description)
    && (offer.description?.type === 'offer');
}

function createInviteCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function normalizeInviteCode(value: string): string | null {
  const trimmed = value.trim();
  const fragmentMatch = trimmed.match(/(?:^|[#?&])(?:multiplayer|room)=([a-z0-9]{8})(?![a-z0-9])/);
  const code = fragmentMatch?.[1] ?? trimmed;
  return /^[a-z0-9]{8}$/.test(code) ? code : null;
}

function getLocalName(): string {
  return sanitizeClientName(experimentalSettings.getSnapshot().izciName);
}

function getClientPlatform(): string {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform;
  return sanitizePlatform(platform || 'Unknown');
}

function sanitizeClientName(value: string): string {
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
  return name || 'Guest client';
}

function sanitizePlatform(value: string): string {
  const platform = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32);
  return platform || 'Unknown';
}

async function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, 5_000);
    function done() {
      window.clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    }
    function handleChange() {
      if (pc.iceGatheringState === 'complete') done();
    }
    pc.addEventListener('icegatheringstatechange', handleChange);
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
