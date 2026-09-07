import type { Readable } from 'svelte/store';
import type {
  Database,
  DatabaseReference,
  OnDisconnect,
  Unsubscribe
} from 'firebase/database';
import type {
  MultiplayerSettings,
  PlaybackSnapshot,
  TrackItem,
  RepeatMode
} from '$lib/types';
import {
  createMultiplayerMessageDecoder,
  type ClientMessage,
  type MultiplayerArtwork,
  type MultiplayerCatalog,
  type MultiplayerCollection,
  type MultiplayerChatAction,
  type MultiplayerChatTrackLink,
  type MultiplayerCommand,
  type MultiplayerCommandInput,
  type MultiplayerDeliveryState,
  type MultiplayerPlayback,
  type MultiplayerPlaybackPreparation
} from './multiplayer-protocol';
import type { MultiplayerReceiverAudioStatus } from './multiplayer-audio';
import type { MultiplayerConnectionRoute } from './multiplayer-ice';
import type { FreeplayStepResolver, MultiplayerFreeplayPlayer } from './multiplayer-freeplay';
import type {
  MultiplayerTurnCredentialRequest,
  MultiplayerTurnCredentialResponse
} from './multiplayer-turn-credentials';

export type MultiplayerMode = 'idle' | 'hosting' | 'client';
export type MultiplayerConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type MultiplayerAudioStatus = MultiplayerReceiverAudioStatus | 'disabled' | 'refused';

export interface MultiplayerConnectionStats {
  packetsReceived: number;
  packetsLost: number;
  packetLossPercent: number | null;
  /** Total bytes received over the transport (audio RTP plus data-channel transfers). */
  bytesReceived: number;
  jitterMs: number | null;
  jitterBufferDelayMs: number | null;
  jitterBufferTargetDelayMs: number | null;
  concealedSamples: number | null;
  concealmentEvents: number | null;
  insertedSamplesForDeceleration: number | null;
  removedSamplesForAcceleration: number | null;
  roundTripTimeMs: number | null;
  codec: string | null;
}

export interface MultiplayerClient {
  id: string;
  name: string;
  platform: string;
  status: 'connecting' | 'connected' | 'disconnected';
  paired: boolean;
  freeplayPaired: boolean;
  freeplay: boolean;
  freeplayTrack: TrackItem | null;
  freeplayPlaybackState: PlaybackSnapshot['state'];
  freeplayArtworkUrl: string | null;
}

/** Per-peer buffered Opus delivery state (host side). */
interface MultiplayerPeerRenderState {
  generationId: string;
  renderId: string;
  /** Render cache key; used to pin/unpin the shared entry. */
  key: string;
  render: import('./multiplayer-render-cache').CachedRender;
  epoch: number;
  targetTimeMs: number;
  aheadMs: number;
  protectionMs: number;
  receivedRanges: Array<[number, number]>;
  /** Cluster indices already enqueued for this peer in the current epoch. */
  sent: Set<number>;
  initSent: boolean;
}

export interface MultiplayerSessionState {
  mode: MultiplayerMode;
  connectionStatus: MultiplayerConnectionStatus;
  reconnecting: boolean;
  inviteCode: string | null;
  hostName: string | null;
  hostMotd: string;
  hostVersion: string | null;
  freeplayPaired: boolean;
  freeplay: boolean;
  freeplayQueue: string[];
  clients: MultiplayerClient[];
  remoteCatalog: MultiplayerCatalog;
  remotePlayback: MultiplayerPlayback;
  remoteArtwork: MultiplayerArtwork | null;
  remoteArtworkResolvedTrackKey: string;
  audioStatus: MultiplayerAudioStatus;
  remoteDelivery: MultiplayerDeliveryState;
  connectionRoute: MultiplayerConnectionRoute | null;
  averageAudioBitrateKbps: number | null;
  receiveAudio: boolean;
  connectionStats: MultiplayerConnectionStats | null;
  connectionDetail: string | null;
  message: string | null;
}

export interface MultiplayerHostState {
  queue: TrackItem[];
  library: TrackItem[];
  favorites: TrackItem[];
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  playback: PlaybackSnapshot;
  track: TrackItem | null;
}

export const EMPTY_PLAYBACK: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  backend: null
};

export const EMPTY_CATALOG: MultiplayerCatalog = {
  revision: 0,
  queue: [],
  library: [],
  favorites: [],
  shuffleEnabled: false,
  repeatMode: 'off'
};

export const EMPTY_REMOTE_PLAYBACK: MultiplayerPlayback = {
  generationId: 'idle',
  snapshot: EMPTY_PLAYBACK,
  track: null,
  sentAt: 0
};

export const EMPTY_DELIVERY: MultiplayerDeliveryState = {
  generationId: 'idle',
  trackId: null,
  mode: 'none',
  reason: 'host-disabled'
};

export interface FirebaseRuntime {
  database: Database;
  uid: string;
  ref: typeof import('firebase/database')['ref'];
  set: typeof import('firebase/database')['set'];
  get: typeof import('firebase/database')['get'];
  remove: typeof import('firebase/database')['remove'];
  onValue: typeof import('firebase/database')['onValue'];
  onDisconnect: typeof import('firebase/database')['onDisconnect'];
}

export interface SignalOffer {
  name: string;
  platform: string;
  description: RTCSessionDescriptionInit;
  createdAt: number;
}

export interface SignalAnswer {
  description?: RTCSessionDescriptionInit;
  error?: 'host-full';
  createdAt: number;
}

export interface SignalPeerRecord {
  credentialRequest?: MultiplayerTurnCredentialRequest;
  credentialResponse?: MultiplayerTurnCredentialResponse;
  client?: SignalOffer;
  clientCandidates?: SignalCandidates;
  host?: SignalAnswer;
  hostCandidates?: SignalCandidates;
}

export interface SignalCandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

export type SignalCandidates = Record<string, SignalCandidate>;

export interface PairedClientRecord {
  name: string;
  platform: string;
  pairedAt: number;
  freeplay: boolean;
}

export interface SourceFileBeginFrame {
  kind: 'file.begin';
  transferId: string;
  trackId: string;
  generationId: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

export interface SourceFileEndFrame {
  kind: 'file.end';
  transferId: string;
}

export interface PeerConnection {
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
  renderChannel: RTCDataChannel | null;
  renderOutgoing: ArrayBuffer[];
  renderQueuedBytes: number;
  renderFlushing: boolean;
  renderState: MultiplayerPeerRenderState | null;
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
  signalingCreatedAt: number;
  paired: boolean;
  freeplayPaired: boolean;
  clientFreeplayEnabled: boolean;
  helloReceived: boolean;
  chatLeaveAnnounced: boolean;
  freeplaySettled: boolean;
  mediaSyncPending: boolean;
  freeplay: boolean;
  freeplayPlayer: MultiplayerFreeplayPlayer | null;
  freeplayCollection: MultiplayerCollection;
  freeplayShuffle: boolean;
  freeplayRepeatMode: RepeatMode;
  freeplayNavigation: FreeplayStepResolver | null;
  freeplayQueue: string[];
  freeplayUpNext: Array<{ collection: MultiplayerCollection; itemId: string }>;
  freeplayActivation: { autoPlay: boolean } | null;
  freeplayModeToken: number;
  freeplayPendingPreparation: MultiplayerPlaybackPreparation | null;
  freeplayArtwork: MultiplayerArtwork | null;
  freeplayArtworkTrackKey: string;
  freeplayArtworkResolvedTrackKey: string;
  freeplayArtworkLoadToken: number;
  freeplayDelivery: MultiplayerDeliveryState | null;
}

export interface CreateMultiplayerSessionOptions {
  handleHostCommand: (
    command: MultiplayerCommand,
    client: Pick<MultiplayerClient, 'id' | 'name'>
  ) => boolean | Promise<boolean>;
  pauseHostPlayback: () => void;
  resumeHostPlayback: () => void;
}

export type MultiplayerChatMessageHandler = (
  text: string,
  client: Pick<MultiplayerClient, 'id' | 'name'>,
  track?: MultiplayerChatTrackLink
) => void;

export type MultiplayerChatPresenceHandler = (
  name: string,
  action: Extract<MultiplayerChatAction, 'join' | 'leave'>
) => void;

export interface MultiplayerSessionController extends Readable<MultiplayerSessionState> {
  getSnapshot(): MultiplayerSessionState;
  startHosting(options?: { silent?: boolean }): Promise<string>;
  stopHosting(): Promise<void>;
  join(inviteCode: string): Promise<void>;
  joinPaired(hostId: string): Promise<void>;
  restoreLastSession(): Promise<MultiplayerMode | null>;
  leave(): Promise<void>;
  kick(clientId: string): Promise<void>;
  togglePairing(clientId: string): Promise<void>;
  sendCommand(command: MultiplayerCommandInput): boolean;
  sendChatMessage(text: string): boolean;
  sendChatNowPlaying(track: MultiplayerChatTrackLink): boolean;
  sendChatTrack(track: MultiplayerChatTrackLink): boolean;
  setFreeplayQueue(itemIds: string[]): void;
  cancelPendingPlayback(): boolean;
  resumeAudio(): Promise<boolean>;
  setReceiveAudio(enabled: boolean): void;
  updateHostState(next: MultiplayerHostState): void;
  destroy(): void;
}

/**
 * Mutable session state shared between the host-side and client-side factories.
 * `publish` replaces `state`, so callers must read `core.state` at call time.
 */
export interface MultiplayerSessionCore {
  state: MultiplayerSessionState;
  publish(patch: Partial<MultiplayerSessionState>): void;
  updateClient(id: string, patch: Partial<MultiplayerClient>): void;
  multiplayerSettings: MultiplayerSettings;
  firebaseRuntime: FirebaseRuntime | null;
  roomRef: DatabaseReference | null;
  hostDirectoryRef: DatabaseReference | null;
  ownPeerRef: DatabaseReference | null;
  roomCode: string | null;
  clientHostId: string | null;
  roomDisconnect: OnDisconnect | null;
  hostDirectoryDisconnect: OnDisconnect | null;
  peerDisconnect: OnDisconnect | null;
  stopPeersListener: Unsubscribe | null;
  stopAnswerListener: Unsubscribe | null;
  hostPeers: Map<string, PeerConnection>;
  freeplaySelections: Map<string, TrackItem>;
  clientPeer: PeerConnection | null;
  pendingClientSourceFile: { trackId: string; generationId: string; file: File } | null;
  hostAudioBufferMs: number | null;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  reconnectInFlight: boolean;
  allowClientReconnect: boolean;
  latestHostState: MultiplayerHostState | null;
  catalogRevision: number;
  lastCatalogSources: Pick<
    MultiplayerHostState,
    'queue' | 'library' | 'favorites' | 'shuffleEnabled' | 'repeatMode'
  > | null;
  lastPlaybackSource: PlaybackSnapshot | null;
  lastTrackSource: TrackItem | null;
  latestHostArtwork: MultiplayerArtwork | null;
  hostArtworkTrackKey: string;
  hostArtworkResolvedTrackKey: string;
  hostArtworkLoadToken: number;
  latestDelivery: MultiplayerDeliveryState;
  /** Track ids whose buffered Opus render failed; they use source-file delivery. */
  renderFallbackTrackIds: Set<string>;
  hostPlaybackPreparation: {
    preparation: MultiplayerPlaybackPreparation;
    pendingPeerIds: Set<string>;
    peerIds: Set<string>;
    clockOffsets: Map<string, number>;
    releaseTimer: number | null;
  } | null;
  bypassHostPlaybackGateTrackId: string | null;
  rejectedPeerIds: Set<string>;
  acceptingPeerIds: Set<string>;
  answeredTurnCredentialRequestIds: Set<string>;
  resetSession(removeRemote: boolean): Promise<void>;
}
