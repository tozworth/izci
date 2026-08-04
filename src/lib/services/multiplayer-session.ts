import { writable, type Readable } from 'svelte/store';
import type { Database, DatabaseReference, OnDisconnect, Unsubscribe } from 'firebase/database';
import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import {
  forgetMultiplayerPairing,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import {
  getMultiplayerArtworkTrackKey,
  loadMultiplayerArtwork
} from './multiplayer-artwork';
import {
  multiplayerAudioService,
  type MultiplayerReceiverAudioStatus
} from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import {
  updateReceivedBitrateWindow,
  type ReceivedByteSample
} from './multiplayer-receiver-bitrate';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  isHostMessage,
  isMultiplayerCommand,
  sanitizePlaylistItem,
  type ClientMessage,
  type HostMessage,
  type MultiplayerAudioAvailability,
  type MultiplayerArtwork,
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

const ICE_CONNECTION_TIMEOUT_MS = 15_000;
const RECEIVER_BITRATE_SAMPLE_INTERVAL_MS = 1_000;

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
export type MultiplayerAudioStatus = MultiplayerReceiverAudioStatus | 'disabled' | 'video-disabled';

export interface MultiplayerClient {
  id: string;
  name: string;
  platform: string;
  status: 'connecting' | 'connected' | 'disconnected';
  paired: boolean;
}

export interface MultiplayerSessionState {
  mode: MultiplayerMode;
  connectionStatus: MultiplayerConnectionStatus;
  inviteCode: string | null;
  hostName: string | null;
  clients: MultiplayerClient[];
  remoteCatalog: MultiplayerCatalog;
  remotePlayback: MultiplayerPlayback;
  remoteArtwork: MultiplayerArtwork | null;
  audioStatus: MultiplayerAudioStatus;
  averageAudioBitrateKbps: number | null;
  connectionDetail: string | null;
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

interface SignalAnswer {
  description?: RTCSessionDescriptionInit;
  error?: 'host-full';
  createdAt?: number;
}

interface SignalCandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

type SignalCandidates = Record<string, SignalCandidate>;

interface PairedClientRecord {
  name: string;
  platform: string;
  pairedAt: number;
}

interface PeerConnection {
  id: string;
  name: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  outgoing: string[];
  flushing: boolean;
  decode: ReturnType<typeof createMultiplayerMessageDecoder<ClientMessage>>;
  audioSender: RTCRtpSender | null;
  pendingAudioBitrate: number | null;
  audioBitrateUpdate: Promise<void> | null;
  localCandidateTypes: Set<string>;
  remoteCandidateTypes: Set<string>;
  pendingRemoteCandidates: Map<string, SignalCandidate>;
  appliedRemoteCandidateIds: Set<string>;
  candidateErrors: string[];
  connectionTimer: number | null;
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
  joinPaired(hostId: string): Promise<void>;
  leave(): Promise<void>;
  kick(clientId: string): Promise<void>;
  togglePairing(clientId: string): Promise<void>;
  sendCommand(command: MultiplayerCommandInput): boolean;
  resumeAudio(): Promise<boolean>;
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
    remoteArtwork: null,
    audioStatus: 'idle',
    averageAudioBitrateKbps: null,
    connectionDetail: null,
    message: null
  };
  const store = writable(state);
  const hostPeers = new Map<string, PeerConnection>();
  let firebaseRuntime: FirebaseRuntime | null = null;
  let roomRef: DatabaseReference | null = null;
  let hostDirectoryRef: DatabaseReference | null = null;
  let ownPeerRef: DatabaseReference | null = null;
  let roomDisconnect: OnDisconnect | null = null;
  let hostDirectoryDisconnect: OnDisconnect | null = null;
  let peerDisconnect: OnDisconnect | null = null;
  let stopPeersListener: Unsubscribe | null = null;
  let stopAnswerListener: Unsubscribe | null = null;
  let clientPeer: PeerConnection | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let reconnectInFlight = false;
  let receiverBitrateTimer: number | null = null;
  let receiverBitrateSampling = false;
  let receiverBitrateSamples: ReceivedByteSample[] = [];
  let allowClientReconnect = false;
  let clientHiddenAt: number | null = null;
  let latestHostState: MultiplayerHostState | null = null;
  let catalogRevision = 0;
  let lastCatalogSources: Pick<MultiplayerHostState, 'playlist' | 'library' | 'favorites' | 'shuffleEnabled' | 'repeatMode'> | null = null;
  let lastPlaybackSource: PlaybackSnapshot | null = null;
  let lastTrackSource: PlaylistItem | null = null;
  let latestHostArtwork: MultiplayerArtwork | null = null;
  let hostArtworkTrackKey = '';
  let hostArtworkLoadToken = 0;
  let latestAudioAvailability: MultiplayerAudioAvailability = {
    enabled: false,
    reason: 'host-disabled'
  };
  const rejectedPeerIds = new Set<string>();
  let multiplayerSettings = experimentalSettings.getSnapshot();

  const unsubscribeSettings = experimentalSettings.subscribe((settings) => {
    multiplayerSettings = settings;
    if (state.mode === 'hosting') syncHostAudio(latestHostState?.track ?? null);
  });
  window.addEventListener('online', handleClientResume);
  document.addEventListener('visibilitychange', handleClientResume);

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
          status: patch.status ?? 'connecting',
          paired: patch.paired ?? false
        }];
    publish({ clients });
  }

  async function startHosting(): Promise<string> {
    allowClientReconnect = false;
    await resetSession(true);
    publish({
      mode: 'hosting',
      connectionStatus: 'connecting',
      hostName: getLocalName(),
      audioStatus: 'idle',
      connectionDetail: 'Creating a Firebase signaling room...',
      message: null
    });

    try {
      const firebase = await loadFirebase();
      publish({ connectionDetail: 'Publishing the multiplayer room...' });
      const inviteCode = createInviteCode();
      const nextRoomRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}`);
      firebaseRuntime = firebase;
      roomRef = nextRoomRef;
      const nextHostDirectoryRef = firebase.ref(
        firebase.database,
        `multiplayer/hosts/${firebase.uid}/directory`
      );
      hostDirectoryRef = nextHostDirectoryRef;
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
      await firebase.set(nextHostDirectoryRef, {
        currentRoom: inviteCode,
        hostName: getLocalName(),
        protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        updatedAt: Date.now()
      });
      const directoryDisconnect = firebase.onDisconnect(nextHostDirectoryRef);
      await directoryDisconnect.remove();

      roomDisconnect = disconnect;
      hostDirectoryDisconnect = directoryDisconnect;
      stopPeersListener = firebase.onValue(
        firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/peers`),
        (snapshot) => {
          const peers = snapshot.val() as Record<string, {
            client?: SignalOffer;
            clientCandidates?: SignalCandidates;
          }> | null;
          const liveIds = new Set(
            Object.entries(peers ?? {})
              .filter(([, peerSignal]) => isSignalOffer(peerSignal.client))
              .map(([id]) => id)
          );
          for (const [id, peer] of hostPeers) {
            if (!liveIds.has(id)) {
              clearPeerConnectionTimer(peer);
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
              void acceptClientOffer(
                inviteCode,
                id,
                peerSignal.client,
                peerSignal.clientCandidates ?? {}
              );
            } else {
              const peer = hostPeers.get(id);
              if (peer) stageRemoteCandidates(peer, peerSignal.clientCandidates ?? {});
            }
          }
        }
      );

      publish({
        mode: 'hosting',
        connectionStatus: 'connected',
        inviteCode,
        connectionDetail: null
      });
      primeHostState();
      return inviteCode;
    } catch (error) {
      await resetSession(true);
      publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        connectionDetail: errorMessage(error, 'Could not start multiplayer hosting.'),
        message: errorMessage(error, 'Could not start multiplayer hosting.')
      });
      throw error;
    }
  }

  async function acceptClientOffer(
    inviteCode: string,
    id: string,
    offer: SignalOffer,
    candidates: SignalCandidates
  ): Promise<void> {
    if (!firebaseRuntime || state.mode !== 'hosting') return;
    if (hostPeers.size >= multiplayerSettings.multiplayerMaxListeners) {
      if (!rejectedPeerIds.has(id)) {
        rejectedPeerIds.add(id);
        await firebaseRuntime.set(
          firebaseRuntime.ref(
            firebaseRuntime.database,
            `multiplayer/rooms/${inviteCode}/peers/${id}/host`
          ),
          { error: 'host-full', createdAt: Date.now() } satisfies SignalAnswer
        );
        window.setTimeout(() => {
          rejectedPeerIds.delete(id);
          if (!firebaseRuntime || state.mode !== 'hosting') return;
          void firebaseRuntime.remove(firebaseRuntime.ref(
            firebaseRuntime.database,
            `multiplayer/rooms/${inviteCode}/peers/${id}`
          ));
        }, 5_000);
      }
      return;
    }
    const peer = createPeer(id, sanitizeClientName(offer.name));
    hostPeers.set(id, peer);
    const pairingSnapshot = await firebaseRuntime.get(firebaseRuntime.ref(
      firebaseRuntime.database,
      `multiplayer/hosts/${firebaseRuntime.uid}/paired/${id}`
    ));
    updateClient(id, {
      name: peer.name,
      platform: sanitizePlatform(offer.platform),
      status: 'connecting',
      paired: pairingSnapshot.exists()
    });

    peer.pc.ondatachannel = (event) => attachHostChannel(peer, event.channel);
    peer.pc.onconnectionstatechange = () => {
      const status = peer.pc.connectionState;
      if (status === 'connected') {
        clearPeerConnectionTimer(peer);
        updateClient(id, { status: 'connected' });
        publish({ message: null });
      }
      if (status === 'failed' || status === 'disconnected' || status === 'closed') {
        updateClient(id, { status: 'disconnected' });
      }
      if (status === 'failed') publish({ message: describeIceFailure(peer, peer.name) });
    };

    try {
      await peer.pc.setRemoteDescription(offer.description);
      stageRemoteCandidates(peer, candidates);
      const audioTransceiver = peer.pc.getTransceivers().find(
        (transceiver) => transceiver.receiver.track.kind === 'audio'
      );
      if (audioTransceiver) {
        preferOpus(audioTransceiver);
        audioTransceiver.direction = 'sendonly';
        peer.audioSender = audioTransceiver.sender;
        await peer.audioSender.replaceTrack(
          multiplayerSettings.multiplayerStreamAudio
            ? multiplayerAudioService.getHostTrack()
            : null
        );
      }
      const answer = enableOpusStereo(await peer.pc.createAnswer());
      const answerPath = `multiplayer/rooms/${inviteCode}/peers/${id}/host`;
      const startCandidatePublishing = prepareCandidatePublisher(
        peer,
        `${answerPath}Candidates`,
        () => firebaseRuntime,
        () => {
          clearPeerConnectionTimer(peer);
          publish({
            message: `Could not send ICE candidates for ${peer.name}. The deployed Firebase rules may be out of date.`
          });
        }
      );
      await peer.pc.setLocalDescription(answer);
      await applyAudioBitrate(peer);
      if (!firebaseRuntime || state.mode !== 'hosting') return;
      await firebaseRuntime.set(
        firebaseRuntime.ref(firebaseRuntime.database, answerPath),
        { description: peer.pc.localDescription?.toJSON(), createdAt: Date.now() }
      );
      startCandidatePublishing();
      startPeerConnectionTimer(peer, () => {
        if (peer.pc.connectionState === 'connected' || state.mode !== 'hosting') return;
        updateClient(id, { status: 'disconnected' });
        publish({ message: describeIceFailure(peer, peer.name) });
      });
    } catch (error) {
      peer.pc.close();
      hostPeers.delete(id);
      updateClient(id, { status: 'disconnected' });
      publish({
        message: `Could not finish the connection to ${peer.name}: ${errorMessage(error, 'ICE signaling failed.')}`
      });
    }
  }

  async function togglePairing(clientId: string): Promise<void> {
    if (!firebaseRuntime || state.mode !== 'hosting') return;
    const client = state.clients.find((candidate) => candidate.id === clientId);
    const peer = hostPeers.get(clientId);
    if (!client || !peer) return;

    const pairingRef = firebaseRuntime.ref(
      firebaseRuntime.database,
      `multiplayer/hosts/${firebaseRuntime.uid}/paired/${clientId}`
    );
    const paired = !client.paired;
    if (paired) {
      await firebaseRuntime.set(pairingRef, {
        name: client.name,
        platform: client.platform,
        pairedAt: Date.now()
      } satisfies PairedClientRecord);
    } else {
      await firebaseRuntime.remove(pairingRef);
    }
    updateClient(clientId, { paired });
    sendToPeer(peer, {
      kind: 'pairing',
      paired,
      hostId: firebaseRuntime.uid,
      name: getLocalName()
    });
  }

  function attachHostChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onopen = () => {
      clearPeerConnectionTimer(peer);
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
    allowClientReconnect = true;
    reconnectAttempts = 0;
    await connectClient(rawInviteCode, false);
    if (state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
  }

  async function joinPaired(hostId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) {
      throw new Error('That paired multiplayer host is invalid.');
    }
    const firebase = await loadFirebase();
    const directory = (await firebase.get(firebase.ref(
      firebase.database,
      `multiplayer/hosts/${hostId}/directory`
    ))).val() as {
      currentRoom?: string;
      hostName?: string;
      protocolVersion?: number;
    } | null;
    if (!directory
      || directory.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION
      || !normalizeInviteCode(directory.currentRoom ?? '')) {
      throw new Error('That paired host is not currently hosting.');
    }
    rememberMultiplayerPairing(hostId, sanitizeClientName(directory.hostName ?? 'Host'));
    await join(directory.currentRoom!);
  }

  async function connectClient(rawInviteCode: string, reconnecting: boolean): Promise<void> {
    clearReconnectTimer();
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
      remoteCatalog: reconnecting ? state.remoteCatalog : EMPTY_CATALOG,
      remotePlayback: reconnecting ? state.remotePlayback : EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: reconnecting ? state.remoteArtwork : null,
      audioStatus: 'connecting',
      averageAudioBitrateKbps: null,
      connectionDetail: 'Signing in to multiplayer signaling...',
      message: null
    });

    try {
      const firebase = await loadFirebase();
      firebaseRuntime = firebase;
      publish({ connectionDetail: 'Looking up the multiplayer session...' });
      const metaRef = firebase.ref(firebase.database, `multiplayer/rooms/${inviteCode}/meta`);
      const meta = (await firebase.get(metaRef)).val() as {
        protocolVersion?: number;
        hostName?: string;
      } | null;
      if (!meta || meta.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new Error('That multiplayer session is unavailable or incompatible.');
      }
      publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });
      publish({ connectionDetail: 'Preparing a direct peer connection...' });

      const peer = createPeer(firebase.uid, getLocalName());
      preferOpus(peer.pc.addTransceiver('audio', { direction: 'recvonly' }));
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

      const offer = enableOpusStereo(await peer.pc.createOffer());
      publish({ connectionDetail: 'Creating an ICE connection offer...' });
      const startCandidatePublishing = prepareCandidatePublisher(
        peer,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/clientCandidates`,
        () => firebaseRuntime,
        () => {
          allowClientReconnect = false;
          clearPeerConnectionTimer(peer);
          publish({
            connectionStatus: 'error',
            audioStatus: 'unavailable',
            message: 'Could not send ICE candidates. The deployed Firebase multiplayer rules may be out of date.'
          });
        }
      );
      await peer.pc.setLocalDescription(offer);
      publish({ connectionDetail: 'Gathering and sending ICE candidates...' });
      await firebase.set(clientSignalRef, {
        name: peer.name,
        platform: getClientPlatform(),
        description: peer.pc.localDescription?.toJSON(),
        createdAt: Date.now()
      });
      startCandidatePublishing();
      publish({ connectionDetail: `Waiting for ${state.hostName ?? 'the host'} to answer...` });
      startPeerConnectionTimer(peer, () => {
        if (clientPeer !== peer || peer.pc.connectionState === 'connected') return;
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: describeIceFailure(peer),
          message: describeIceFailure(peer)
        });
        scheduleClientReconnect(2_000);
      });

      stopAnswerListener = firebase.onValue(
        nextPeerRef,
        (snapshot) => {
          const signal = snapshot.val() as {
            host?: SignalAnswer;
            hostCandidates?: SignalCandidates;
          } | null;
          const answer = signal?.host;
          if (answer?.error === 'host-full') {
            allowClientReconnect = false;
            clearPeerConnectionTimer(peer);
            publish({
              connectionStatus: 'error',
              audioStatus: 'unavailable',
              connectionDetail: 'The host has reached its listener limit.',
              message: 'That multiplayer host has reached its listener limit.'
            });
            peer.pc.close();
            if (firebaseRuntime && ownPeerRef) void firebaseRuntime.remove(ownPeerRef);
            return;
          }
          stageRemoteCandidates(peer, signal?.hostCandidates ?? {});
          if (!answer?.description || peer.pc.remoteDescription) return;
          publish({ connectionDetail: 'Checking direct ICE routes...' });
          void peer.pc.setRemoteDescription(answer.description)
            .then(() => flushRemoteCandidates(peer))
            .catch((error) => {
              clearPeerConnectionTimer(peer);
              publish({
                connectionStatus: 'error',
                audioStatus: 'unavailable',
                connectionDetail: 'The host answer was rejected by the browser.',
                message: `The host answer could not be applied: ${errorMessage(error, 'invalid session description')}`
              });
            });
        }
      );
    } catch (error) {
      await resetSession(true);
      if (reconnecting && allowClientReconnect) {
        publish({
          mode: 'client',
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: 'The signaling attempt failed; preparing another attempt...',
          message: 'Reconnecting to the host...'
        });
      } else {
        allowClientReconnect = false;
        publish({
          mode: 'idle',
          connectionStatus: 'error',
          hostName: null,
          audioStatus: 'unavailable',
          connectionDetail: errorMessage(error, 'Could not join that multiplayer session.'),
          message: errorMessage(error, 'Could not join that multiplayer session.')
        });
      }
      throw error;
    }
  }

  function attachClientChannel(peer: PeerConnection): void {
    const channel = peer.channel;
    if (!channel) return;
    const decode = createMultiplayerMessageDecoder(isHostMessage);

    channel.onopen = () => {
      if (clientPeer !== peer) return;
      reconnectAttempts = 0;
      reconnectInFlight = false;
      clearReconnectTimer();
      publish({ connectionStatus: 'connected', connectionDetail: null, message: null });
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
      if (message.kind === 'artwork') publish({ remoteArtwork: message.artwork });
      if (message.kind === 'pairing') {
        if (message.paired) rememberMultiplayerPairing(message.hostId, message.name);
        else forgetMultiplayerPairing(message.hostId);
      }
      if (message.kind === 'audio') {
        latestAudioAvailability = message.audio;
        if (!message.audio.enabled) {
          publish({
            audioStatus: message.audio.reason === 'video-disabled' ? 'video-disabled' : 'disabled',
            averageAudioBitrateKbps: null
          });
        } else if (state.audioStatus === 'disabled' || state.audioStatus === 'video-disabled') {
          publish({ audioStatus: 'connecting' });
        }
        if (message.audio.enabled) void multiplayerAudioService.resumeRemoteAudio();
      }
      if (message.kind === 'kicked') {
        allowClientReconnect = false;
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          message: 'The host removed this client.'
        });
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
      if (clientPeer !== peer) return;
      if (state.mode === 'client' && state.connectionStatus !== 'error') {
        publish({
          connectionStatus: allowClientReconnect ? 'connecting' : 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: allowClientReconnect
            ? 'The peer connection closed; preparing another attempt...'
            : state.message ?? 'Connection to the host was lost.',
          message: allowClientReconnect
            ? 'Reconnecting to the host...'
            : state.message ?? 'Connection to the host was lost.'
        });
        scheduleClientReconnect(1_000);
      }
    };
    peer.pc.onconnectionstatechange = () => {
      if (clientPeer !== peer) return;
      if (peer.pc.connectionState === 'connected') {
        clearPeerConnectionTimer(peer);
        reconnectAttempts = 0;
        clearReconnectTimer();
        publish({ connectionStatus: 'connected', connectionDetail: null, message: null });
      }
      if (peer.pc.connectionState === 'failed') {
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: describeIceFailure(peer),
          message: describeIceFailure(peer)
        });
        scheduleClientReconnect(1_000);
      }
      if (peer.pc.connectionState === 'disconnected') scheduleClientReconnect(4_000);
    };
    peer.pc.ontrack = (event) => {
      if (event.track.kind !== 'audio') return;
      startReceiverBitrateMonitor(peer);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      void multiplayerAudioService.attachRemoteTrack(event.track, stream, (audioStatus) => {
        if (state.mode !== 'client') return;
        if (!latestAudioAvailability.enabled
          && (audioStatus === 'connecting' || audioStatus === 'playing')) return;
        publish({
          audioStatus,
          averageAudioBitrateKbps: audioStatus === 'playing'
            ? state.averageAudioBitrateKbps
            : null
        });
      });
    };
  }

  function startReceiverBitrateMonitor(peer: PeerConnection): void {
    clearReceiverBitrateMonitor();
    receiverBitrateSamples = [];

    const sample = async () => {
      if (receiverBitrateSampling || clientPeer !== peer || state.mode !== 'client') return;
      receiverBitrateSampling = true;
      try {
        const stats = await peer.pc.getStats();
        let bytesReceived = 0;
        let foundAudio = false;
        stats.forEach((report) => {
          if (report.type !== 'inbound-rtp') return;
          const inbound = report as RTCInboundRtpStreamStats & { mediaType?: string };
          if ((inbound.kind ?? inbound.mediaType) !== 'audio') return;
          if (typeof inbound.bytesReceived !== 'number') return;
          bytesReceived += inbound.bytesReceived;
          foundAudio = true;
        });
        if (!foundAudio || clientPeer !== peer) return;
        const next = updateReceivedBitrateWindow(receiverBitrateSamples, {
          timestamp: performance.now(),
          bytesReceived
        });
        receiverBitrateSamples = next.samples;
        if (state.audioStatus === 'playing'
          && next.averageKbps !== state.averageAudioBitrateKbps) {
          publish({ averageAudioBitrateKbps: next.averageKbps });
        }
      } catch {
        // Receiver stats are optional; audio playback continues without a bitrate readout.
      } finally {
        receiverBitrateSampling = false;
      }
    };

    void sample();
    receiverBitrateTimer = window.setInterval(
      () => void sample(),
      RECEIVER_BITRATE_SAMPLE_INTERVAL_MS
    );
  }

  function clearReceiverBitrateMonitor(): void {
    if (receiverBitrateTimer !== null) window.clearInterval(receiverBitrateTimer);
    receiverBitrateTimer = null;
    receiverBitrateSamples = [];
  }

  function scheduleClientReconnect(delay?: number): void {
    if (!allowClientReconnect || state.mode !== 'client' || reconnectInFlight || reconnectTimer !== null) return;
    const inviteCode = state.inviteCode;
    if (!inviteCode) return;
    const backoff = [2_000, 5_000, 10_000, 20_000, 30_000];
    const wait = delay ?? backoff[Math.min(reconnectAttempts, backoff.length - 1)];
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (!allowClientReconnect || state.mode !== 'client') return;
      reconnectInFlight = true;
      reconnectAttempts += 1;
      publish({
        connectionStatus: 'connecting',
        audioStatus: 'connecting',
        connectionDetail: 'Reconnecting and gathering fresh ICE candidates...',
        message: 'Reconnecting to the host...'
      });
      void connectClient(inviteCode, true)
        .then(() => {
          reconnectInFlight = false;
          if (state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
        })
        .catch(() => {
          reconnectInFlight = false;
          scheduleClientReconnect();
        });
    }, wait);
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer === null) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function handleClientResume(): void {
    if (document.visibilityState === 'hidden') {
      clientHiddenAt = Date.now();
      return;
    }
    const suspendedFor = clientHiddenAt === null ? 0 : Date.now() - clientHiddenAt;
    clientHiddenAt = null;
    if (state.mode !== 'client' || !allowClientReconnect) return;
    if (clientPeer?.pc.connectionState === 'connected'
      && clientPeer.channel?.readyState === 'open'
      && suspendedFor < 10_000) return;
    clearReconnectTimer();
    scheduleClientReconnect(0);
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

    syncHostArtwork(next.track);
    syncHostAudio(next.track);
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
    syncHostArtwork(latestHostState.track);
    syncHostAudio(latestHostState.track);
  }

  function sendCurrentState(peer: PeerConnection): void {
    if (!latestHostState) return;
    sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(latestHostState) });
    sendToPeer(peer, { kind: 'playback', playback: buildPlayback(latestHostState) });
    sendToPeer(peer, { kind: 'artwork', artwork: latestHostArtwork });
    sendToPeer(peer, { kind: 'audio', audio: latestAudioAvailability });
  }

  function syncHostAudio(track: PlaylistItem | null): void {
    const enabled = multiplayerSettings.multiplayerStreamAudio
      && (multiplayerSettings.multiplayerIncludeVideoAudio || track?.kind !== 'video');
    const nextAvailability: MultiplayerAudioAvailability = {
      enabled,
      reason: multiplayerSettings.multiplayerStreamAudio
        ? enabled ? null : 'video-disabled'
        : 'host-disabled'
    };
    multiplayerAudioService.setHostAudible(enabled);

    if (multiplayerSettings.multiplayerStreamAudio) {
      const hostTrack = multiplayerAudioService.getHostTrack();
      for (const peer of hostPeers.values()) {
        if (peer.audioSender?.track !== hostTrack) {
          void peer.audioSender?.replaceTrack(hostTrack).catch(() => undefined);
        }
        void applyAudioBitrate(peer);
      }
    } else {
      for (const peer of hostPeers.values()) {
        if (peer.audioSender?.track) void peer.audioSender.replaceTrack(null).catch(() => undefined);
      }
    }

    if (nextAvailability.enabled !== latestAudioAvailability.enabled
      || nextAvailability.reason !== latestAudioAvailability.reason) {
      latestAudioAvailability = nextAvailability;
      broadcast({ kind: 'audio', audio: nextAvailability });
    }
  }

  async function applyAudioBitrate(peer: PeerConnection): Promise<void> {
    peer.pendingAudioBitrate = multiplayerSettings.multiplayerOpusBitrateKbps * 1_000;
    if (peer.audioBitrateUpdate) return peer.audioBitrateUpdate;

    peer.audioBitrateUpdate = (async () => {
      while (peer.pendingAudioBitrate !== null) {
        const bitrate = peer.pendingAudioBitrate;
        peer.pendingAudioBitrate = null;
        const sender = peer.audioSender;
        if (!sender) continue;
        const parameters = sender.getParameters();
        if (parameters.encodings.length === 0) continue;
        for (const encoding of parameters.encodings) encoding.maxBitrate = bitrate;
        await sender.setParameters(parameters).catch(() => undefined);
      }
    })().finally(() => {
      peer.audioBitrateUpdate = null;
    });
    return peer.audioBitrateUpdate;
  }

  function syncHostArtwork(track: PlaylistItem | null): void {
    const nextTrackKey = getMultiplayerArtworkTrackKey(track);
    if (nextTrackKey === hostArtworkTrackKey) return;

    hostArtworkTrackKey = nextTrackKey;
    latestHostArtwork = null;
    const loadToken = ++hostArtworkLoadToken;
    broadcast({ kind: 'artwork', artwork: null });

    if (!track) return;

    void loadMultiplayerArtwork(track).then((artwork) => {
      if (loadToken !== hostArtworkLoadToken || hostArtworkTrackKey !== nextTrackKey) return;
      latestHostArtwork = artwork;
      broadcast({ kind: 'artwork', artwork });
    }).catch(() => {
      if (loadToken !== hostArtworkLoadToken || hostArtworkTrackKey !== nextTrackKey) return;
      latestHostArtwork = null;
    });
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
      clearPeerConnectionTimer(peer);
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
    allowClientReconnect = false;
    await resetSession(true);
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      inviteCode: null,
      hostName: null,
      clients: [],
      audioStatus: 'idle',
      averageAudioBitrateKbps: null,
      connectionDetail: null,
      message: null
    });
  }

  async function leave(): Promise<void> {
    if (state.mode !== 'client') return;
    allowClientReconnect = false;
    clearReconnectTimer();
    await resetSession(true);
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      inviteCode: null,
      hostName: null,
      clients: [],
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: null,
      audioStatus: 'idle',
      averageAudioBitrateKbps: null,
      connectionDetail: null,
      message: null
    });
  }

  async function resetSession(removeRemote: boolean): Promise<void> {
    clearReceiverBitrateMonitor();
    stopPeersListener?.();
    stopAnswerListener?.();
    stopPeersListener = null;
    stopAnswerListener = null;
    for (const peer of hostPeers.values()) {
      clearPeerConnectionTimer(peer);
      peer.pc.close();
    }
    hostPeers.clear();
    const previousClientPeer = clientPeer;
    clientPeer = null;
    if (previousClientPeer) clearPeerConnectionTimer(previousClientPeer);
    previousClientPeer?.pc.close();
    multiplayerAudioService.clearRemoteTrack();
    multiplayerAudioService.releaseHostTrack();

    try {
      if (removeRemote && firebaseRuntime && state.mode === 'hosting' && roomRef) {
        await firebaseRuntime.remove(roomRef);
      } else if (removeRemote && firebaseRuntime && ownPeerRef) {
        await firebaseRuntime.remove(ownPeerRef);
      }
      if (removeRemote && firebaseRuntime && state.mode === 'hosting' && hostDirectoryRef) {
        await firebaseRuntime.remove(hostDirectoryRef);
      }
    } catch {
      // The disconnect registration remains a best-effort cleanup fallback.
    }
    await roomDisconnect?.cancel().catch(() => undefined);
    await hostDirectoryDisconnect?.cancel().catch(() => undefined);
    await peerDisconnect?.cancel().catch(() => undefined);
    roomDisconnect = null;
    hostDirectoryDisconnect = null;
    peerDisconnect = null;
    roomRef = null;
    hostDirectoryRef = null;
    ownPeerRef = null;
    firebaseRuntime = null;
    lastCatalogSources = null;
    lastPlaybackSource = null;
    lastTrackSource = null;
    latestHostArtwork = null;
    hostArtworkTrackKey = '';
    hostArtworkLoadToken += 1;
    rejectedPeerIds.clear();
    latestAudioAvailability = { enabled: false, reason: 'host-disabled' };
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    startHosting,
    stopHosting,
    join,
    joinPaired,
    leave,
    kick,
    togglePairing,
    sendCommand,
    resumeAudio: () => multiplayerAudioService.resumeRemoteAudio(),
    updateHostState,
    destroy() {
      allowClientReconnect = false;
      clearReconnectTimer();
      window.removeEventListener('online', handleClientResume);
      document.removeEventListener('visibilitychange', handleClientResume);
      unsubscribeSettings();
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
  await authModule.setPersistence(auth, authModule.browserLocalPersistence);
  await auth.authStateReady();
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
    pc: new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
      ]
    }),
    channel: null,
    outgoing: [],
    flushing: false,
    decode: createMultiplayerMessageDecoder(isClientMessage),
    audioSender: null,
    pendingAudioBitrate: null,
    audioBitrateUpdate: null,
    localCandidateTypes: new Set(),
    remoteCandidateTypes: new Set(),
    pendingRemoteCandidates: new Map(),
    appliedRemoteCandidateIds: new Set(),
    candidateErrors: [],
    connectionTimer: null
  };
}

function prepareCandidatePublisher(
  peer: PeerConnection,
  path: string,
  getFirebase: () => FirebaseRuntime | null,
  reportFailure: () => void
): () => void {
  let ready = false;
  let sequence = 0;
  let writeFailed = false;
  const queued: SignalCandidate[] = [];

  function write(candidate: SignalCandidate): void {
    const firebase = getFirebase();
    if (!firebase) return;
    const id = `c${String(sequence).padStart(3, '0')}`;
    sequence += 1;
    void firebase.set(firebase.ref(firebase.database, `${path}/${id}`), candidate).catch((error) => {
      peer.candidateErrors.push(errorMessage(error, 'candidate signaling failed'));
      if (writeFailed) return;
      writeFailed = true;
      reportFailure();
    });
  }

  peer.pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    const candidate = toSignalCandidate(event.candidate);
    noteCandidateType(peer.localCandidateTypes, candidate.candidate);
    if (ready) write(candidate);
    else queued.push(candidate);
  };
  peer.pc.onicecandidateerror = (event) => {
    const detail = [event.errorCode, event.errorText].filter(Boolean).join(' ');
    if (detail) peer.candidateErrors.push(detail);
  };

  return () => {
    ready = true;
    for (const candidate of queued.splice(0)) write(candidate);
  };
}

function toSignalCandidate(candidate: RTCIceCandidate): SignalCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? '',
    sdpMLineIndex: candidate.sdpMLineIndex ?? 0
  };
}

function stageRemoteCandidates(peer: PeerConnection, candidates: SignalCandidates): void {
  for (const [id, candidate] of Object.entries(candidates)) {
    if (peer.appliedRemoteCandidateIds.has(id)
      || peer.pendingRemoteCandidates.has(id)
      || !isSignalCandidate(candidate)) continue;
    peer.pendingRemoteCandidates.set(id, candidate);
    noteCandidateType(peer.remoteCandidateTypes, candidate.candidate);
  }
  void flushRemoteCandidates(peer);
}

async function flushRemoteCandidates(peer: PeerConnection): Promise<void> {
  if (!peer.pc.remoteDescription) return;
  for (const [id, candidate] of [...peer.pendingRemoteCandidates]) {
    try {
      await peer.pc.addIceCandidate(candidate);
      peer.appliedRemoteCandidateIds.add(id);
      peer.pendingRemoteCandidates.delete(id);
    } catch (error) {
      peer.candidateErrors.push(errorMessage(error, 'remote candidate rejected'));
      peer.pendingRemoteCandidates.delete(id);
    }
  }
}

function isSignalCandidate(value: unknown): value is SignalCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SignalCandidate>;
  return typeof candidate.candidate === 'string'
    && candidate.candidate.length > 0
    && typeof candidate.sdpMid === 'string'
    && typeof candidate.sdpMLineIndex === 'number';
}

function noteCandidateType(target: Set<string>, candidate: string): void {
  const type = candidate.match(/(?:^|\s)typ\s+([a-z]+)/i)?.[1]?.toLowerCase();
  if (type) target.add(type);
}

function startPeerConnectionTimer(peer: PeerConnection, handleTimeout: () => void): void {
  clearPeerConnectionTimer(peer);
  peer.connectionTimer = window.setTimeout(() => {
    peer.connectionTimer = null;
    handleTimeout();
  }, ICE_CONNECTION_TIMEOUT_MS);
}

function clearPeerConnectionTimer(peer: PeerConnection): void {
  if (peer.connectionTimer === null) return;
  window.clearTimeout(peer.connectionTimer);
  peer.connectionTimer = null;
}

function describeIceFailure(peer: PeerConnection, peerName?: string): string {
  const subject = peerName ? `Connection to ${peerName}` : 'Multiplayer connection';
  const local = [...peer.localCandidateTypes];
  const remote = [...peer.remoteCandidateTypes];
  const rejected = peer.candidateErrors.length;
  if (peer.candidateErrors.some((error) => /permission|signaling|rules/i.test(error))) {
    return `${subject} failed because ICE candidates could not be written to Firebase. The deployed multiplayer rules may be out of date.`;
  }
  if (local.length === 0) {
    return `${subject} failed because this device gathered no ICE candidates. Check browser WebRTC policy and network access.`;
  }
  if (!local.includes('srflx')) {
    return `${subject} failed with ${formatCandidateTypes(local)} candidates only; STUN did not provide this device a public route.`;
  }
  if (remote.length === 0) {
    return `${subject} failed because the other device supplied no usable ICE candidates.`;
  }
  return `${subject} failed after exchanging ${formatCandidateTypes(local)} local and ${formatCandidateTypes(remote)} remote candidates${rejected > 0 ? `; ${rejected} candidate error${rejected === 1 ? '' : 's'} occurred` : ''}. A NAT or firewall blocked every direct route; izci has no TURN fallback.`;
}

function formatCandidateTypes(types: string[]): string {
  const labels: Record<string, string> = {
    host: 'local',
    srflx: 'STUN',
    prflx: 'peer-reflexive',
    relay: 'relay'
  };
  return types.map((type) => labels[type] ?? type).join('/') || 'unknown';
}

function preferOpus(transceiver: RTCRtpTransceiver): void {
  const codecs = RTCRtpSender.getCapabilities?.('audio')?.codecs.filter(
    (codec) => codec.mimeType.toLowerCase() === 'audio/opus'
  ) ?? [];
  if (codecs.length === 0) return;
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {
    // The browser's default audio codec order still normally prefers Opus.
  }
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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && /permission[_ -]?denied/i.test(error.message)) {
    return 'Multiplayer signaling was rejected by the server. The app and server may be out of sync.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
