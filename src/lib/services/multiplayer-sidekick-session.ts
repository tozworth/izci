/**
 * Sidekick session attachment: host and guest RTC setup over the sidekick
 * signaling transport. Keeps RTC creation and channel attachment identical
 * to the RTDB path; only the signaling transport differs. Attempt-local
 * connection IDs identify peers until the RTC hello supplies
 * identity/presentation.
 */
import { logError, logInfo, logWarning } from '$lib/services/logging';
import { rememberMultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { enableOpusStereo } from './multiplayer-opus';
import { MULTIPLAYER_PROTOCOL_VERSION } from './multiplayer-protocol';
import { multiplayerChat } from './multiplayer-chat';
import {
  applyAudioBitrate,
  clearPeerConnectionTimer,
  createPeer,
  describeIceFailure,
  disposePeerConnection,
  flushRemoteCandidates,
  preferOpus,
  prepareCandidatePublisher,
  stageSidekickRemoteCandidate,
  startPeerConnectionTimer
} from './multiplayer-peer';
import { createDirectIceSettings } from './multiplayer-signaling';
import { errorMessage, getLocalName } from './multiplayer-utils';
import type { MultiplayerHostContext } from './multiplayer-host';
import type { MultiplayerClientContext } from './multiplayer-client';
import {
  announceHostPeerLeave,
  attachHostChannel,
  attachHostMediaChannel,
  attachHostRenderChannel
} from './multiplayer-host-channels';
import { removePeerFromHostPlaybackPreparation } from './multiplayer-host-playback-prep';
import { primeHostState } from './multiplayer-host-sync';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { attachClientChannel } from './multiplayer-client-channels';
import { attachClientMediaChannel, attachClientRenderChannel } from './multiplayer-client-audio';
import { updateLocalTimelineMode } from './multiplayer-client-freeplay';
import {
  acquireSidekickHostRoom,
  acquireSidekickHostRoomWithSession,
  connectSidekickHost,
  reconnectSidekickHost,
  type SidekickHostEvents,
  type SidekickHostLink
} from './multiplayer-sidekick-host';
import { connectSidekickGuest, type SidekickGuestConnection } from './multiplayer-sidekick-client';
import { getSidekickRtcConfig } from './multiplayer-sidekick-ice-cache';
import { broadcastSidekickInvitation } from './multiplayer-sidekick-host-pairing';
import {
  normalizeSidekickEndpoint,
  rotateSidekickInvitation as rotateSidekickRoomInvitation,
  SidekickError
} from './multiplayer-sidekick-http';

export interface SidekickHostInvitation {
  endpoint: string;
  roomId: string;
  secret: string;
  /** Owner secret for resume; null when the server never issued one here. */
  ownerSecret: string | null;
}

function checkGeneration(core: { transportGeneration: number }, generation: number): boolean {
  return core.transportGeneration === generation;
}

export async function startSidekickHosting(
  ctx: MultiplayerHostContext,
  args: {
    endpoint: string;
    hostKey: string;
    capacity?: number;
    signal?: AbortSignal;
    /** Bearer from the setup controller's login step; ownership moves here. */
    sessionToken?: string;
    resume?: { roomId: string; ownerSecret: string };
  }
): Promise<SidekickHostInvitation> {
  const { core } = ctx;
  const endpoint = normalizeSidekickEndpoint(args.endpoint);
  const capacity = Math.min(
    Math.max(args.capacity ?? core.multiplayerSettings.multiplayerMaxListeners, 1),
    8
  );
  // Shared teardown must retain the current Sidekick host long enough to
  // DELETE its room. Clearing it here leaked one server-side room every
  // time Host was invoked again, eventually exhausting maxRooms.
  await core.resetSession(true);
  // resetSession bumps the generation; re-anchor to the new value.
  const owned = core.transportGeneration;
  core.publish({
    mode: 'hosting',
    connectionStatus: 'connecting',
    hostName: getLocalName(),
    freeplay: false,
    audioStatus: 'idle',
    connectionDetail: 'Creating a sidekick room...',
    message: null
  });

  try {
    multiplayerChat.restorePersistedHistory(core.multiplayerSettings.multiplayerChatHistoryLines);
    const room = args.sessionToken
      ? await acquireSidekickHostRoomWithSession(endpoint, args.sessionToken, capacity, {
        signal: args.signal,
        resume: args.resume
      })
      : await acquireSidekickHostRoom(endpoint, args.hostKey, capacity, {
        signal: args.signal,
        resume: args.resume
      });
    if (!checkGeneration(core, owned) || args.signal?.aborted) {
      throw args.signal?.reason ?? new Error('aborted');
    }
    const attempts = new Map<string, string>();
    let activeLink: SidekickHostLink | null = null;
    let hostReconnecting = false;
    async function reconnectHostSignaling(): Promise<void> {
      // Signaling reconnect never touches RTC peers: healthy playback
      // survives while the socket rebinds within the server grace window.
      if (hostReconnecting || !checkGeneration(core, owned) || core.state.mode !== 'hosting') return;
      if (!activeLink) return;
      hostReconnecting = true;
      core.publish({
        sidekickSignaling: 'reconnecting',
        connectionDetail: 'Reconnecting sidekick signaling; audio continues.'
      });
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error('host reconnect timed out')), 90_000);
      try {
        const fresh = await reconnectSidekickHost(room, hostEvents, activeLink, { signal: deadline.signal });
        if (!checkGeneration(core, owned) || core.state.mode !== 'hosting') {
          fresh.dispose();
          return;
        }
        activeLink = fresh;
        core.sidekickHost = fresh;
        core.disposeSidekickTransport = () => fresh.dispose();
        core.publish({ sidekickSignaling: 'live', connectionDetail: null });
      } catch {
        if (!checkGeneration(core, owned) || core.state.mode !== 'hosting') return;
        core.publish({
          sidekickSignaling: 'dropped',
          connectionDetail: 'Sidekick signaling dropped; audio continues.'
        });
      } finally {
        clearTimeout(timer);
        hostReconnecting = false;
      }
    }
    const hostEvents: SidekickHostEvents = {
        onPeerRequested(connectionId, attemptId) {
          if (!checkGeneration(core, owned)) return;
          if (core.state.mode !== 'hosting') return;
          attempts.set(attemptId, connectionId);
          if (core.hostPeers.size >= core.multiplayerSettings.multiplayerMaxListeners) {
            activeLink?.reject(attemptId);
            return;
          }
          // Install the host handler (accept) before the guest is prompted
          // to offer; the server only prompts after accept.
          activeLink?.accept(attemptId);
        },
        onOffer(attemptId, sdp) {
          if (!checkGeneration(core, owned)) return;
          if (core.state.mode !== 'hosting' || !activeLink) return;
          const connectionId = attempts.get(attemptId) ?? attemptId.slice(0, 8);
          void acceptSidekickOffer(ctx, activeLink, connectionId, attemptId, sdp, owned);
        },
        onCandidate(attemptId, candidate, index, sdpMid, sdpMLineIndex) {
          if (!checkGeneration(core, owned)) return;
          const peer = findHostPeerByAttempt(ctx, attemptId);
          if (peer) stageSidekickRemoteCandidate(peer, candidate, index, sdpMid, sdpMLineIndex);
        },
        onCandidatesEnd() {
          // End-of-candidates is informational; queued candidates flush on
          // remote description via the shared helpers.
        },
        onConnected(attemptId) {
          if (!checkGeneration(core, owned)) return;
          const peer = findHostPeerByAttempt(ctx, attemptId);
          if (peer) core.updateClient(peer.id, { status: 'connected' });
        },
        onReleased(attemptId) {
          if (!checkGeneration(core, owned)) return;
          const peer = findHostPeerByAttempt(ctx, attemptId);
          if (peer) {
            announceHostPeerLeave(ctx, peer);
            disposePeerConnection(peer);
            core.hostPeers.delete(peer.id);
            core.publish({ clients: core.state.clients.filter((c) => c.id !== peer.id) });
          }
          attempts.delete(attemptId);
        },
        onError(envelope) {
          logWarning('multiplayer', 'Sidekick host socket error', {
            type: envelope.type,
            requestId: envelope.requestId
          });
        },
        onSocketClose() {
          void reconnectHostSignaling();
        }
      };
    const link = await connectSidekickHost(room, hostEvents, { signal: args.signal });
    activeLink = link;
    if (!checkGeneration(core, owned) || args.signal?.aborted) {
      link.dispose();
      throw args.signal?.reason ?? new Error('aborted');
    }
    core.sidekickHost = link;
    core.disposeSidekickTransport = () => link.dispose();
    core.publish({
      mode: 'hosting',
      connectionStatus: 'connected',
      inviteCode: null,
      connectionDetail: null,
      sidekickSignaling: 'live',
      sidekickHostAuth: 'valid'
    });
    logInfo('multiplayer', 'Sidekick hosting started', {
      protocol: MULTIPLAYER_PROTOCOL_VERSION
    });
    rememberMultiplayerLastSession('hosting', {
      hostName: getLocalName(),
      transport: 'sidekick',
      sidekickEndpoint: endpoint,
      sidekickRoomId: room.roomId
    });
    primeHostState(ctx);
    return {
      endpoint,
      roomId: room.roomId,
      secret: room.invitationSecret,
      ownerSecret: room.ownerSecret || null
    };
  } catch (error) {
    logError('multiplayer', 'Sidekick hosting failed', error);
    if (checkGeneration(core, owned)) {
      await core.resetSession(true);
      const message = errorMessage(error, 'Could not start sidekick hosting.');
      core.publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        hostMotd: '',
        hostVersion: null,
        freeplay: false,
        connectionDetail: message,
        message,
        sidekickSignaling: null,
        // An expired operator login needs a fresh key, not a retry.
        sidekickHostAuth: error instanceof SidekickError && error.code === 'unauthorized'
          ? 'expired'
          : null
      });
    }
    throw error instanceof Error ? error : new Error('Could not start sidekick hosting.');
  }
}

/**
 * Rotate the hosted room's invitation without closing the room. Returns
 * the replacement secret for future joins; existing peers are unaffected.
 */
export async function rotateSidekickInvitation(ctx: MultiplayerHostContext): Promise<string> {
  const link = ctx.core.sidekickHost;
  if (!link || ctx.core.state.mode !== 'hosting') throw new Error('No hosted sidekick room.');
  const rotated = await rotateSidekickRoomInvitation(
    link.room.endpoint,
    link.room.sessionToken,
    link.room.roomId
  );
  link.room.invitationSecret = rotated.invitationSecret;
  // Paired guests learn the replacement over their authorized channel;
  // offline guests need a fresh invite link.
  broadcastSidekickInvitation(ctx, rotated.invitationSecret);
  return rotated.invitationSecret;
}

function findHostPeerByAttempt(ctx: MultiplayerHostContext, attemptId: string) {
  for (const peer of ctx.core.hostPeers.values()) {
    if ((peer as { sidekickAttemptId?: string }).sidekickAttemptId === attemptId) return peer;
  }
  return null;
}

async function acceptSidekickOffer(
  ctx: MultiplayerHostContext,
  link: SidekickHostLink,
  connectionId: string,
  attemptId: string,
  sdp: string,
  generation: number
): Promise<void> {
  const { core } = ctx;
  if (!checkGeneration(core, generation) || core.state.mode !== 'hosting') return;
  const previous = core.hostPeers.get(connectionId);
  if (previous) {
    announceHostPeerLeave(ctx, previous);
    disposePeerConnection(previous);
    core.hostPeers.delete(connectionId);
  }
  // Authenticated server ICE (STUN plus time-limited TURN when the
  // operator configured a relay); relay-only without a relay fails here
  // with a useful message instead of a silent direct attempt.
  let rtcConfig: RTCConfiguration;
  try {
    rtcConfig = await getSidekickRtcConfig({
      endpoint: link.room.endpoint,
      bearer: link.room.sessionToken,
      roomId: link.room.roomId,
      cacheKey: `host::${link.room.endpoint}::${link.room.roomId}`,
      forceRelay: core.multiplayerSettings.multiplayerSidekickForceRelay
    });
  } catch (error) {
    core.updateClient(connectionId, { status: 'disconnected' });
    core.publish({
      message: errorMessage(error, 'Could not prepare the connection.')
    });
    return;
  }
  if (!checkGeneration(core, generation) || core.state.mode !== 'hosting') return;
  const peer = createPeer(connectionId, `Guest ${connectionId.slice(0, 4)}`, createDirectIceSettings(), rtcConfig);
  (peer as { sidekickAttemptId?: string }).sidekickAttemptId = attemptId;
  peer.signalingCreatedAt = Date.now();
  core.hostPeers.set(connectionId, peer);
  core.updateClient(connectionId, {
    name: peer.name,
    platform: 'Unknown',
    status: 'connecting',
    paired: false,
    freeplay: false
  });

  peer.pc.ondatachannel = (event) => {
    if (event.channel.label === 'izci-media') attachHostMediaChannel(ctx, peer, event.channel);
    else if (event.channel.label === 'izci-render') attachHostRenderChannel(ctx, peer, event.channel);
    else attachHostChannel(ctx, peer, event.channel);
  };
  peer.pc.onconnectionstatechange = () => {
    if (core.hostPeers.get(connectionId) !== peer) return;
    if (!checkGeneration(core, generation)) return;
    const status = peer.pc.connectionState;
    if (status === 'connected') {
      clearPeerConnectionTimer(peer);
      core.updateClient(connectionId, { status: 'connected' });
      core.publish({ message: null });
      link.sendConnected(attemptId);
    }
    if (status === 'failed' || status === 'disconnected' || status === 'closed') {
      core.updateClient(connectionId, { status: 'disconnected' });
      removePeerFromHostPlaybackPreparation(ctx, connectionId);
    }
    if (status === 'failed' || status === 'closed') announceHostPeerLeave(ctx, peer);
    if (status === 'failed') core.publish({ message: describeIceFailure(peer, peer.name) });
  };

  try {
    await peer.pc.setRemoteDescription({ type: 'offer', sdp });
    if (!checkGeneration(core, generation) || core.state.mode !== 'hosting') {
      disposePeerConnection(peer);
      core.hostPeers.delete(connectionId);
      return;
    }
    const audioTransceiver = peer.pc.getTransceivers().find(
      (t) => t.receiver.track.kind === 'audio'
    );
    if (audioTransceiver) {
      preferOpus(audioTransceiver);
      audioTransceiver.direction = 'sendonly';
      peer.audioSender = audioTransceiver.sender;
      await peer.audioSender.replaceTrack(null);
    }
    const answer = enableOpusStereo(await peer.pc.createAnswer());
    const startPublishing = prepareCandidatePublisher(
      peer,
      (candidate, index) => {
        link.sendCandidate(
          attemptId,
          candidate.candidate,
          index,
          candidate.sdpMid,
          candidate.sdpMLineIndex
        );
      },
      () => {
        clearPeerConnectionTimer(peer);
        core.publish({ message: `Could not send ICE candidates for ${peer.name}.` });
      }
    );
    await peer.pc.setLocalDescription(answer);
    await applyAudioBitrate(peer, core.multiplayerSettings.multiplayerOpusBitrateKbps);
    if (!checkGeneration(core, generation) || core.state.mode !== 'hosting') {
      disposePeerConnection(peer);
      core.hostPeers.delete(connectionId);
      return;
    }
    link.sendAnswer(attemptId, peer.pc.localDescription?.sdp ?? answer.sdp ?? '');
    startPublishing();
    startPeerConnectionTimer(peer, () => {
      if (peer.pc.connectionState === 'connected' || core.state.mode !== 'hosting') return;
      core.updateClient(connectionId, { status: 'disconnected' });
      core.publish({ message: describeIceFailure(peer, peer.name) });
    });
  } catch (error) {
    disposePeerConnection(peer);
    core.hostPeers.delete(connectionId);
    core.updateClient(connectionId, { status: 'disconnected' });
    core.publish({
      message: `Could not finish the connection to ${peer.name}: ${errorMessage(error, 'ICE signaling failed.')}`
    });
  }
}

export async function joinSidekick(
  ctx: MultiplayerClientContext,
  args: { endpoint: string; roomId: string; secret: string; signal?: AbortSignal }
): Promise<void> {
  const { core, transition } = ctx;
  const endpoint = normalizeSidekickEndpoint(args.endpoint);
  const generation = core.transportGeneration + 1;
  core.transportGeneration = generation;
  core.disposeSidekickTransport?.();
  core.disposeSidekickTransport = null;
  core.sidekickHost?.dispose();
  core.sidekickHost = null;
  core.sidekickGuest?.dispose();
  core.sidekickGuest = null;
  await core.resetSession(true);
  const owned = core.transportGeneration;
  core.publish({
    mode: 'client',
    connectionStatus: 'connecting',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostVersion: null,
    freeplay: false,
    audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
    connectionDetail: 'Joining the sidekick room...',
    message: null
  });
  updateLocalTimelineMode(ctx);

  try {
    const guestRef: { current: SidekickGuestConnection | null } = { current: null };
    let pendingAcceptedAttempt: string | null = null;
    const guest = await connectSidekickGuest(
      endpoint,
      args.roomId,
      args.secret,
      {
        onAccepted(attemptId) {
          if (!checkGeneration(core, owned)) return;
          if (!guestRef.current) {
            pendingAcceptedAttempt = attemptId;
            return;
          }
          void createSidekickOffer(ctx, guestRef.current, attemptId, owned);
        },
        onRejected(attemptId, reason) {
          if (!checkGeneration(core, owned)) return;
          logWarning('multiplayer', 'Sidekick guest rejected', { attemptId, reason });
          core.publish({
            connectionStatus: 'error',
            audioStatus: 'unavailable',
            connectionDetail: 'The host rejected the connection.',
            message: 'The host rejected the connection.'
          });
        },
        onAnswer(attemptId, sdp) {
          if (!checkGeneration(core, owned)) return;
          const peer = core.clientPeer;
          if (!peer || peer.signalingCreatedAt !== attemptHash(attemptId)) return;
          void peer.pc
            .setRemoteDescription({ type: 'answer', sdp })
            .then(() => flushRemoteCandidates(peer))
            .catch((error) => {
              clearPeerConnectionTimer(peer);
              core.publish({
                connectionStatus: 'error',
                audioStatus: 'unavailable',
                connectionDetail: 'The host answer was rejected by the browser.',
                message: `The host answer could not be applied: ${errorMessage(error, 'invalid session description')}`
              });
            });
        },
        onCandidate(attemptId, candidate, index, sdpMid, sdpMLineIndex) {
          if (!checkGeneration(core, owned)) return;
          const peer = core.clientPeer;
          if (!peer || peer.signalingCreatedAt !== attemptHash(attemptId)) return;
          stageSidekickRemoteCandidate(peer, candidate, index, sdpMid, sdpMLineIndex);
        },
        onCandidatesEnd() {
          // Informational; flush happens on remote description.
        },
        onConnected() {
          // RTC state remains authoritative for UI; server notice is a hint.
        },
        onReleased(_attemptId, reason) {
          if (!checkGeneration(core, owned)) return;
          logWarning('multiplayer', 'Sidekick guest released', { reason });
        },
        onSocketClose() {
          if (!checkGeneration(core, owned)) return;
          if (core.state.mode !== 'client') return;
          // Explicit opt-in only: healthy RTC playback continues either way.
          if (!core.multiplayerSettings.multiplayerSidekickAutoReconnect) {
            core.publish({ sidekickSignaling: 'dropped' });
            return;
          }
          const guest = core.sidekickGuest;
          if (!guest) return;
          void (async () => {
            const timeout = new AbortController();
            const timer = setTimeout(() => timeout.abort(new Error('reconnect timed out')), 45_000);
            try {
              core.publish({
                sidekickSignaling: 'reconnecting',
                connectionDetail: 'Reconnecting sidekick signaling...'
              });
              await guest.reconnectSignaling(timeout.signal);
              if (!checkGeneration(core, owned) || core.state.mode !== 'client') return;
              core.publish({ sidekickSignaling: 'live', connectionDetail: null });
            } catch {
              // RTC keeps playing; the next drop retries. Never surface
              // the ticket material in UI text.
              if (!checkGeneration(core, owned) || core.state.mode !== 'client') return;
              core.publish({
                sidekickSignaling: 'dropped',
                connectionDetail: 'Sidekick signaling dropped; audio continues.'
              });
            } finally {
              clearTimeout(timer);
            }
          })();
        },
        onError(envelope) {
          logWarning('multiplayer', 'Sidekick guest socket error', {
            type: envelope.type,
            requestId: envelope.requestId
          });
        }
      },
      { signal: args.signal }
    );
    guestRef.current = guest;
    if (pendingAcceptedAttempt) {
      const attemptId = pendingAcceptedAttempt;
      pendingAcceptedAttempt = null;
      void createSidekickOffer(ctx, guest, attemptId, owned);
    }
    if (!checkGeneration(core, owned) || args.signal?.aborted) {
      guest.dispose();
      throw args.signal?.reason ?? new Error('aborted');
    }
    core.sidekickGuest = guest;
    core.disposeSidekickTransport = () => guest.dispose();
    core.publish({ sidekickSignaling: 'live' });
    rememberMultiplayerLastSession('client', {
      hostName: null,
      transport: 'sidekick',
      sidekickEndpoint: endpoint,
      sidekickRoomId: args.roomId
    });
    // The offer is created after peer.accepted; if the server already
    // accepted before our handler attached, the event already fired and the
    // handler above ran. Nothing further to do here: connectionDetail updates
    // happen in createSidekickOffer.
  } catch (error) {
    logError('multiplayer', 'Sidekick join failed', error);
    if (checkGeneration(core, owned)) {
      await core.resetSession(true);
      core.publish({
        mode: 'idle',
        connectionStatus: 'error',
        hostName: null,
        hostVersion: null,
        freeplay: false,
        audioStatus: 'unavailable',
        connectionDetail: errorMessage(error, 'Could not join that sidekick session.'),
        message: errorMessage(error, 'Could not join that sidekick session.'),
        sidekickSignaling: null
      });
    }
    throw error instanceof Error ? error : new Error('Could not join that sidekick session.');
  }
}

function attemptHash(attemptId: string): number {
  let hash = 0;
  for (let i = 0; i < attemptId.length; i += 1) hash = (hash * 31 + attemptId.charCodeAt(i)) | 0;
  return hash;
}

async function createSidekickOffer(
  ctx: MultiplayerClientContext,
  guest: SidekickGuestConnection | null,
  attemptId: string,
  generation: number
): Promise<void> {
  const { core, transition } = ctx;
  if (!checkGeneration(core, generation) || !guest) return;
  // Authenticated server ICE for this admitted connection; relay-only
  // without a relay fails here with a useful message.
  let rtcConfig: RTCConfiguration;
  try {
    rtcConfig = await getSidekickRtcConfig({
      endpoint: guest.endpoint,
      bearer: guest.connectionToken,
      roomId: null,
      cacheKey: `guest::${guest.endpoint}::${guest.connectionId}`,
      forceRelay: core.multiplayerSettings.multiplayerSidekickForceRelay
    });
  } catch (error) {
    core.publish({
      connectionStatus: 'error',
      audioStatus: 'unavailable',
      connectionDetail: errorMessage(error, 'Could not prepare the connection.'),
      message: errorMessage(error, 'Could not prepare the connection.')
    });
    return;
  }
  if (!checkGeneration(core, generation)) return;
  // Dispose previous pending RTC work before attaching new results.
  if (core.clientPeer) {
    disposePeerConnection(core.clientPeer);
    core.clientPeer = null;
  }
  const peer = createPeer(`sidekick-${attemptId.slice(0, 8)}`, getLocalName(), createDirectIceSettings(), rtcConfig);
  peer.signalingCreatedAt = attemptHash(attemptId);
  const audioTransceiver = peer.pc.addTransceiver('audio', { direction: 'recvonly' });
  preferOpus(audioTransceiver);
  setMultiplayerReceiverBuffer(
    audioTransceiver.receiver,
    core.multiplayerSettings.multiplayerAudioBufferMs
  );
  const channel = peer.pc.createDataChannel('izci-control', { ordered: true });
  peer.channel = channel;
  const mediaChannel = peer.pc.createDataChannel('izci-media', { ordered: true });
  mediaChannel.binaryType = 'arraybuffer';
  peer.mediaChannel = mediaChannel;
  const renderChannel = peer.pc.createDataChannel('izci-render', { ordered: false });
  renderChannel.binaryType = 'arraybuffer';
  peer.renderChannel = renderChannel;
  core.clientPeer = peer;
  transition.reset();
  transition.setReceiveAudio(core.state.receiveAudio);
  attachClientChannel(ctx, peer);
  attachClientMediaChannel(ctx, peer);
  attachClientRenderChannel(ctx, peer);
  peer.pc.onconnectionstatechange = () => {
    if (core.clientPeer !== peer || !checkGeneration(core, generation)) return;
    if (peer.pc.connectionState === 'connected') {
      clearPeerConnectionTimer(peer);
      guest?.sendConnected();
    }
  };

  const startPublishing = prepareCandidatePublisher(
    peer,
    (candidate, index) => {
      guest?.sendCandidate(candidate.candidate, index, candidate.sdpMid, candidate.sdpMLineIndex);
    },
    () => {
      core.publish({
        connectionStatus: 'error',
        audioStatus: 'unavailable',
        message: 'Could not send ICE candidates over sidekick signaling.'
      });
    }
  );
  const offer = enableOpusStereo(await peer.pc.createOffer());
  if (!checkGeneration(core, generation) || core.clientPeer !== peer) {
    disposePeerConnection(peer);
    return;
  }
  await peer.pc.setLocalDescription(offer);
  if (!checkGeneration(core, generation) || core.clientPeer !== peer) {
    disposePeerConnection(peer);
    return;
  }
  core.publish({ connectionDetail: 'Sending the connection offer...' });
  guest?.sendOffer(peer.pc.localDescription?.sdp ?? offer.sdp ?? '');
  startPublishing();
  startPeerConnectionTimer(peer, () => {
    if (core.clientPeer !== peer || peer.pc.connectionState === 'connected') return;
    core.publish({
      connectionStatus: 'disconnected',
      audioStatus: 'unavailable',
      connectionDetail: describeIceFailure(peer),
      message: describeIceFailure(peer)
    });
  });
}
