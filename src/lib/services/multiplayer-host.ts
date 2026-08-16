import type { TrackItem } from '$lib/types';
import type {
  ClientMessage,
  HostMessage,
  MultiplayerCatalog,
  MultiplayerCommand,
  MultiplayerDeliveryMode,
  MultiplayerDeliveryState,
  MultiplayerPlayback,
  MultiplayerRenderNeed
} from './multiplayer-protocol';
import type {
  CreateMultiplayerSessionOptions,
  MultiplayerClient,
  MultiplayerHostSide,
  MultiplayerHostState,
  MultiplayerSessionCore,
  PeerConnection
} from './multiplayer-types';
import {
  attachHostChannel,
  attachHostMediaChannel,
  attachHostRenderChannel
} from './multiplayer-host-channels';
import {
  beginFreeplayPlaybackPreparation,
  ensureFreeplayDelivery,
  handleFreeplayCommand,
  handleFreeplayTrackEnded,
  handlePeerRenderNeed,
  playheadMsForPeer,
  sendFreeplayCatalog,
  sendFreeplayState,
  syncPeerFreeplayMode,
  syncPeerMediaSource,
  syncPeerRenderSource,
  syncPeerSourceFile
} from './multiplayer-host-freeplay';
import {
  acceptClientClockSample,
  acceptClientPlaybackReady,
  acceptClientRenderReady,
  beginHostPlaybackPreparation,
  cancelPendingPlayback,
  releasePreparedHostPlayback,
  removePeerFromHostPlaybackPreparation,
  sendClockPing,
  updateHostState
} from './multiplayer-host-playback-prep';
import {
  kick,
  startHosting,
  stopHosting,
  togglePairing
} from './multiplayer-host-session';
import {
  broadcastShared,
  buildCatalog,
  buildPlayback,
  primeHostState,
  sendCurrentState,
  syncHostArtwork,
  syncHostAudio,
  syncHostSourceFiles
} from './multiplayer-host-sync';

/**
 * Shared per-session context handed to the host-side sub-modules. The
 * coordinator owns the mutable fields and wires the cross-module handler
 * references; sub-modules never import each other.
 */
export interface MultiplayerHostContext {
  core: MultiplayerSessionCore;
  publish: (patch: Parameters<MultiplayerSessionCore['publish']>[0]) => void;
  updateClient: (id: string, patch: Partial<MultiplayerClient>) => void;
  handleHostCommand: CreateMultiplayerSessionOptions['handleHostCommand'];
  pauseHostPlayback: () => void;
  resumeHostPlayback: () => void;
  attachHostChannel: (peer: PeerConnection, channel: RTCDataChannel) => void;
  attachHostMediaChannel: (peer: PeerConnection, channel: RTCDataChannel) => void;
  attachHostRenderChannel: (peer: PeerConnection, channel: RTCDataChannel) => void;
  syncPeerFreeplayMode: (peer: PeerConnection) => Promise<void>;
  removePeerFromHostPlaybackPreparation: (peerId: string) => void;
  primeHostState: () => void;
  sendFreeplayState: (peer: PeerConnection) => void;
  sendFreeplayCatalog: (peer: PeerConnection) => void;
  handleFreeplayCommand: (peer: PeerConnection, command: MultiplayerCommand) => Promise<boolean>;
  handleFreeplayTrackEnded: (peer: PeerConnection, trackId: string) => Promise<void>;
  syncPeerMediaSource: (peer: PeerConnection) => void;
  handlePeerRenderNeed: (peer: PeerConnection, need: MultiplayerRenderNeed) => void;
  playheadMsForPeer: (peer: PeerConnection) => number;
  acceptClientPlaybackReady: (peer: PeerConnection, generationId: string, verifiedRender?: boolean) => void;
  acceptClientClockSample: (
    peer: PeerConnection,
    message: Extract<ClientMessage, { kind: 'clock.pong' }>
  ) => void;
  acceptClientRenderReady: (
    peer: PeerConnection,
    message: Extract<ClientMessage, { kind: 'render.ready' }>
  ) => void;
  sendCurrentState: (peer: PeerConnection) => void;
  syncHostAudio: (track: TrackItem | null, force?: boolean) => void;
  syncHostSourceFiles: (track: TrackItem | null) => void;
  syncHostArtwork: (track: TrackItem | null) => void;
  buildCatalog: (source: MultiplayerHostState) => MultiplayerCatalog;
  buildPlayback: (source: MultiplayerHostState) => MultiplayerPlayback;
  broadcastShared: (message: HostMessage) => void;
  ensureFreeplayDelivery: (peer: PeerConnection, mode: MultiplayerDeliveryMode) => MultiplayerDeliveryState;
  syncPeerRenderSource: (
    peer: PeerConnection,
    track: TrackItem | null,
    generationId: string | null
  ) => void;
  syncPeerSourceFile: (
    peer: PeerConnection,
    track: TrackItem | null,
    generationId: string | null
  ) => void;
  sendClockPing: (peer: PeerConnection, generationId: string) => void;
}

export function createMultiplayerHostSide(
  core: MultiplayerSessionCore,
  options: Pick<
    CreateMultiplayerSessionOptions,
    'handleHostCommand' | 'pauseHostPlayback' | 'resumeHostPlayback'
  >
): MultiplayerHostSide {
  const { handleHostCommand, pauseHostPlayback, resumeHostPlayback } = options;

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  function updateClient(id: string, patch: Partial<MultiplayerClient>): void {
    core.updateClient(id, patch);
  }

  const ctx: MultiplayerHostContext = {
    core,
    publish,
    updateClient,
    handleHostCommand,
    pauseHostPlayback,
    resumeHostPlayback,
    attachHostChannel: (peer, channel): void => attachHostChannel(ctx, peer, channel),
    attachHostMediaChannel: (peer, channel): void => attachHostMediaChannel(ctx, peer, channel),
    attachHostRenderChannel: (peer, channel): void => attachHostRenderChannel(ctx, peer, channel),
    syncPeerFreeplayMode: (peer): Promise<void> => syncPeerFreeplayMode(ctx, peer),
    removePeerFromHostPlaybackPreparation: (peerId): void => removePeerFromHostPlaybackPreparation(ctx, peerId),
    primeHostState: (): void => primeHostState(ctx),
    sendFreeplayState: (peer): void => sendFreeplayState(ctx, peer),
    sendFreeplayCatalog: (peer): void => sendFreeplayCatalog(ctx, peer),
    handleFreeplayCommand: (peer, command): Promise<boolean> => handleFreeplayCommand(ctx, peer, command),
    handleFreeplayTrackEnded: (peer, trackId): Promise<void> => handleFreeplayTrackEnded(ctx, peer, trackId),
    syncPeerMediaSource: (peer): void => syncPeerMediaSource(ctx, peer),
    handlePeerRenderNeed: (peer, need): void => handlePeerRenderNeed(ctx, peer, need),
    playheadMsForPeer: (peer): number => playheadMsForPeer(ctx, peer),
    acceptClientPlaybackReady: (peer, generationId, verifiedRender = false): void =>
      acceptClientPlaybackReady(ctx, peer, generationId, verifiedRender),
    acceptClientClockSample: (peer, message): void => acceptClientClockSample(ctx, peer, message),
    acceptClientRenderReady: (peer, message): void => acceptClientRenderReady(ctx, peer, message),
    sendCurrentState: (peer): void => sendCurrentState(ctx, peer),
    syncHostAudio: (track, force = false): void => syncHostAudio(ctx, track, force),
    syncHostSourceFiles: (track): void => syncHostSourceFiles(ctx, track),
    syncHostArtwork: (track): void => syncHostArtwork(ctx, track),
    buildCatalog: (source): MultiplayerCatalog => buildCatalog(ctx, source),
    buildPlayback: (source): MultiplayerPlayback => buildPlayback(ctx, source),
    broadcastShared: (message): void => broadcastShared(ctx, message),
    ensureFreeplayDelivery: (peer, mode): MultiplayerDeliveryState => ensureFreeplayDelivery(ctx, peer, mode),
    syncPeerRenderSource: (peer, track, generationId): void =>
      syncPeerRenderSource(ctx, peer, track, generationId),
    syncPeerSourceFile: (peer, track, generationId): void =>
      syncPeerSourceFile(ctx, peer, track, generationId),
    sendClockPing: (peer, generationId): void => sendClockPing(ctx, peer, generationId)
  };

  return {
    startHosting: (options) => startHosting(ctx, options),
    stopHosting: () => stopHosting(ctx),
    kick: (clientId) => kick(ctx, clientId),
    togglePairing: (clientId) => togglePairing(ctx, clientId),
    updateHostState: (next) => updateHostState(ctx, next),
    cancelPendingPlayback: () => cancelPendingPlayback(ctx),
    syncHostAudio: (track, force) => syncHostAudio(ctx, track, force),
    syncHostSourceFiles: (track) => syncHostSourceFiles(ctx, track),
    syncPeerFreeplayMode: (peer) => syncPeerFreeplayMode(ctx, peer),
    beginFreeplayPlaybackPreparation: (peer) => beginFreeplayPlaybackPreparation(ctx, peer),
    releasePreparedHostPlayback: (force) => releasePreparedHostPlayback(ctx, force),
    beginHostPlaybackPreparation: (trackId) => beginHostPlaybackPreparation(ctx, trackId)
  };
}
