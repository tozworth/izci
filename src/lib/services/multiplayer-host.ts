import type { TrackItem } from '$lib/types';
import type {
  CreateMultiplayerSessionOptions,
  MultiplayerHostState,
  MultiplayerSessionCore,
  PeerConnection
} from './multiplayer-types';
import {
  beginFreeplayPlaybackPreparation,
  syncPeerFreeplayMode
} from './multiplayer-host-freeplay';
import {
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
  sendCurrentState,
  syncHostAudio,
  syncHostSourceFiles
} from './multiplayer-host-sync';

/**
 * Shared per-session context handed to the host-side sub-modules. The
 * coordinator owns the mutable fields and the few reverse-edge callbacks
 * needed to keep sibling runtime imports acyclic.
 */
export interface MultiplayerHostContext {
  core: MultiplayerSessionCore;
  handleHostCommand: CreateMultiplayerSessionOptions['handleHostCommand'];
  pauseHostPlayback: () => void;
  resumeHostPlayback: () => void;
  removePeerFromHostPlaybackPreparation: (peerId: string) => void;
  sendCurrentState: (peer: PeerConnection) => void;
  syncHostAudio: (track: TrackItem | null, force?: boolean) => void;
  syncHostSourceFiles: () => void;
  sendClockPing: (peer: PeerConnection, generationId: string) => void;
}

export function createMultiplayerHostSide(
  core: MultiplayerSessionCore,
  options: Pick<
    CreateMultiplayerSessionOptions,
    'handleHostCommand' | 'pauseHostPlayback' | 'resumeHostPlayback'
  >
) {
  const { handleHostCommand, pauseHostPlayback, resumeHostPlayback } = options;

  const ctx: MultiplayerHostContext = {
    core,
    handleHostCommand,
    pauseHostPlayback,
    resumeHostPlayback,
    removePeerFromHostPlaybackPreparation: (peerId): void => removePeerFromHostPlaybackPreparation(ctx, peerId),
    sendCurrentState: (peer): void => sendCurrentState(ctx, peer),
    syncHostAudio: (track, force = false): void => syncHostAudio(ctx, track, force),
    syncHostSourceFiles: (): void => syncHostSourceFiles(ctx),
    sendClockPing
  };

  return {
    startHosting: (options?: { silent?: boolean }) => startHosting(ctx, options),
    stopHosting: () => stopHosting(ctx),
    kick: (clientId: string) => kick(ctx, clientId),
    togglePairing: (clientId: string) => togglePairing(ctx, clientId),
    updateHostState: (next: MultiplayerHostState) => updateHostState(ctx, next),
    cancelPendingPlayback: () => cancelPendingPlayback(ctx),
    syncHostAudio: (track: TrackItem | null, force?: boolean) => syncHostAudio(ctx, track, force),
    syncHostSourceFiles: () => syncHostSourceFiles(ctx),
    syncPeerFreeplayMode: (peer: PeerConnection) => syncPeerFreeplayMode(ctx, peer),
    beginFreeplayPlaybackPreparation,
    releasePreparedHostPlayback: (force?: boolean) => releasePreparedHostPlayback(ctx, force),
    beginHostPlaybackPreparation: (trackId: string) => beginHostPlaybackPreparation(ctx, trackId)
  };
}
