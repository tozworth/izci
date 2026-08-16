import { MultiplayerClientTransition } from './multiplayer-client-transition';
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
import { attachClientChannel } from './multiplayer-client-channels';
import {
  attachClientRemoteAudio,
  attachClientMediaChannel,
  attachClientRenderChannel,
  loadPendingClientSourceFile,
  sendRenderReadyMessages,
  sendClientPlaybackReadyIfPossible,
  requestSourceRetry,
  updateClientConnectionRoute,
  applyClientAudioBuffer,
  applyReceiverBuffer,
  setReceiveAudio,
  cancelSynchronizedStart,
  applySynchronizedStart
} from './multiplayer-client-audio';
import {
  persistFreeplayState,
  sendFreeplayQueueToPeer,
  setFreeplayQueue,
  restoreFreeplayStateForHost,
  tryResumeFreeplaySelection,
  updateLocalTimelineMode
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
  type MultiplayerCommandInput,
  type MultiplayerSynchronizedStart
} from './multiplayer-protocol';
import {
  type MultiplayerClientSide,
  type MultiplayerSessionCore,
  type PeerConnection
} from './multiplayer-types';

/**
 * Shared per-session context handed to the client-side sub-modules. The
 * coordinator owns the mutable fields and wires the cross-module handler
 * references; sub-modules never import each other.
 */
export interface MultiplayerClientContext {
  core: MultiplayerSessionCore;
  publish: (patch: Parameters<MultiplayerSessionCore['publish']>[0]) => void;
  transition: MultiplayerClientTransition;
  receiverMonitor: ReturnType<typeof createReceiverBitrateMonitor>;
  withTimeout: <T>(promise: Promise<T>, timeoutMs: number, message: string) => Promise<T>;
  sourceRetryGenerationId: string | null;
  sourceRetryCount: number;
  pendingFreeplayResumeTrackId: string | null;
  synchronizedStartTimer: number | null;
  synchronizedStartGenerationId: string | null;
  synchronizedStartAt: number;
  renderReadySentGeneration: string | null;
  renderReadySentEpoch: number;
  cancelSynchronizedStart: () => void;
  applySynchronizedStart: (peer: PeerConnection, start: MultiplayerSynchronizedStart) => void;
  updateLocalTimelineMode: () => void;
  persistFreeplayState: () => void;
  sendFreeplayQueueToPeer: () => void;
  restoreFreeplayStateForHost: (hostId: string) => void;
  tryResumeFreeplaySelection: () => void;
  connectClient: (rawInviteCode: string, reconnecting: boolean, silent?: boolean) => Promise<void>;
  resolveDirectoryRoomCode: (hostId: string) => Promise<string | null>;
  attachClientChannel: (peer: PeerConnection) => void;
  attachClientRemoteAudio: (peer: PeerConnection, generationId: string) => Promise<void>;
  attachClientMediaChannel: (peer: PeerConnection) => void;
  attachClientRenderChannel: (peer: PeerConnection) => void;
  loadPendingClientSourceFile: (peer: PeerConnection) => void;
  sendClientPlaybackReadyIfPossible: (peer: PeerConnection) => void;
  requestSourceRetry: (peer: PeerConnection, generationId: string) => void;
  updateClientConnectionRoute: (peer: PeerConnection) => Promise<void>;
  applyClientAudioBuffer: (peer: PeerConnection) => void;
  applyReceiverBuffer: (receiver: RTCRtpReceiver) => void;
  scheduleClientReconnect: (delay?: number) => void;
  clearReconnectTimer: () => void;
  resumeAudio: () => Promise<boolean>;
  sendCommand: (command: MultiplayerCommandInput) => boolean;
}

export function createMultiplayerClientSide(core: MultiplayerSessionCore): MultiplayerClientSide {
  const transition = new MultiplayerClientTransition();
  transition.setReceiveAudio(core.state.receiveAudio);

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });

  const ctx: MultiplayerClientContext = {
    core,
    publish,
    transition,
    receiverMonitor,
    withTimeout,
    sourceRetryGenerationId: null,
    sourceRetryCount: 0,
    pendingFreeplayResumeTrackId: null,
    synchronizedStartTimer: null,
    synchronizedStartGenerationId: null,
    synchronizedStartAt: 0,
    renderReadySentGeneration: null,
    renderReadySentEpoch: -1,
    cancelSynchronizedStart: (): void => cancelSynchronizedStart(ctx),
    applySynchronizedStart: (peer, start): void => applySynchronizedStart(ctx, peer, start),
    updateLocalTimelineMode: (): void => updateLocalTimelineMode(ctx),
    persistFreeplayState: (): void => persistFreeplayState(ctx),
    sendFreeplayQueueToPeer: (): void => sendFreeplayQueueToPeer(ctx),
    restoreFreeplayStateForHost: (hostId): void => restoreFreeplayStateForHost(ctx, hostId),
    tryResumeFreeplaySelection: (): void => tryResumeFreeplaySelection(ctx),
    connectClient: (rawInviteCode, reconnecting, silent = false): Promise<void> =>
      connectClient(ctx, rawInviteCode, reconnecting, silent),
    resolveDirectoryRoomCode: (hostId): Promise<string | null> => resolveDirectoryRoomCode(ctx, hostId),
    attachClientChannel: (peer): void => attachClientChannel(ctx, peer),
    attachClientRemoteAudio: (peer, generationId): Promise<void> =>
      attachClientRemoteAudio(ctx, peer, generationId),
    attachClientMediaChannel: (peer): void => attachClientMediaChannel(ctx, peer),
    attachClientRenderChannel: (peer): void => attachClientRenderChannel(ctx, peer),
    loadPendingClientSourceFile: (peer): void => loadPendingClientSourceFile(ctx, peer),
    sendClientPlaybackReadyIfPossible: (peer): void => sendClientPlaybackReadyIfPossible(ctx, peer),
    requestSourceRetry: (peer, generationId): void => requestSourceRetry(ctx, peer, generationId),
    updateClientConnectionRoute: (peer): Promise<void> => updateClientConnectionRoute(ctx, peer),
    applyClientAudioBuffer: (peer): void => applyClientAudioBuffer(ctx, peer),
    applyReceiverBuffer: (receiver): void => applyReceiverBuffer(ctx, receiver),
    scheduleClientReconnect: (delay): void => scheduleClientReconnect(ctx, delay),
    clearReconnectTimer: (): void => clearReconnectTimer(ctx),
    resumeAudio: (): Promise<boolean> => resumeAudio(ctx),
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
    if (core.state.receiveAudio) void ctx.resumeAudio();
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    return true;
  }

  return {
    join: (inviteCode, options) => join(ctx, inviteCode, options),
    joinPaired: (hostId) => joinPaired(ctx, hostId),
    restoreClientJoin: (last) => restoreClientJoin(ctx, last),
    leave: () => leave(ctx),
    sendCommand: (command) => sendCommand(command),
    setFreeplayQueue: (itemIds) => setFreeplayQueue(ctx, itemIds),
    setReceiveAudio: (enabled) => setReceiveAudio(ctx, enabled),
    resumeAudio: () => resumeAudio(ctx),
    applyClientAudioBuffer: (peer) => applyClientAudioBuffer(ctx, peer),
    handleClientResume: () => handleClientResume(ctx),
    clearReceiverMonitor: () => receiverMonitor.clear(),
    clearReconnectTimer: () => clearReconnectTimer(ctx),
    resetTransitions: () => {
      ctx.cancelSynchronizedStart();
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
}
