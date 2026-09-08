import { MultiplayerClientTransition } from './multiplayer-client-transition';
import type { MultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { createReceiverBitrateMonitor } from './multiplayer-receiver-monitor';
import { sendToPeer } from './multiplayer-peer';
import {
  join,
  joinPaired,
  restoreClientJoin,
  connectClient,
  resolveDirectoryRoomCode
} from './multiplayer-client-connect';
import {
  sendRenderReadyMessages,
  applyClientAudioBuffer,
  setReceiveAudio,
  cancelSynchronizedStart
} from './multiplayer-client-audio';
import {
  setFreeplayQueue
} from './multiplayer-client-freeplay';
import {
  scheduleClientReconnect,
  clearReconnectTimer,
  handleClientResume,
  leave,
  resumeAudio
} from './multiplayer-client-lifecycle';
import {
  type MultiplayerCommand,
  type MultiplayerCommandInput
} from './multiplayer-protocol';
import {
  type MultiplayerSessionCore,
  type PeerConnection
} from './multiplayer-types';

/**
 * Shared per-session context handed to the client-side sub-modules. The
 * coordinator owns mutable session state and the few reverse-edge callbacks
 * needed to keep sibling runtime imports acyclic.
 */
export interface MultiplayerClientContext {
  core: MultiplayerSessionCore;
  transition: MultiplayerClientTransition;
  receiverMonitor: ReturnType<typeof createReceiverBitrateMonitor>;
  sourceRetryGenerationId: string | null;
  sourceRetryCount: number;
  pendingFreeplayResumeTrackId: string | null;
  synchronizedStartTimer: number | null;
  synchronizedStartGenerationId: string | null;
  synchronizedStartAt: number;
  renderReadySentGeneration: string | null;
  renderReadySentEpoch: number;
  connectClient: (rawInviteCode: string, reconnecting: boolean, silent?: boolean) => Promise<void>;
  resolveDirectoryRoomCode: (hostId: string) => Promise<string | null>;
  sendCommand: (command: MultiplayerCommandInput) => boolean;
}

export function createMultiplayerClientSide(core: MultiplayerSessionCore) {
  const transition = new MultiplayerClientTransition();
  transition.setReceiveAudio(core.state.receiveAudio);

  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });

  const ctx: MultiplayerClientContext = {
    core,
    transition,
    receiverMonitor,
    sourceRetryGenerationId: null,
    sourceRetryCount: 0,
    pendingFreeplayResumeTrackId: null,
    synchronizedStartTimer: null,
    synchronizedStartGenerationId: null,
    synchronizedStartAt: 0,
    renderReadySentGeneration: null,
    renderReadySentEpoch: -1,
    connectClient: (rawInviteCode, reconnecting, silent = false): Promise<void> =>
      connectClient(ctx, rawInviteCode, reconnecting, silent),
    resolveDirectoryRoomCode: (hostId): Promise<string | null> => resolveDirectoryRoomCode(ctx, hostId),
    sendCommand: (command): boolean => sendCommand(command)
  };

  multiplayerRenderPlaybackService.setCallbacks({
    onReady: (epoch, positionMs) => {
      if (core.state.mode !== 'client' || !core.clientPeer) return;
      if (core.latestDelivery.mode !== 'render') return;
      sendRenderReadyMessages(ctx, core.clientPeer, epoch, positionMs);
    },
    onNeed: (need) => {
      if (core.state.mode !== 'client' || !core.clientPeer) return;
      if (core.latestDelivery.mode !== 'render') return;
      const state = multiplayerRenderPlaybackService.getState();
      if (!state.generationId || !state.renderId) return;
      sendToPeer(core.clientPeer, {
        kind: 'render.need',
        need: {
          generationId: state.generationId,
          renderId: state.renderId,
          epoch: need.epoch,
          targetTimeMs: need.targetTimeMs,
          aheadMs: need.aheadMs,
          ranges: need.ranges
        }
      });
    }
  });

  function sendCommand(command: MultiplayerCommandInput): boolean {
    if (core.state.mode !== 'client' || core.state.connectionStatus !== 'connected' || !core.clientPeer) return false;
    const completeCommand = {
      ...command,
      commandId: crypto.randomUUID()
    } as MultiplayerCommand;
    if (core.state.receiveAudio) void resumeAudio(ctx);
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    return true;
  }

  return {
    ctx,
    join: (inviteCode: string, options?: { silent?: boolean }) => join(ctx, inviteCode, options),
    joinPaired: (hostId: string) => joinPaired(ctx, hostId),
    restoreClientJoin: (last: MultiplayerLastSession) => restoreClientJoin(ctx, last),
    leave: () => leave(ctx),
    sendCommand: (command: MultiplayerCommandInput) => sendCommand(command),
    setFreeplayQueue: (itemIds: string[]) => setFreeplayQueue(ctx, itemIds),
    setReceiveAudio: (enabled: boolean) => setReceiveAudio(ctx, enabled),
    resumeAudio: () => resumeAudio(ctx),
    applyClientAudioBuffer: (peer: PeerConnection) => applyClientAudioBuffer(ctx, peer),
    handleClientResume: () => handleClientResume(ctx),
    clearReceiverMonitor: () => receiverMonitor.clear(),
    clearReconnectTimer: () => clearReconnectTimer(ctx),
    resetTransitions: () => {
      cancelSynchronizedStart(ctx);
      transition.reset();
      transition.setReceiveAudio(core.state.receiveAudio);
      ctx.sourceRetryGenerationId = null;
      ctx.sourceRetryCount = 0;
      ctx.pendingFreeplayResumeTrackId = null;
      ctx.renderReadySentGeneration = null;
      ctx.renderReadySentEpoch = -1;
    }
  };
}
