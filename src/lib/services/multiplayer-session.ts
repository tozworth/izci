import { writable, type Readable } from 'svelte/store';
import { version as appVersion } from '../../../package.json';
import type { Database, DatabaseReference, OnDisconnect, Unsubscribe } from 'firebase/database';
import type {
  PlaybackSnapshot,
  PlaylistItem,
  PlaylistRepeatMode
} from '$lib/types';
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
  createMultiplayerRtcConfiguration,
  resolveMultiplayerConnectionRoute,
  type MultiplayerConnectionRoute
} from './multiplayer-ice';
import {
  createMultiplayerTurnCredentialRequest,
  createMultiplayerTurnCredentialResponse,
  createMultiplayerTurnIceSettings,
  hasMultiplayerTurnIssuer,
  isMultiplayerTurnCredentialRequest,
  isMultiplayerTurnCredentialResponse,
  type MultiplayerTurnCredentialRequest,
  type MultiplayerTurnCredentialResponse
} from './multiplayer-turn-credentials';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import {
  updateReceivedBitrateWindow,
  type ReceivedByteSample
} from './multiplayer-receiver-bitrate';
import {
  updateMultiplayerPacketLossStats,
  type MultiplayerReceiverCounterSample
} from './multiplayer-receiver-stats';
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
  type MultiplayerPlayback,
  type MultiplayerPlaybackPreparation,
  type MultiplayerPlaybackPreparationAudio
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
const TURN_CREDENTIAL_RESPONSE_TIMEOUT_MS = 15_000;
const RECEIVER_BITRATE_SAMPLE_INTERVAL_MS = 1_000;
const RECEIVE_AUDIO_STORAGE_KEY = 'izci.multiplayer.receive-audio';
const SOURCE_FILE_CHUNK_SIZE = 16 * 1024;
const SOURCE_FILE_QUEUE_LIMIT = 1024 * 1024;

export function isMultiplayerClientTransportHealthy(
  connectionState: RTCPeerConnectionState,
  channelState: RTCDataChannelState | undefined
): boolean {
  return connectionState === 'connected' && channelState === 'open';
}

export function shouldTransferMultiplayerSourceFile(
  track: PlaylistItem | null,
  limitMiB: number,
  audioEnabled = true
): boolean {
  if (!audioEnabled || !track?.file || track.kind === 'video' || limitMiB === 0) return false;
  return limitMiB < 0 || track.file.size < limitMiB * 1024 * 1024;
}

export function isMultiplayerPlaybackPreparationReady(
  preparation: MultiplayerPlaybackPreparation,
  state: {
    remoteTrackId: string | null;
    receiveAudio: boolean;
    loadedSourceTrackId: string | null;
    streamReady: boolean;
  }
): boolean {
  if (state.remoteTrackId !== preparation.trackId) return false;
  if (!state.receiveAudio || preparation.audio === 'none') return true;
  if (preparation.audio === 'file') {
    return state.loadedSourceTrackId === preparation.trackId;
  }
  return state.streamReady;
}

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
export type MultiplayerAudioStatus = MultiplayerReceiverAudioStatus | 'disabled' | 'refused';

export interface MultiplayerConnectionStats {
  packetsReceived: number;
  packetsLost: number;
  packetLossPercent: number | null;
  recentPacketsReceived: number;
  recentPacketsLost: number;
  recentPacketLossPercent: number | null;
  jitterMs: number | null;
  roundTripTimeMs: number | null;
  codec: string | null;
}

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
  reconnecting: boolean;
  inviteCode: string | null;
  hostName: string | null;
  hostVersion: string | null;
  clients: MultiplayerClient[];
  remoteCatalog: MultiplayerCatalog;
  remotePlayback: MultiplayerPlayback;
  remoteArtwork: MultiplayerArtwork | null;
  remoteArtworkResolvedTrackKey: string;
  audioStatus: MultiplayerAudioStatus;
  connectionRoute: MultiplayerConnectionRoute | null;
  averageAudioBitrateKbps: number | null;
  receiveAudio: boolean;
  connectionStats: MultiplayerConnectionStats | null;
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

interface SignalPeerRecord {
  credentialRequest?: MultiplayerTurnCredentialRequest;
  credentialResponse?: MultiplayerTurnCredentialResponse;
  client?: SignalOffer;
  clientCandidates?: SignalCandidates;
  host?: SignalAnswer;
  hostCandidates?: SignalCandidates;
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

interface SourceFileBeginFrame {
  kind: 'file.begin';
  transferId: string;
  trackId: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

interface SourceFileEndFrame {
  kind: 'file.end';
  transferId: string;
}

interface PeerConnection {
  id: string;
  name: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  outgoing: string[];
  flushing: boolean;
  mediaChannel: RTCDataChannel | null;
  mediaOutgoing: Array<string | ArrayBuffer>;
  mediaQueuedBytes: number;
  mediaFlushing: boolean;
  mediaTransferToken: number;
  sourceTrackKey: string;
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
  pauseHostPlayback: () => void;
  resumeHostPlayback: () => void;
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
  cancelPendingPlayback(): boolean;
  resumeAudio(): Promise<boolean>;
  setReceiveAudio(enabled: boolean): void;
  updateHostState(next: MultiplayerHostState): void;
  destroy(): void;
}

export function createMultiplayerSession({
  handleHostCommand,
  pauseHostPlayback,
  resumeHostPlayback
}: CreateMultiplayerSessionOptions): MultiplayerSessionController {
  let state: MultiplayerSessionState = {
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostVersion: null,
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
  let pendingClientSourceFile: { trackId: string; file: File } | null = null;
  let pendingClientPlaybackPreparation: MultiplayerPlaybackPreparation | null = null;
  let clientRemoteAudioReady = false;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  let reconnectInFlight = false;
  let receiverBitrateTimer: number | null = null;
  let receiverBitrateSampling = false;
  let receiverBitrateSamples: ReceivedByteSample[] = [];
  let receiverCounterSamples: MultiplayerReceiverCounterSample[] = [];
  let allowClientReconnect = false;
  let latestHostState: MultiplayerHostState | null = null;
  let catalogRevision = 0;
  let lastCatalogSources: Pick<MultiplayerHostState, 'playlist' | 'library' | 'favorites' | 'shuffleEnabled' | 'repeatMode'> | null = null;
  let lastPlaybackSource: PlaybackSnapshot | null = null;
  let lastTrackSource: PlaylistItem | null = null;
  let latestHostArtwork: MultiplayerArtwork | null = null;
  let hostArtworkTrackKey = '';
  let hostArtworkResolvedTrackKey = '';
  let hostArtworkLoadToken = 0;
  let latestAudioAvailability: MultiplayerAudioAvailability = {
    enabled: false,
    sourceFile: false,
    postRaf: false,
    reason: 'host-disabled'
  };
  let hostPlaybackPreparation: {
    preparation: MultiplayerPlaybackPreparation;
    pendingPeerIds: Set<string>;
  } | null = null;
  let bypassHostPlaybackGateTrackId: string | null = null;
  const rejectedPeerIds = new Set<string>();
  const acceptingPeerIds = new Set<string>();
  const answeredTurnCredentialRequestIds = new Set<string>();
  let multiplayerSettings = experimentalSettings.getSnapshot();

  const unsubscribeSettings = experimentalSettings.subscribe((settings) => {
    const audioBufferChanged = settings.multiplayerAudioBufferMs
      !== multiplayerSettings.multiplayerAudioBufferMs;
    const waitForClientsDisabled = multiplayerSettings.multiplayerWaitForClients
      && !settings.multiplayerWaitForClients;
    multiplayerSettings = settings;
    if (state.mode === 'hosting') {
      syncHostAudio(latestHostState?.track ?? null);
      syncHostSourceFiles(latestHostState?.track ?? null);
      if (waitForClientsDisabled) {
        releasePreparedHostPlayback();
      } else if (hostPlaybackPreparation
        && hostPlaybackPreparation.preparation.audio
          !== resolvePlaybackPreparationAudio(latestAudioAvailability)) {
        beginHostPlaybackPreparation(hostPlaybackPreparation.preparation.trackId);
      }
    }
    if (state.mode === 'client' && clientPeer && audioBufferChanged) {
      applyClientAudioBuffer(clientPeer);
    }
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
          turnRelay: hasMultiplayerTurnIssuer(multiplayerSettings),
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
          const peers = snapshot.val() as Record<string, SignalPeerRecord> | null;
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
              removePeerFromHostPlaybackPreparation(id);
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
            if (isMultiplayerTurnCredentialRequest(peerSignal.credentialRequest)
              && !answeredTurnCredentialRequestIds.has(peerSignal.credentialRequest.requestId)) {
              void answerTurnCredentialRequest(inviteCode, id, peerSignal.credentialRequest);
            }
            if (!hostPeers.has(id)
              && !acceptingPeerIds.has(id)
              && isSignalOffer(peerSignal.client)) {
              acceptingPeerIds.add(id);
              void acceptClientOffer(
                inviteCode,
                id,
                peerSignal.client,
                peerSignal.clientCandidates ?? {}
              ).finally(() => acceptingPeerIds.delete(id));
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
      const message = errorMessage(error, 'Could not start multiplayer hosting.');
      publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        hostVersion: null,
        connectionDetail: message,
        message
      });
      throw new Error(message);
    }
  }

  async function answerTurnCredentialRequest(
    inviteCode: string,
    clientId: string,
    request: MultiplayerTurnCredentialRequest
  ): Promise<void> {
    if (!firebaseRuntime || state.mode !== 'hosting') return;
    answeredTurnCredentialRequestIds.add(request.requestId);
    try {
      const response = await createMultiplayerTurnCredentialResponse(
        request,
        multiplayerSettings,
        clientId
      );
      if (!firebaseRuntime || state.mode !== 'hosting') return;
      await firebaseRuntime.set(firebaseRuntime.ref(
        firebaseRuntime.database,
        `multiplayer/rooms/${inviteCode}/peers/${clientId}/credentialResponse`
      ), response);
    } catch (error) {
      answeredTurnCredentialRequestIds.delete(request.requestId);
      publish({
        message: `Could not issue temporary TURN credentials: ${errorMessage(error, 'credential exchange failed')}`
      });
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
    const peer = createPeer(
      id,
      sanitizeClientName(offer.name),
      await createMultiplayerTurnIceSettings(multiplayerSettings, `host-${id}`)
    );
    hostPeers.set(id, peer);
    void firebaseRuntime.remove(firebaseRuntime.ref(
      firebaseRuntime.database,
      `multiplayer/rooms/${inviteCode}/peers/${id}/credentialResponse`
    ));
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

    peer.pc.ondatachannel = (event) => {
      if (event.channel.label === 'izci-media') attachHostMediaChannel(peer, event.channel);
      else attachHostChannel(peer, event.channel);
    };
    peer.pc.onconnectionstatechange = () => {
      const status = peer.pc.connectionState;
      if (status === 'connected') {
        clearPeerConnectionTimer(peer);
        updateClient(id, { status: 'connected' });
        publish({ message: null });
      }
      if (status === 'failed' || status === 'disconnected' || status === 'closed') {
        updateClient(id, { status: 'disconnected' });
        removePeerFromHostPlaybackPreparation(id);
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
            ? multiplayerAudioService.getHostTrack(multiplayerSettings.multiplayerSendPostRaf)
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
        name: getLocalName(),
        appVersion
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
      if (message.kind === 'playback.ready') {
        acceptClientPlaybackReady(peer, message.preparationId);
      }
    };
    channel.onclose = () => {
      updateClient(peer.id, { status: 'disconnected' });
      removePeerFromHostPlaybackPreparation(peer.id);
    };
    sendToPeer(peer, {
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION,
      name: getLocalName(),
      appVersion
    });
  }

  async function join(rawInviteCode: string): Promise<void> {
    allowClientReconnect = true;
    reconnectAttempts = 0;
    multiplayerSourcePlaybackService.beginClientSession();
    multiplayerSourcePlaybackService.setEnabled(state.receiveAudio);
    try {
      await connectClient(rawInviteCode, false);
      if (state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
    } catch (error) {
      await multiplayerSourcePlaybackService.endClientSession();
      throw error;
    }
  }

  function attachHostMediaChannel(peer: PeerConnection, channel: RTCDataChannel): void {
    peer.mediaChannel = channel;
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onopen = () => syncPeerSourceFile(peer, latestHostState?.track ?? null);
    channel.onbufferedamountlow = () => flushPeerMedia(peer);
    channel.onclose = () => {
      peer.mediaTransferToken += 1;
      peer.mediaOutgoing = [];
      peer.mediaQueuedBytes = 0;
      peer.mediaFlushing = false;
    };
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
      reconnecting,
      inviteCode,
      hostName: null,
      hostVersion: null,
      remoteCatalog: reconnecting ? state.remoteCatalog : EMPTY_CATALOG,
      remotePlayback: reconnecting ? state.remotePlayback : EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: reconnecting ? state.remoteArtwork : null,
      remoteArtworkResolvedTrackKey: reconnecting ? state.remoteArtworkResolvedTrackKey : '',
      audioStatus: state.receiveAudio ? 'connecting' : 'refused',
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
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
        turnRelay?: boolean;
      } | null;
      if (!meta || meta.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        throw new Error('That multiplayer session is unavailable or incompatible.');
      }
      publish({ hostName: sanitizeClientName(meta.hostName ?? 'Host') });
      const turnSettings = meta.turnRelay
        ? await requestTemporaryTurnCredentials(firebase, inviteCode)
        : createDirectIceSettings();
      publish({ connectionDetail: meta.turnRelay
        ? 'Preparing a peer connection with TURN fallback...'
        : 'Preparing a direct peer connection...' });

      const peer = createPeer(firebase.uid, getLocalName(), turnSettings);
      const audioTransceiver = peer.pc.addTransceiver('audio', { direction: 'recvonly' });
      preferOpus(audioTransceiver);
      setMultiplayerReceiverBuffer(
        audioTransceiver.receiver,
        multiplayerSettings.multiplayerAudioBufferMs
      );
      const channel = peer.pc.createDataChannel('izci-control', { ordered: true });
      peer.channel = channel;
      const mediaChannel = peer.pc.createDataChannel('izci-media', { ordered: true });
      mediaChannel.binaryType = 'arraybuffer';
      peer.mediaChannel = mediaChannel;
      clientPeer = peer;
      pendingClientPlaybackPreparation = null;
      clientRemoteAudioReady = false;
      attachClientChannel(peer);
      attachClientMediaChannel(peer);

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
          hostVersion: null,
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
      publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
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
      if (message.kind === 'playback') {
        publish({ remotePlayback: message.playback });
        multiplayerSourcePlaybackService.syncPlayback(message.playback);
        loadPendingClientSourceFile(peer);
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'playback.prepare') {
        pendingClientPlaybackPreparation = message.preparation;
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'artwork') {
        publish({
          remoteArtwork: message.artwork,
          remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(state.remotePlayback.track)
        });
      }
      if (message.kind === 'pairing') {
        if (message.paired) rememberMultiplayerPairing(message.hostId, message.name);
        else forgetMultiplayerPairing(message.hostId);
      }
      if (message.kind === 'audio') {
        latestAudioAvailability = message.audio;
        if (!message.audio.enabled) clientRemoteAudioReady = false;
        if (!state.receiveAudio) {
          multiplayerSourcePlaybackService.setEnabled(false);
          publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
        } else if (message.audio.sourceFile) {
          multiplayerAudioService.clearRemoteTrack();
          multiplayerSourcePlaybackService.setEnabled(true);
          publish({ audioStatus: multiplayerSourcePlaybackService.active ? 'playing' : 'connecting' });
        } else if (!message.audio.enabled) {
          publish({
            audioStatus: 'disabled',
            averageAudioBitrateKbps: null
          });
          multiplayerSourcePlaybackService.clearSourceTrack();
        } else if (state.audioStatus === 'disabled') {
          publish({ audioStatus: 'connecting' });
        }
        if (message.audio.enabled && state.receiveAudio) {
          multiplayerSourcePlaybackService.clearSourceTrack();
          attachClientRemoteAudio(peer);
        }
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'kicked') {
        allowClientReconnect = false;
        multiplayerSourcePlaybackService.clearLoadedFile();
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
        publish({ hostName, hostVersion: message.appVersion });
        if (state.inviteCode) rememberMultiplayerHost(hostName, state.inviteCode);
      }
    };
    channel.onclose = () => {
      if (clientPeer !== peer) return;
      multiplayerSourcePlaybackService.clearLoadedFile();
      if (state.mode === 'client' && state.connectionStatus !== 'error') {
        publish({
          connectionStatus: allowClientReconnect ? 'connecting' : 'disconnected',
          reconnecting: allowClientReconnect,
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
        publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
        void updateClientConnectionRoute(peer);
      }
      if (peer.pc.connectionState === 'failed') {
        publish({
          connectionStatus: 'disconnected',
          reconnecting: allowClientReconnect,
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
      setMultiplayerReceiverBuffer(event.receiver, multiplayerSettings.multiplayerAudioBufferMs);
      startReceiverBitrateMonitor(peer);
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      if (!state.receiveAudio || latestAudioAvailability.sourceFile) {
        event.track.enabled = false;
        publish({
          audioStatus: state.receiveAudio ? 'connecting' : 'refused',
          averageAudioBitrateKbps: null
        });
        return;
      }
      void multiplayerAudioService.attachRemoteTrack(
        event.track,
        stream,
        (audioStatus) => {
          if (state.mode !== 'client') return;
          if (!latestAudioAvailability.enabled
            && (audioStatus === 'connecting' || audioStatus === 'playing')) return;
          publish({
            audioStatus,
            averageAudioBitrateKbps: audioStatus === 'playing'
              ? state.averageAudioBitrateKbps
              : null
          });
          clientRemoteAudioReady = audioStatus === 'playing';
          sendClientPlaybackReadyIfPossible(peer);
        }
      );
    };
  }

  function attachClientRemoteAudio(peer: PeerConnection): void {
    if (clientPeer !== peer || !state.receiveAudio || !latestAudioAvailability.enabled) return;
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') return;
    track.enabled = true;
    void multiplayerAudioService.attachRemoteTrack(track, new MediaStream([track]), (audioStatus) => {
      if (state.mode === 'client' && state.receiveAudio && latestAudioAvailability.enabled) {
        publish({ audioStatus });
        clientRemoteAudioReady = audioStatus === 'playing';
        sendClientPlaybackReadyIfPossible(peer);
      }
    });
  }

  function attachClientMediaChannel(peer: PeerConnection): void {
    const channel = peer.mediaChannel;
    if (!channel) return;
    channel.binaryType = 'arraybuffer';
    let pending: {
      frame: SourceFileBeginFrame;
      chunks: ArrayBuffer[];
      received: number;
    } | null = null;

    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const frame = parseSourceFileFrame(event.data);
        if (!frame) return;
        if (frame.kind === 'file.begin') {
          pending = { frame, chunks: [], received: 0 };
          multiplayerAudioService.clearRemoteTrack();
          // Keep the current file audible until its replacement is completely received
          // and prepared. Stopping the only active media element here lets mobile
          // Chromium suspend a locked client before the remaining chunks can arrive.
          if (state.receiveAudio) publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
          return;
        }
        if (!pending || pending.frame.transferId !== frame.transferId) return;
        const complete = pending;
        pending = null;
        if (complete.received !== complete.frame.size) {
          publish({ audioStatus: 'unavailable' });
          return;
        }
        const file = new File(complete.chunks, complete.frame.name, {
          type: complete.frame.type,
          lastModified: complete.frame.lastModified
        });
        pendingClientSourceFile = { trackId: complete.frame.trackId, file };
        loadPendingClientSourceFile(peer);
        return;
      }
      if (!pending || !(event.data instanceof ArrayBuffer)) return;
      if (pending.received + event.data.byteLength > pending.frame.size) {
        pending = null;
        publish({ audioStatus: 'unavailable' });
        return;
      }
      pending.chunks.push(event.data);
      pending.received += event.data.byteLength;
    };
    channel.onclose = () => {
      pending = null;
      if (clientPeer === peer && latestAudioAvailability.sourceFile) {
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({ audioStatus: 'unavailable' });
      }
    };
  }

  function loadPendingClientSourceFile(peer: PeerConnection): void {
    const pending = pendingClientSourceFile;
    const remoteTrack = state.remotePlayback.track;
    if (!pending || !remoteTrack || remoteTrack.id !== pending.trackId) return;
    pendingClientSourceFile = null;
    void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then((loaded) => {
      if (clientPeer !== peer || !state.receiveAudio) return;
      publish({ audioStatus: loaded ? 'playing' : 'unavailable', averageAudioBitrateKbps: null });
      sendClientPlaybackReadyIfPossible(peer);
    });
  }

  function sendClientPlaybackReadyIfPossible(peer: PeerConnection): void {
    const preparation = pendingClientPlaybackPreparation;
    if (!preparation || clientPeer !== peer) return;
    const remoteTrackId = state.remotePlayback.track?.id ?? null;
    if (!isMultiplayerPlaybackPreparationReady(preparation, {
      remoteTrackId,
      receiveAudio: state.receiveAudio,
      loadedSourceTrackId: multiplayerSourcePlaybackService.isTrackReady(preparation.trackId)
        ? preparation.trackId
        : null,
      streamReady: clientRemoteAudioReady
    })) return;
    pendingClientPlaybackPreparation = null;
    sendToPeer(peer, {
      kind: 'playback.ready',
      preparationId: preparation.preparationId
    });
  }

  async function updateClientConnectionRoute(peer: PeerConnection): Promise<void> {
    try {
      const route = resolveMultiplayerConnectionRoute((await peer.pc.getStats()).values());
      if (clientPeer === peer && route) publish({ connectionRoute: route });
    } catch {
      // Connection stats are optional; the client remains usable without a route label.
    }
  }

  function applyClientAudioBuffer(peer: PeerConnection): void {
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      setMultiplayerReceiverBuffer(receiver, multiplayerSettings.multiplayerAudioBufferMs);
    }
  }

  function startReceiverBitrateMonitor(peer: PeerConnection): void {
    clearReceiverBitrateMonitor();
    receiverBitrateSamples = [];
    receiverCounterSamples = [];

    const sample = async () => {
      if (receiverBitrateSampling || clientPeer !== peer || state.mode !== 'client') return;
      receiverBitrateSampling = true;
      try {
        const stats = await peer.pc.getStats();
        let bytesReceived = 0;
        let foundAudio = false;
        let packetsReceived = 0;
        let packetsLost = 0;
        let jitterMs: number | null = null;
        let codec: string | null = null;
        let codecId: string | null = null;
        let roundTripTimeMs: number | null = null;
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp') {
            const inbound = report as RTCInboundRtpStreamStats & { mediaType?: string };
            if ((inbound.kind ?? inbound.mediaType) !== 'audio') return;
            if (typeof inbound.bytesReceived === 'number') bytesReceived += inbound.bytesReceived;
            if (typeof inbound.packetsReceived === 'number') packetsReceived += inbound.packetsReceived;
            if (typeof inbound.packetsLost === 'number') packetsLost += Math.max(0, inbound.packetsLost);
            if (typeof inbound.jitter === 'number') jitterMs = inbound.jitter * 1_000;
            if (typeof inbound.codecId === 'string') codecId = inbound.codecId;
            foundAudio = true;
            return;
          }
          if (report.type === 'candidate-pair') {
            const pair = report as RTCIceCandidatePairStats;
            if (pair.state === 'succeeded' && pair.nominated
              && typeof pair.currentRoundTripTime === 'number') {
              roundTripTimeMs = pair.currentRoundTripTime * 1_000;
            }
          }
        });
        if (!foundAudio || clientPeer !== peer) return;
        if (codecId) {
          const codecReport = stats.get(codecId) as {
            mimeType?: string;
            clockRate?: number;
          } | undefined;
          if (codecReport?.mimeType) {
            codec = codecReport.mimeType.replace(/^audio\//i, '');
            if (typeof codecReport.clockRate === 'number') codec += ` ${Math.round(codecReport.clockRate / 1_000)} kHz`;
          }
        }
        const next = updateReceivedBitrateWindow(receiverBitrateSamples, {
          timestamp: performance.now(),
          bytesReceived
        });
        receiverBitrateSamples = next.samples;
        const loss = updateMultiplayerPacketLossStats(receiverCounterSamples, {
          timestamp: performance.now(),
          packetsReceived,
          packetsLost
        });
        receiverCounterSamples = loss.samples;
        publish({
          connectionStats: {
            packetsReceived: loss.totalReceived,
            packetsLost: loss.totalLost,
            packetLossPercent: loss.totalPercent,
            recentPacketsReceived: loss.recentReceived,
            recentPacketsLost: loss.recentLost,
            recentPacketLossPercent: loss.recentPercent,
            jitterMs: jitterMs === null ? null : Math.round(jitterMs * 10) / 10,
            roundTripTimeMs: roundTripTimeMs === null ? null : Math.round(roundTripTimeMs),
            codec
          }
        });
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
    receiverCounterSamples = [];
  }

  function setReceiveAudio(enabled: boolean): void {
    if (state.receiveAudio === enabled) return;
    writeReceiveAudioPreference(enabled);
    publish({ receiveAudio: enabled });
    if (state.mode !== 'client' || !clientPeer) return;

    multiplayerSourcePlaybackService.setEnabled(enabled);
    if (!enabled) sendClientPlaybackReadyIfPossible(clientPeer);
    if (latestAudioAvailability.sourceFile) {
      multiplayerAudioService.clearRemoteTrack();
      publish({
        audioStatus: enabled
          ? multiplayerSourcePlaybackService.active ? 'playing' : 'connecting'
          : 'refused',
        averageAudioBitrateKbps: null
      });
      return;
    }

    const receiver = clientPeer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') {
      publish({ audioStatus: enabled ? 'unavailable' : 'refused', averageAudioBitrateKbps: null });
      return;
    }
    track.enabled = enabled;
    if (!enabled) {
      multiplayerAudioService.clearRemoteTrack();
      publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
      return;
    }
    if (!latestAudioAvailability.enabled) {
      publish({ audioStatus: 'disabled' });
      return;
    }
    attachClientRemoteAudio(clientPeer);
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
        reconnecting: true,
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
    if (document.visibilityState === 'hidden') return;
    if (state.mode !== 'client' || !allowClientReconnect) return;
    if (clientPeer && isMultiplayerClientTransportHealthy(
      clientPeer.pc.connectionState,
      clientPeer.channel?.readyState
    )) {
      // A long-lived background connection can remain healthy while Media Session keeps
      // mobile playback alive. Elapsed hidden time alone is not a reason to replace it.
      clearReconnectTimer();
      applyClientAudioBuffer(clientPeer);
      if (latestAudioAvailability.sourceFile) multiplayerSourcePlaybackService.resume();
      else if (latestAudioAvailability.enabled) void multiplayerAudioService.resumeRemoteAudio();
      return;
    }
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
    let effectiveNext = next;
    if (state.mode !== 'hosting') {
      latestHostState = next;
      return;
    }

    const nextTrackId = next.track?.id ?? null;
    const shouldGatePlayback = multiplayerSettings.multiplayerWaitForClients
      && next.playback.state === 'playing'
      && nextTrackId !== null
      && (lastPlaybackSource?.state !== 'playing' || lastTrackSource?.id !== nextTrackId)
      && bypassHostPlaybackGateTrackId !== nextTrackId
      && connectedHostPeers().length > 0;

    if (bypassHostPlaybackGateTrackId === nextTrackId && next.playback.state === 'playing') {
      bypassHostPlaybackGateTrackId = null;
    } else if (shouldGatePlayback) {
      pauseHostPlayback();
      effectiveNext = {
        ...next,
        playback: { ...next.playback, state: 'paused' }
      };
    }

    latestHostState = effectiveNext;

    const catalogChanged = !lastCatalogSources
      || lastCatalogSources.playlist !== effectiveNext.playlist
      || lastCatalogSources.library !== effectiveNext.library
      || lastCatalogSources.favorites !== effectiveNext.favorites
      || lastCatalogSources.shuffleEnabled !== effectiveNext.shuffleEnabled
      || lastCatalogSources.repeatMode !== effectiveNext.repeatMode;
    if (catalogChanged) {
      catalogRevision += 1;
      lastCatalogSources = {
        playlist: effectiveNext.playlist,
        library: effectiveNext.library,
        favorites: effectiveNext.favorites,
        shuffleEnabled: effectiveNext.shuffleEnabled,
        repeatMode: effectiveNext.repeatMode
      };
      broadcast({ kind: 'catalog', catalog: buildCatalog(effectiveNext) });
    }

    if (lastPlaybackSource !== effectiveNext.playback || lastTrackSource !== effectiveNext.track) {
      lastPlaybackSource = effectiveNext.playback;
      lastTrackSource = effectiveNext.track;
      broadcast({ kind: 'playback', playback: buildPlayback(effectiveNext) });
    }

    syncHostArtwork(effectiveNext.track);
    syncHostAudio(effectiveNext.track);
    syncHostSourceFiles(effectiveNext.track);
    if (shouldGatePlayback) beginHostPlaybackPreparation(nextTrackId);
  }

  function connectedHostPeers(): PeerConnection[] {
    return Array.from(hostPeers.values()).filter(
      (peer) => peer.channel?.readyState === 'open'
    );
  }

  function beginHostPlaybackPreparation(trackId: string): void {
    const peers = connectedHostPeers();
    if (peers.length === 0) {
      bypassHostPlaybackGateTrackId = trackId;
      resumeHostPlayback();
      return;
    }
    const preparation: MultiplayerPlaybackPreparation = {
      preparationId: crypto.randomUUID(),
      trackId,
      audio: resolvePlaybackPreparationAudio(latestAudioAvailability)
    };
    hostPlaybackPreparation = {
      preparation,
      pendingPeerIds: new Set(peers.map((peer) => peer.id))
    };
    for (const peer of peers) {
      sendToPeer(peer, { kind: 'playback.prepare', preparation });
    }
  }

  function acceptClientPlaybackReady(peer: PeerConnection, preparationId: string): void {
    const pending = hostPlaybackPreparation;
    if (!pending || pending.preparation.preparationId !== preparationId) return;
    pending.pendingPeerIds.delete(peer.id);
    if (pending.pendingPeerIds.size === 0) releasePreparedHostPlayback();
  }

  function removePeerFromHostPlaybackPreparation(peerId: string): void {
    const pending = hostPlaybackPreparation;
    if (!pending || !pending.pendingPeerIds.delete(peerId)) return;
    if (pending.pendingPeerIds.size === 0) releasePreparedHostPlayback();
  }

  function releasePreparedHostPlayback(): void {
    const pending = hostPlaybackPreparation;
    if (!pending) return;
    hostPlaybackPreparation = null;
    if (state.mode !== 'hosting'
      || latestHostState?.track?.id !== pending.preparation.trackId
      || latestHostState.playback.state === 'playing') return;
    bypassHostPlaybackGateTrackId = pending.preparation.trackId;
    resumeHostPlayback();
  }

  function cancelPendingPlayback(): boolean {
    if (!hostPlaybackPreparation) return false;
    hostPlaybackPreparation = null;
    bypassHostPlaybackGateTrackId = null;
    return true;
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
    syncHostSourceFiles(latestHostState.track);
  }

  function sendCurrentState(peer: PeerConnection): void {
    if (!latestHostState) return;
    sendToPeer(peer, { kind: 'catalog', catalog: buildCatalog(latestHostState) });
    sendToPeer(peer, { kind: 'playback', playback: buildPlayback(latestHostState) });
    if (hostArtworkResolvedTrackKey === hostArtworkTrackKey) {
      sendToPeer(peer, { kind: 'artwork', artwork: latestHostArtwork });
    }
    sendToPeer(peer, { kind: 'audio', audio: latestAudioAvailability });
    if (hostPlaybackPreparation) {
      hostPlaybackPreparation.pendingPeerIds.add(peer.id);
      sendToPeer(peer, {
        kind: 'playback.prepare',
        preparation: hostPlaybackPreparation.preparation
      });
    }
  }

  function syncHostAudio(track: PlaylistItem | null): void {
    const sourceFile = shouldTransferMultiplayerSourceFile(
      track,
      multiplayerSettings.multiplayerFileTransferLimitMiB,
      multiplayerSettings.multiplayerStreamAudio
    );
    const enabled = multiplayerSettings.multiplayerStreamAudio && !sourceFile;
    const nextAvailability: MultiplayerAudioAvailability = {
      enabled,
      sourceFile,
      postRaf: sourceFile ? false : multiplayerSettings.multiplayerSendPostRaf,
      reason: multiplayerSettings.multiplayerStreamAudio ? null : 'host-disabled'
    };
    multiplayerAudioService.setHostAudible(enabled);

    if (enabled) {
      const hostTrack = multiplayerAudioService.getHostTrack(multiplayerSettings.multiplayerSendPostRaf);
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
      || nextAvailability.postRaf !== latestAudioAvailability.postRaf
      || nextAvailability.sourceFile !== latestAudioAvailability.sourceFile
      || nextAvailability.reason !== latestAudioAvailability.reason) {
      latestAudioAvailability = nextAvailability;
      broadcast({ kind: 'audio', audio: nextAvailability });
    }
  }

  function syncHostSourceFiles(track: PlaylistItem | null): void {
    for (const peer of hostPeers.values()) syncPeerSourceFile(peer, track);
  }

  function syncPeerSourceFile(peer: PeerConnection, track: PlaylistItem | null): void {
    const channel = peer.mediaChannel;
    const shouldTransfer = shouldTransferMultiplayerSourceFile(
      track,
      multiplayerSettings.multiplayerFileTransferLimitMiB,
      multiplayerSettings.multiplayerStreamAudio
    );
    const key = shouldTransfer && track
      ? `${track.id}:${track.size}:${track.lastModified}`
      : '';
    if (!channel || channel.readyState !== 'open' || peer.sourceTrackKey === key) return;

    peer.mediaTransferToken += 1;
    peer.mediaOutgoing = [];
    peer.mediaQueuedBytes = 0;
    peer.sourceTrackKey = key;
    if (!shouldTransfer || !track?.file) return;
    const token = peer.mediaTransferToken;
    void transferSourceFile(peer, track, track.file, token).catch(() => undefined);
  }

  async function transferSourceFile(
    peer: PeerConnection,
    track: PlaylistItem,
    file: File,
    token: number
  ): Promise<void> {
    const transferId = crypto.randomUUID();
    queuePeerMedia(peer, JSON.stringify({
      kind: 'file.begin',
      transferId,
      trackId: track.id,
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified
    } satisfies SourceFileBeginFrame));

    for (let offset = 0; offset < file.size; offset += SOURCE_FILE_CHUNK_SIZE) {
      if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') return;
      while (peer.mediaQueuedBytes >= SOURCE_FILE_QUEUE_LIMIT) {
        await waitForMediaQueue(peer, token);
        if (peer.mediaTransferToken !== token || peer.mediaChannel?.readyState !== 'open') return;
      }
      const chunk = await file.slice(offset, offset + SOURCE_FILE_CHUNK_SIZE).arrayBuffer();
      if (peer.mediaTransferToken !== token) return;
      queuePeerMedia(peer, chunk);
    }
    if (peer.mediaTransferToken !== token) return;
    queuePeerMedia(peer, JSON.stringify({ kind: 'file.end', transferId } satisfies SourceFileEndFrame));
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
        for (const encoding of parameters.encodings) {
          encoding.maxBitrate = bitrate;
          encoding.priority = 'high';
          encoding.networkPriority = 'high';
        }
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
    hostArtworkResolvedTrackKey = '';
    latestHostArtwork = null;
    const loadToken = ++hostArtworkLoadToken;

    if (!track) {
      hostArtworkResolvedTrackKey = nextTrackKey;
      broadcast({ kind: 'artwork', artwork: null });
      return;
    }

    void loadMultiplayerArtwork(track).then((artwork) => {
      if (loadToken !== hostArtworkLoadToken || hostArtworkTrackKey !== nextTrackKey) return;
      latestHostArtwork = artwork;
      hostArtworkResolvedTrackKey = nextTrackKey;
      broadcast({ kind: 'artwork', artwork });
    }).catch(() => {
      if (loadToken !== hostArtworkLoadToken || hostArtworkTrackKey !== nextTrackKey) return;
      latestHostArtwork = null;
      hostArtworkResolvedTrackKey = nextTrackKey;
      broadcast({ kind: 'artwork', artwork: null });
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

  function queuePeerMedia(peer: PeerConnection, frame: string | ArrayBuffer): void {
    peer.mediaOutgoing.push(frame);
    peer.mediaQueuedBytes += typeof frame === 'string' ? frame.length : frame.byteLength;
    flushPeerMedia(peer);
  }

  function flushPeerMedia(peer: PeerConnection): void {
    const channel = peer.mediaChannel;
    if (peer.mediaFlushing || !channel || channel.readyState !== 'open') return;
    peer.mediaFlushing = true;
    const flush = () => {
      const activeChannel = peer.mediaChannel;
      if (!activeChannel || activeChannel.readyState !== 'open') {
        peer.mediaFlushing = false;
        return;
      }
      while (peer.mediaOutgoing.length > 0 && activeChannel.bufferedAmount < 512_000) {
        const frame = peer.mediaOutgoing.shift()!;
        peer.mediaQueuedBytes = Math.max(
          0,
          peer.mediaQueuedBytes - (typeof frame === 'string' ? frame.length : frame.byteLength)
        );
        if (typeof frame === 'string') activeChannel.send(frame);
        else activeChannel.send(frame);
      }
      peer.mediaFlushing = false;
      if (peer.mediaOutgoing.length > 0 && activeChannel.bufferedAmount < 512_000) {
        flushPeerMedia(peer);
      }
    };
    flush();
  }

  function waitForMediaQueue(peer: PeerConnection, token: number): Promise<void> {
    if (peer.mediaQueuedBytes < SOURCE_FILE_QUEUE_LIMIT || peer.mediaTransferToken !== token) {
      return Promise.resolve();
    }
    return new Promise((resolve) => window.setTimeout(resolve, 10));
  }

  async function kick(clientId: string): Promise<void> {
    if (state.mode !== 'hosting') return;
    const peer = hostPeers.get(clientId);
    if (peer) {
      clearPeerConnectionTimer(peer);
      sendToPeer(peer, { kind: 'kicked' });
      window.setTimeout(() => peer.pc.close(), 80);
      hostPeers.delete(clientId);
      removePeerFromHostPlaybackPreparation(clientId);
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
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostVersion: null,
      clients: [],
      audioStatus: 'idle',
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: null,
      message: null
    });
  }

  async function leave(): Promise<void> {
    if (state.mode !== 'client') return;
    allowClientReconnect = false;
    clearReconnectTimer();
    await resetSession(true);
    await multiplayerSourcePlaybackService.endClientSession();
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostVersion: null,
      clients: [],
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: null,
      remoteArtworkResolvedTrackKey: '',
      audioStatus: 'idle',
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
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
    multiplayerSourcePlaybackService.clearLoadedFile();
    pendingClientSourceFile = null;
    pendingClientPlaybackPreparation = null;
    clientRemoteAudioReady = false;
    hostPlaybackPreparation = null;
    bypassHostPlaybackGateTrackId = null;
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
    hostArtworkResolvedTrackKey = '';
    hostArtworkLoadToken += 1;
    rejectedPeerIds.clear();
    acceptingPeerIds.clear();
    answeredTurnCredentialRequestIds.clear();
    latestAudioAvailability = {
      enabled: false,
      sourceFile: false,
      postRaf: false,
      reason: 'host-disabled'
    };
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
    cancelPendingPlayback,
    resumeAudio: () => multiplayerSourcePlaybackService.resume()
      ? Promise.resolve(true)
      : multiplayerAudioService.resumeRemoteAudio(),
    setReceiveAudio,
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

function createDirectIceSettings(): Parameters<typeof createMultiplayerRtcConfiguration>[0] {
  return {
    multiplayerTurnUrl: '',
    multiplayerTurnUsername: '',
    multiplayerTurnCredential: '',
    multiplayerForceTurn: false
  };
}

function parseSourceFileFrame(value: string): SourceFileBeginFrame | SourceFileEndFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const frame = parsed as Record<string, unknown>;
  if (frame.kind === 'file.end') {
    return typeof frame.transferId === 'string' ? { kind: 'file.end', transferId: frame.transferId } : null;
  }
  if (frame.kind !== 'file.begin'
    || typeof frame.transferId !== 'string'
    || typeof frame.trackId !== 'string'
    || typeof frame.name !== 'string'
    || typeof frame.type !== 'string'
    || typeof frame.size !== 'number'
    || !Number.isSafeInteger(frame.size)
    || frame.size < 0
    || typeof frame.lastModified !== 'number'
    || !Number.isFinite(frame.lastModified)) return null;
  return {
    kind: 'file.begin',
    transferId: frame.transferId,
    trackId: frame.trackId,
    name: frame.name,
    type: frame.type,
    size: frame.size,
    lastModified: frame.lastModified
  };
}

async function requestTemporaryTurnCredentials(
  firebase: FirebaseRuntime,
  inviteCode: string
): Promise<Parameters<typeof createMultiplayerRtcConfiguration>[0]> {
  const pending = await createMultiplayerTurnCredentialRequest();
  const requestRef = firebase.ref(
    firebase.database,
    `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/credentialRequest`
  );
  const responseRef = firebase.ref(
    firebase.database,
    `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/credentialResponse`
  );
  await firebase.set(requestRef, pending.request);

  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe: Unsubscribe | null = null;
    const finish = (
      result: Parameters<typeof createMultiplayerRtcConfiguration>[0] | null,
      error?: unknown
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe?.();
      void firebase.remove(requestRef).catch(() => undefined);
      if (result) resolve(result);
      else reject(error instanceof Error ? error : new Error('TURN credential exchange failed.'));
    };
    const timeout = window.setTimeout(() => {
      finish(null, new Error('The host did not provide temporary TURN credentials in time.'));
    }, TURN_CREDENTIAL_RESPONSE_TIMEOUT_MS);

    unsubscribe = firebase.onValue(responseRef, (snapshot) => {
      const response = snapshot.val() as unknown;
      if (!isMultiplayerTurnCredentialResponse(response)
        || response.requestId !== pending.request.requestId) return;
      void pending.decrypt(response)
        .then((settings) => finish(settings))
        .catch((error) => finish(null, error));
    });
  });
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

function createPeer(
  id: string,
  name: string,
  settings: Parameters<typeof createMultiplayerRtcConfiguration>[0]
): PeerConnection {
  return {
    id,
    name,
    pc: new RTCPeerConnection(createMultiplayerRtcConfiguration(settings)),
    channel: null,
    outgoing: [],
    flushing: false,
    mediaChannel: null,
    mediaOutgoing: [],
    mediaQueuedBytes: 0,
    mediaFlushing: false,
    mediaTransferToken: 0,
    sourceTrackKey: '',
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
  if (local.includes('relay') || remote.includes('relay')) {
    return `${subject} failed after exchanging ${formatCandidateTypes(local)} local and ${formatCandidateTypes(remote)} remote candidates${rejected > 0 ? `; ${rejected} candidate error${rejected === 1 ? '' : 's'} occurred` : ''}. The configured TURN relay did not produce a working route.`;
  }
  return `${subject} failed after exchanging ${formatCandidateTypes(local)} local and ${formatCandidateTypes(remote)} remote candidates${rejected > 0 ? `; ${rejected} candidate error${rejected === 1 ? '' : 's'} occurred` : ''}. A NAT or firewall blocked every direct route, and no relay candidate was available.`;
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
  if (message.kind === 'playback.ready') {
    return typeof message.preparationId === 'string'
      && message.preparationId.length > 0
      && message.preparationId.length <= 80;
  }
  return message.kind === 'command' && isMultiplayerCommand(message.command);
}

function resolvePlaybackPreparationAudio(
  availability: MultiplayerAudioAvailability
): MultiplayerPlaybackPreparationAudio {
  if (availability.sourceFile) return 'file';
  return availability.enabled ? 'stream' : 'none';
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

function readReceiveAudioPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(RECEIVE_AUDIO_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function writeReceiveAudioPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(RECEIVE_AUDIO_STORAGE_KEY, String(enabled));
  } catch {
    // The in-memory choice still applies when storage is unavailable.
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && /permission[_ -]?denied/i.test(error.message)) {
    return 'Multiplayer signaling was rejected by the server. The app and server may be out of sync.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
