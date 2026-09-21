import type { MultiplayerIceSettings } from './multiplayer-ice';
import { logWarning } from '$lib/services/logging';
import { createMultiplayerRtcConfiguration } from './multiplayer-ice';
import {
  createMultiplayerMessageDecoder,
  encodeMultiplayerMessage,
  type ClientMessage,
  type HostMessage
} from './multiplayer-protocol';
import type { PeerConnection, SignalCandidate, SignalCandidates } from './multiplayer-types';
import { errorMessage, isClientMessage } from './multiplayer-utils';

const ICE_CONNECTION_TIMEOUT_MS = 15_000;

export function createPeer(
  id: string,
  name: string,
  settings: MultiplayerIceSettings,
  rtcConfig?: RTCConfiguration
): PeerConnection {
  return {
    id,
    name,
    pc: new RTCPeerConnection(rtcConfig ?? createMultiplayerRtcConfiguration(settings)),
    channel: null,
    outgoing: [],
    flushing: false,
    mediaChannel: null,
    mediaOutgoing: [],
    mediaQueuedBytes: 0,
    mediaFlushing: false,
    mediaTransferToken: 0,
    renderChannel: null,
    renderOutgoing: [],
    renderQueuedBytes: 0,
    renderFlushing: false,
    renderState: null,
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
    connectionTimer: null,
    signalingCreatedAt: 0,
    clientIdentity: null,
    pairNonce: null,
    paired: false,
    clientFreeplayEnabled: false,
    clientUseHostOdaBackground: false,
    helloReceived: false,
    chatLeaveAnnounced: false,
    freeplaySettled: false,
    mediaSyncPending: false,
    freeplay: false,
    freeplayPlayer: null,
    freeplayCollection: 'library',
    freeplayShuffle: false,
    freeplayRepeatMode: 'off',
    freeplayNavigation: null,
    freeplayQueue: [],
    freeplayUpNext: [],
    freeplayActivation: null,
    freeplayModeToken: 0,
    freeplayPendingPreparation: null,
    freeplayArtwork: null,
    freeplayArtworkTrackKey: '',
    freeplayArtworkResolvedTrackKey: '',
    freeplayArtworkLoadToken: 0,
    freeplayDelivery: null
  };
}

export function sendToPeer(peer: PeerConnection, message: HostMessage | ClientMessage): void {
  peer.outgoing.push(...encodeMultiplayerMessage(message));
  flushPeer(peer);
}

export function flushPeer(peer: PeerConnection): void {
  const channel = peer.channel;
  if (peer.flushing || !channel || channel.readyState !== 'open') return;
  peer.flushing = true;
  const flush = () => {
    if (!peer.channel || peer.channel.readyState !== 'open') {
      peer.flushing = false;
      return;
    }
    while (peer.outgoing.length > 0 && peer.channel.bufferedAmount < 512_000) {
      try {
        peer.channel.send(peer.outgoing[0]);
        peer.outgoing.shift();
      } catch (error) {
        peer.flushing = false;
        logWarning('multiplayer', 'Control-channel send failed; reconnect required', {
          peerId: peer.id,
          error
        });
        peer.channel.close();
        return;
      }
    }
    if (peer.outgoing.length === 0) {
      peer.flushing = false;
      return;
    }
    window.setTimeout(flush, 20);
  };
  flush();
}

export async function applyAudioBitrate(peer: PeerConnection, bitrateKbps: number): Promise<void> {
  peer.pendingAudioBitrate = bitrateKbps * 1_000;
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

/**
 * ICE publisher with an injected candidate sender. The sender numbers
 * candidates per peer (Firebase path suffix or server per-attempt index)
 * and performs the actual transport write; this module owns gathering,
 * queuing until the answer/offer is published, and failure reporting.
 */
export function prepareCandidatePublisher(
  peer: PeerConnection,
  publishCandidate: (candidate: SignalCandidate, index: number) => void | Promise<void>,
  reportFailure: () => void
): () => void {
  let ready = false;
  let sequence = 0;
  let writeFailed = false;
  const queued: SignalCandidate[] = [];

  function reportWriteError(error: unknown): void {
    peer.candidateErrors.push(errorMessage(error, 'candidate signaling failed'));
    if (writeFailed) return;
    writeFailed = true;
    reportFailure();
  }

  function write(candidate: SignalCandidate): void {
    const index = sequence;
    sequence += 1;
    try {
      const result = publishCandidate(candidate, index);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        void (result as Promise<void>).catch(reportWriteError);
      }
    } catch (error) {
      reportWriteError(error);
    }
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

export function stageRemoteCandidates(peer: PeerConnection, candidates: SignalCandidates): void {
  for (const [id, candidate] of Object.entries(candidates)) {
    if (peer.appliedRemoteCandidateIds.has(id)
      || peer.pendingRemoteCandidates.has(id)
      || !isSignalCandidate(candidate)) continue;
    peer.pendingRemoteCandidates.set(id, candidate);
    noteCandidateType(peer.remoteCandidateTypes, candidate.candidate);
  }
  void flushRemoteCandidates(peer);
}

/**
 * Stage one server remote candidate. The signaling sequence index is used
 * only for deduplication; the browser-facing SDP media coordinates travel
 * separately. Candidates arriving before remote SDP wait in the existing
 * pending map until flushRemoteCandidates can apply them.
 */
export function stageServerRemoteCandidate(
  peer: PeerConnection,
  candidate: string,
  index: number,
  sdpMid: string,
  sdpMLineIndex: number
): void {
  const id = `sk-${index}`;
  if (peer.appliedRemoteCandidateIds.has(id) || peer.pendingRemoteCandidates.has(id)) return;
  if (!candidate || index < 0) return;
  const signalCandidate: SignalCandidate = { candidate, sdpMid, sdpMLineIndex };
  peer.pendingRemoteCandidates.set(id, signalCandidate);
  noteCandidateType(peer.remoteCandidateTypes, candidate);
  void flushRemoteCandidates(peer);
}

export async function flushRemoteCandidates(peer: PeerConnection): Promise<void> {
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

export function startPeerConnectionTimer(peer: PeerConnection, handleTimeout: () => void): void {
  clearPeerConnectionTimer(peer);
  peer.connectionTimer = window.setTimeout(() => {
    peer.connectionTimer = null;
    handleTimeout();
  }, ICE_CONNECTION_TIMEOUT_MS);
}

export function clearPeerConnectionTimer(peer: PeerConnection): void {
  if (peer.connectionTimer === null) return;
  window.clearTimeout(peer.connectionTimer);
  peer.connectionTimer = null;
}

export function disposePeerConnection(peer: PeerConnection): void {
  clearPeerConnectionTimer(peer);
  peer.freeplayActivation = null;
  peer.freeplayModeToken += 1;
  peer.freeplayPendingPreparation = null;
  peer.freeplayPlayer?.destroy();
  peer.freeplayPlayer = null;
  peer.freeplayNavigation = null;
  peer.freeplayQueue = [];
  peer.freeplayUpNext = [];
  peer.mediaTransferToken += 1;
  peer.mediaOutgoing = [];
  peer.mediaQueuedBytes = 0;
  // NOTE: do NOT null peer.renderState here. The host's render-channel
  // onclose handler owns unpinning the cached render; closing the PC below
  // fires it. Nulling first would skip the unpin and leak a pinned cache entry.
  peer.renderOutgoing = [];
  peer.renderQueuedBytes = 0;
  peer.outgoing = [];
  peer.pc.close();
}

export function describeIceFailure(peer: PeerConnection, peerName?: string): string {
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

export function preferOpus(transceiver: RTCRtpTransceiver): void {
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
