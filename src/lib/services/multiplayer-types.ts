import type { Readable } from 'svelte/store';
import type {
  Database,
  DatabaseReference,
  OnDisconnect,
  Unsubscribe
} from 'firebase/database';
import type {
  ExperimentalSettings,
  PlaybackSnapshot,
  PlaylistItem,
  PlaylistRepeatMode
} from '$lib/types';
import {
  createMultiplayerMessageDecoder,
  type ClientMessage,
  type MultiplayerArtwork,
  type MultiplayerAudioAvailability,
  type MultiplayerCatalog,
  type MultiplayerCollection,
  type MultiplayerCommand,
  type MultiplayerCommandInput,
  type MultiplayerPlayback,
  type MultiplayerPlaybackPreparation
} from './multiplayer-protocol';
import type { MultiplayerReceiverAudioStatus } from './multiplayer-audio';
import type { MultiplayerConnectionRoute } from './multiplayer-ice';
import type { MultiplayerFreeplayPlayer, FreeplayStepResolver } from './multiplayer-freeplay';
import type { MultiplayerTurnCredentialRequest, MultiplayerTurnCredentialResponse } from './multiplayer-turn-credentials';
import type { MultiplayerLastSession } from '$lib/stores/multiplayer-last-session';

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
  freeplayPaired: boolean;
  freeplay: boolean;
}

export interface MultiplayerSessionState {
  mode: MultiplayerMode;
  connectionStatus: MultiplayerConnectionStatus;
  reconnecting: boolean;
  inviteCode: string | null;
  hostName: string | null;
  hostVersion: string | null;
  freeplayPaired: boolean;
  freeplay: boolean;
  /**
   * The Freeplay client's own ordered queue of catalog item IDs. The client
   * curates it; the host resolves it into `remoteCatalog.playlist` and steps
   * within it. Empty when Freeplay is inactive.
   */
  freeplayQueue: string[];
  clients: MultiplayerClient[];
  remoteCatalog: MultiplayerCatalog;
  remotePlayback: MultiplayerPlayback;
  remoteArtwork: MultiplayerArtwork | null;
  remoteArtworkResolvedTrackKey: string;
  audioStatus: MultiplayerAudioStatus;
  remoteSourceFile: boolean;
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
  playlist: [],
  library: [],
  favorites: [],
  shuffleEnabled: false,
  repeatMode: 'off'
};

export const EMPTY_REMOTE_PLAYBACK: MultiplayerPlayback = {
  snapshot: EMPTY_PLAYBACK,
  track: null,
  sentAt: 0
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
  createdAt?: number;
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
  paired: boolean;
  freeplayPaired: boolean;
  clientFreeplayEnabled: boolean;
  /**
   * True once the client's hello has been processed. Connect-time pushes
   * (pairing, current state, media source sync) must wait for it: the hello
   * carries `freeplayEnabled`, and pushing shared-mode state before it is
   * processed leaks the host playlist/playback to a Freeplay-bound peer.
   */
  helloReceived: boolean;
  /**
   * True once `syncPeerFreeplayMode` has finished assigning `peer.freeplay`
   * for this connection. `helloReceived` alone is not enough: the mode sync is
   * async (pairing-record write, wire attach), and shared-mode pushes between
   * the hello and the settled flag would still leak the host track/playlist to
   * a Freeplay-bound peer.
   */
  freeplaySettled: boolean;
  /**
   * Media-channel open raced the hello: the initial source-file sync is
   * deferred until freeplay status is known.
   */
  mediaSyncPending: boolean;
  freeplay: boolean;
  freeplayPlayer: MultiplayerFreeplayPlayer | null;
  freeplayCollection: MultiplayerCollection;
  freeplayShuffle: boolean;
  freeplayRepeatMode: PlaylistRepeatMode;
  /**
   * Per-peer Freeplay stepping context (shuffle history + upcoming cycle).
   * Created when Freeplay activates, reset on shuffle toggles, queue/collection
   * replacement, and Freeplay exit. Host-side only.
   */
  freeplayNavigation: FreeplayStepResolver | null;
  /**
   * The Freeplay client's owned queue (ordered catalog item IDs). Resolved into
   * the per-peer catalog's `playlist` field and used as the stepping context
   * when `freeplayCollection` is 'playlist'.
   */
  freeplayQueue: string[];
  freeplayPendingPreparation: MultiplayerPlaybackPreparation | null;
  freeplayArtwork: MultiplayerArtwork | null;
  freeplayArtworkTrackKey: string;
  freeplayArtworkResolvedTrackKey: string;
  freeplayArtworkLoadToken: number;
  freeplayAudioSent: MultiplayerAudioAvailability | null;
}

export interface CreateMultiplayerSessionOptions {
  handleHostCommand: (
    command: MultiplayerCommand,
    client: Pick<MultiplayerClient, 'id' | 'name'>
  ) => boolean | Promise<boolean>;
  pauseHostPlayback: () => void;
  resumeHostPlayback: () => void;
}

export interface MultiplayerSessionController extends Readable<MultiplayerSessionState> {
  getSnapshot(): MultiplayerSessionState;
  startHosting(options?: { silent?: boolean }): Promise<string>;
  stopHosting(): Promise<void>;
  join(inviteCode: string): Promise<void>;
  joinPaired(hostId: string): Promise<void>;
  /**
   * Restores the persisted last multiplayer session (see the "Restore last
   * session" option): hosting is resumed silently, a client session re-joins
   * the remembered host without a dialog and hands off to the reconnect loop.
   * Returns the mode that was restored, or 'idle' when there was nothing to
   * restore (or the restore attempt could not start).
   */
  restoreLastSession(): Promise<MultiplayerMode | null>;
  leave(): Promise<void>;
  kick(clientId: string): Promise<void>;
  togglePairing(clientId: string): Promise<void>;
  sendCommand(command: MultiplayerCommandInput): boolean;
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
  multiplayerSettings: ExperimentalSettings;
  firebaseRuntime: FirebaseRuntime | null;
  roomRef: DatabaseReference | null;
  hostDirectoryRef: DatabaseReference | null;
  ownPeerRef: DatabaseReference | null;
  /**
   * The hosting room's invite code. `state.inviteCode` may be null for a
   * silent (auto-host) session, but the room itself always has a code — this
   * is what paired clients resolve from the host directory.
   */
  roomCode: string | null;
  /**
   * The host uid this client joined (learned from pairing). When set, client
   * reconnects re-resolve the host directory for the current room, so a host
   * that restarted with a new room can still be rejoined without a code.
   */
  clientHostId: string | null;
  roomDisconnect: OnDisconnect | null;
  hostDirectoryDisconnect: OnDisconnect | null;
  peerDisconnect: OnDisconnect | null;
  stopPeersListener: Unsubscribe | null;
  stopAnswerListener: Unsubscribe | null;
  hostPeers: Map<string, PeerConnection>;
  /**
   * Materialized Freeplay selection per client id, kept across peer reconnects so
   * the host can re-serve the current file after a transport drop. Cleared on
   * explicit Freeplay deactivation and on full session reset.
   */
  freeplaySelections: Map<string, PlaylistItem>;
  clientPeer: PeerConnection | null;
  pendingClientSourceFile: { trackId: string; file: File } | null;
  pendingClientPlaybackPreparation: MultiplayerPlaybackPreparation | null;
  clientRemoteAudioReady: boolean;
  /**
   * The host's listener-buffer target (ms) as delivered by the `buffer`
   * message. Non-null while connected to a host that has told us its buffer;
   * it is authoritative over the local `multiplayerAudioBufferMs` (the host's
   * slider controls the session live). Cleared on reset so a fresh join
   * starts from the local preference until the host's value arrives.
   */
  hostAudioBufferMs: number | null;
  reconnectTimer: number | null;
  reconnectAttempts: number;
  reconnectInFlight: boolean;
  allowClientReconnect: boolean;
  latestHostState: MultiplayerHostState | null;
  catalogRevision: number;
  lastCatalogSources: Pick<
    MultiplayerHostState,
    'playlist' | 'library' | 'favorites' | 'shuffleEnabled' | 'repeatMode'
  > | null;
  lastPlaybackSource: PlaybackSnapshot | null;
  lastTrackSource: PlaylistItem | null;
  latestHostArtwork: MultiplayerArtwork | null;
  hostArtworkTrackKey: string;
  hostArtworkResolvedTrackKey: string;
  hostArtworkLoadToken: number;
  latestAudioAvailability: MultiplayerAudioAvailability;
  hostPlaybackPreparation: {
    preparation: MultiplayerPlaybackPreparation;
    pendingPeerIds: Set<string>;
  } | null;
  bypassHostPlaybackGateTrackId: string | null;
  rejectedPeerIds: Set<string>;
  acceptingPeerIds: Set<string>;
  answeredTurnCredentialRequestIds: Set<string>;
  resetSession(removeRemote: boolean): Promise<void>;
}

export interface MultiplayerHostSide {
  startHosting(options?: { silent?: boolean }): Promise<string>;
  stopHosting(): Promise<void>;
  kick(clientId: string): Promise<void>;
  togglePairing(clientId: string): Promise<void>;
  updateHostState(next: MultiplayerHostState): void;
  cancelPendingPlayback(): boolean;
  syncHostAudio(track: PlaylistItem | null): void;
  syncHostSourceFiles(track: PlaylistItem | null): void;
  syncPeerFreeplayMode(peer: PeerConnection): Promise<void>;
  beginFreeplayPlaybackPreparation(peer: PeerConnection): void;
  releasePreparedHostPlayback(): void;
  beginHostPlaybackPreparation(trackId: string): void;
}

export interface MultiplayerClientSide {
  join(inviteCode: string, options?: { silent?: boolean }): Promise<void>;
  joinPaired(hostId: string): Promise<void>;
  /**
   * Restores a remembered client session: resolves the host's current room
   * (directory lookup when the host id is known, otherwise the remembered
   * invite code) and joins silently, letting the reconnect loop own retries.
   */
  restoreClientJoin(last: MultiplayerLastSession): Promise<void>;
  leave(): Promise<void>;
  sendCommand(command: MultiplayerCommandInput): boolean;
  setFreeplayQueue(itemIds: string[]): void;
  setReceiveAudio(enabled: boolean): void;
  resumeAudio(): Promise<boolean>;
  applyClientAudioBuffer(peer: PeerConnection): void;
  handleClientResume(): void;
  clearReceiverMonitor(): void;
  resetStreamedAudioState(): void;
  clearReconnectTimer(): void;
}
