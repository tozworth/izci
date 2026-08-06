import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import {
  forgetMultiplayerPairing,
  multiplayerPairings,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import { multiplayerAudioService, type MultiplayerReceiverAudioStatus } from './multiplayer-audio';
import { enableOpusStereo } from './multiplayer-opus';
import { resolveMultiplayerConnectionRoute } from './multiplayer-ice';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { getMultiplayerArtworkTrackKey } from './multiplayer-artwork';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  createMultiplayerMessageDecoder,
  isHostMessage,
  type MultiplayerCommand,
  type MultiplayerCommandInput
} from './multiplayer-protocol';
import {
  clearPeerConnectionTimer,
  createPeer,
  describeIceFailure,
  flushRemoteCandidates,
  preferOpus,
  prepareCandidatePublisher,
  sendToPeer,
  stageRemoteCandidates,
  startPeerConnectionTimer
} from './multiplayer-peer';
import { parseSourceFileFrame } from './multiplayer-source-transfer';
import {
  createDirectIceSettings,
  loadFirebase,
  normalizeInviteCode,
  requestTemporaryTurnCredentials
} from './multiplayer-signaling';
import {
  createReceiverBitrateMonitor
} from './multiplayer-receiver-monitor';
import {
  cycleMultiplayerRepeatMode,
  errorMessage,
  getClientPlatform,
  getLocalName,
  isMultiplayerClientTransportHealthy,
  isMultiplayerPlaybackPreparationReady,
  sanitizeClientName,
  sanitizeFreeplayQueueIds,
  writeReceiveAudioPreference
} from './multiplayer-utils';
import {
  EMPTY_CATALOG,
  EMPTY_REMOTE_PLAYBACK,
  type MultiplayerClientSide,
  type MultiplayerSessionCore,
  type PeerConnection,
  type SignalAnswer,
  type SignalCandidates,
  type SourceFileBeginFrame
} from './multiplayer-types';

/**
 * The streamed element's playout runs ~100-250 ms behind the receiver's
 * jitter buffer (the HTMLMediaElement's own media-pipeline latency on top of
 * the configured `multiplayerAudioBufferMs` target). The retained tail of the
 * previous streamed track therefore spans `bufferMs + this margin`, and the
 * fresh attach must wait that long for the silent drain sink to consume it —
 * otherwise the fresh pipeline starts by replaying a slice of the old track.
 */
const STREAMED_RETAINED_TAIL_MARGIN_MS = 250;

/**
 * Cap for the preroll cushion build (Phase A in `attachClientRemoteAudio`):
 * the time we wait for the receiver's jitter-buffer level to reach the
 * configured target while the muted preroll element consumes. The build is
 * polled against receiver stats and normally ends at ~`multiplayerAudioBufferMs`
 * of wall time; the cap keeps a slow-to-build receiver from stalling the
 * track for many seconds.
 */
const STREAMED_PREROLL_BUILD_CAP_MS = 2500;

export function createMultiplayerClientSide(core: MultiplayerSessionCore): MultiplayerClientSide {
  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });
  // When the last streamed→streamed switch drained the remote element, this is
  // when the previous track's retained tail (~buffer ms) began playing out
  // through the silent sink. The attach waits the remainder out before the
  // preroll takes over, so the old track can never sit at the front of the
  // fresh cushion (and replay) when the route connects.
  let streamedDrainStartedAt: number | null = null;
  // Monotonic guard for concurrent async attaches (rapid track switches): only
  // the most recent attach may touch the pipeline.
  let clientAudioAttachToken = 0;

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  function updateLocalTimelineMode(): void {
    multiplayerSourcePlaybackService.setLocalTimeline(
      core.state.mode === 'client' && core.state.freeplay && core.latestAudioAvailability.sourceFile
    );
  }

  function setFreeplayQueue(itemIds: string[]): void {
    const sanitized = sanitizeFreeplayQueueIds(itemIds);
    publish({ freeplayQueue: sanitized });
    sendFreeplayQueueToPeer();
  }

  function sendFreeplayQueueToPeer(): void {
    const peer = core.clientPeer;
    if (!peer || core.state.mode !== 'client' || !core.state.freeplay) return;
    if (peer.channel?.readyState !== 'open') return;
    sendToPeer(peer, { kind: 'freeplay.queue', itemIds: core.state.freeplayQueue });
  }

  async function join(rawInviteCode: string): Promise<void> {
    core.allowClientReconnect = true;
    core.reconnectAttempts = 0;
    multiplayerSourcePlaybackService.beginClientSession((trackId) => {
      if (!core.clientPeer || core.state.mode !== 'client' || !core.state.freeplay) return;
      if (core.latestAudioAvailability.sourceFile
        && core.state.remoteCatalog.repeatMode === 'one') {
        // Source-file Freeplay repeat-one is a purely local restart: the client owns
        // its timeline, so looping the current file needs no host round-trip.
        multiplayerSourcePlaybackService.replay();
        return;
      }
      sendToPeer(core.clientPeer, { kind: 'playback.ended', trackId });
    });
    multiplayerSourcePlaybackService.setEnabled(core.state.receiveAudio);
    try {
      await connectClient(rawInviteCode, false);
      if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
    } catch (error) {
      await multiplayerSourcePlaybackService.endClientSession();
      throw error;
    }
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
    const pairing = multiplayerPairings.getSnapshot().find((candidate) => candidate.hostId === hostId);
    rememberMultiplayerPairing(
      hostId,
      sanitizeClientName(directory.hostName ?? 'Host'),
      pairing?.freeplay === true
    );
    await join(directory.currentRoom!);
  }

  async function connectClient(rawInviteCode: string, reconnecting: boolean): Promise<void> {
    clearReconnectTimer();
    await core.resetSession(true);
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
      freeplayPaired: reconnecting ? core.state.freeplayPaired : false,
      freeplay: reconnecting ? core.state.freeplay : false,
      freeplayQueue: reconnecting ? core.state.freeplayQueue : [],
      remoteCatalog: reconnecting ? core.state.remoteCatalog : EMPTY_CATALOG,
      remotePlayback: reconnecting ? core.state.remotePlayback : EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: reconnecting ? core.state.remoteArtwork : null,
      remoteArtworkResolvedTrackKey: reconnecting ? core.state.remoteArtworkResolvedTrackKey : '',
      audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
      remoteSourceFile: reconnecting ? core.state.remoteSourceFile : false,
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: 'Signing in to multiplayer signaling...',
      message: null
    });

    try {
      const firebase = await loadFirebase();
      core.firebaseRuntime = firebase;
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
        core.multiplayerSettings.multiplayerAudioBufferMs
      );
      const channel = peer.pc.createDataChannel('izci-control', { ordered: true });
      peer.channel = channel;
      const mediaChannel = peer.pc.createDataChannel('izci-media', { ordered: true });
      mediaChannel.binaryType = 'arraybuffer';
      peer.mediaChannel = mediaChannel;
      core.clientPeer = peer;
      core.pendingClientPlaybackPreparation = null;
      core.clientRemoteAudioReady = false;
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
      core.ownPeerRef = clientSignalRef;
      core.peerDisconnect = disconnect;

      const offer = enableOpusStereo(await peer.pc.createOffer());
      publish({ connectionDetail: 'Creating an ICE connection offer...' });
      const startCandidatePublishing = prepareCandidatePublisher(
        peer,
        `multiplayer/rooms/${inviteCode}/peers/${firebase.uid}/clientCandidates`,
        () => core.firebaseRuntime,
        () => {
          core.allowClientReconnect = false;
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
      publish({ connectionDetail: `Waiting for ${core.state.hostName ?? 'the host'} to answer...` });
      startPeerConnectionTimer(peer, () => {
        if (core.clientPeer !== peer || peer.pc.connectionState === 'connected') return;
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: describeIceFailure(peer),
          message: describeIceFailure(peer)
        });
        scheduleClientReconnect(2_000);
      });

      core.stopAnswerListener = firebase.onValue(
        nextPeerRef,
        (snapshot) => {
          const signal = snapshot.val() as {
            host?: SignalAnswer;
            hostCandidates?: SignalCandidates;
          } | null;
          const answer = signal?.host;
          if (answer?.error === 'host-full') {
            core.allowClientReconnect = false;
            clearPeerConnectionTimer(peer);
            publish({
              connectionStatus: 'error',
              audioStatus: 'unavailable',
              connectionDetail: 'The host has reached its listener limit.',
              message: 'That multiplayer host has reached its listener limit.'
            });
            peer.pc.close();
            if (core.firebaseRuntime && core.ownPeerRef) void core.firebaseRuntime.remove(core.ownPeerRef);
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
      await core.resetSession(true);
      if (reconnecting && core.allowClientReconnect) {
        publish({
          mode: 'client',
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          connectionDetail: 'The signaling attempt failed; preparing another attempt...',
          message: 'Reconnecting to the host...'
        });
      } else {
        core.allowClientReconnect = false;
        publish({
          mode: 'idle',
          connectionStatus: 'error',
          hostName: null,
          hostVersion: null,
          freeplayPaired: false,
          freeplay: false,
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
      if (core.clientPeer !== peer) return;
      core.reconnectAttempts = 0;
      core.reconnectInFlight = false;
      clearReconnectTimer();
      publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
      if (core.state.inviteCode && core.state.hostName) {
        rememberMultiplayerHost(core.state.hostName, core.state.inviteCode);
      }
      sendToPeer(peer, {
        kind: 'hello',
        version: MULTIPLAYER_PROTOCOL_VERSION,
        name: peer.name,
        platform: getClientPlatform(),
        freeplayEnabled: core.multiplayerSettings.multiplayerFreeplay
      });
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      const message = decode(event.data);
      if (!message) return;
      if (message.kind === 'catalog') {
        publish({
          remoteCatalog: {
            ...message.catalog,
            // Freeplay transport flags are delivered by `state` messages and the
            // client's own optimistic toggles; the catalog still carries a
            // snapshot (plain multiplayer peers read it there), but an in-flight
            // catalog echo — e.g. a queue-change reply generated before the host
            // applied a toggle — must never clobber the button state.
            shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
            repeatMode: core.state.remoteCatalog.repeatMode
          }
        });
      }
      if (message.kind === 'state') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            shuffleEnabled: message.shuffleEnabled,
            repeatMode: message.repeatMode
          }
        });
      }
      if (message.kind === 'playback') {
        const previousTrackId = core.state.remotePlayback.track?.id ?? null;
        const loadingNewTrack =
          message.playback.snapshot.state === 'loading'
          && message.playback.track?.id != null
          && message.playback.track.id !== previousTrackId;
        publish({ remotePlayback: message.playback });
        if (loadingNewTrack && core.latestAudioAvailability.enabled) {
          // The host started loading a different streamed track. The streamed
          // element must stop NOW (zero headroom) while staying attached as the
          // receiver's silent sink — otherwise the retained tail of the
          // previous track (~buffer ms, still queued in the receiver; a target
          // flush does NOT discard it) stays audible until the fresh attach.
          multiplayerAudioService.drainRemoteTrack();
          streamedDrainStartedAt = Date.now();
          // Keep the configured jitter cushion applied through the drain (a
          // source-file interlude flushed it to 0): while the drained sink
          // consumes the old tail from the front, incoming silence/new-track
          // audio accumulates behind it toward the target, so the preroll that
          // follows (attachClientRemoteAudio) starts from a level that is
          // already at — or close to — the configured cushion.
          applyClientAudioBuffer(peer);
        }
        multiplayerSourcePlaybackService.syncPlayback(message.playback);
        loadPendingClientSourceFile(peer);
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'playback.prepare') {
        core.pendingClientPlaybackPreparation = message.preparation;
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'ack' && !message.accepted) {
        // Rejected commands (e.g. Freeplay activation when the host cannot read
        // the track's file) used to be silent; surface the host's reason.
        publish({ message: message.message ?? 'The host could not apply that command.' });
      }
      if (message.kind === 'artwork') {
        publish({
          remoteArtwork: message.artwork,
          remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(core.state.remotePlayback.track)
        });
      }
      if (message.kind === 'pairing') {
        if (message.paired) {
          rememberMultiplayerPairing(message.hostId, message.name, message.freeplayPaired);
        }
        else forgetMultiplayerPairing(message.hostId);
        publish({
          freeplayPaired: message.paired && message.freeplayPaired,
          freeplay: message.paired && message.freeplayActive
        });
        updateLocalTimelineMode();
        if (message.paired && message.freeplayActive) {
          // Reconnect creates a fresh host peer; re-sync the owned queue so the
          // host can resolve it into the catalog and step within it.
          sendFreeplayQueueToPeer();
        }
      }
      if (message.kind === 'audio') {
        core.latestAudioAvailability = message.audio;
        publish({ remoteSourceFile: message.audio.sourceFile });
        updateLocalTimelineMode();
        if (!message.audio.enabled) core.clientRemoteAudioReady = false;
        if (!core.state.receiveAudio) {
          multiplayerSourcePlaybackService.setEnabled(false);
          publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
        } else if (message.audio.sourceFile) {
          // Source-file phase: the transferred track plays through the local
          // player. Keep the remote element as a silent sink so the receiver's
          // jitter buffer keeps advancing (the host's silence anchor feeds it
          // through the interlude) instead of freezing with the previous
          // streamed track's tail — and flush the buffer target so NetEq drops
          // retained audio. The next streamed track then builds a FRESH
          // pipeline (see attachClientRemoteAudio) that starts from silence.
          multiplayerAudioService.drainRemoteTrack();
          flushClientReceiverBuffer(peer);
          multiplayerSourcePlaybackService.setEnabled(true);
          publish({ audioStatus: multiplayerSourcePlaybackService.active ? 'playing' : 'connecting' });
        } else if (!message.audio.enabled) {
          publish({
            audioStatus: 'disabled',
            averageAudioBitrateKbps: null
          });
          multiplayerSourcePlaybackService.clearSourceTrack();
        } else if (core.state.audioStatus === 'disabled') {
          publish({ audioStatus: 'connecting' });
        }
        if (message.audio.enabled && core.state.receiveAudio) {
          multiplayerSourcePlaybackService.clearSourceTrack();
          attachClientRemoteAudio(peer);
        }
        sendClientPlaybackReadyIfPossible(peer);
      }
      if (message.kind === 'kicked') {
        core.allowClientReconnect = false;
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
        if (core.state.inviteCode) rememberMultiplayerHost(hostName, core.state.inviteCode);
      }
    };
    channel.onclose = () => {
      if (core.clientPeer !== peer) return;
      multiplayerSourcePlaybackService.clearLoadedFile();
      if (core.state.mode === 'client' && core.state.connectionStatus !== 'error') {
        publish({
          connectionStatus: core.allowClientReconnect ? 'connecting' : 'disconnected',
          reconnecting: core.allowClientReconnect,
          audioStatus: 'unavailable',
          connectionDetail: core.allowClientReconnect
            ? 'The peer connection closed; preparing another attempt...'
            : core.state.message ?? 'Connection to the host was lost.',
          message: core.allowClientReconnect
            ? 'Reconnecting to the host...'
            : core.state.message ?? 'Connection to the host was lost.'
        });
        scheduleClientReconnect(1_000);
      }
    };
    peer.pc.onconnectionstatechange = () => {
      if (core.clientPeer !== peer) return;
      if (peer.pc.connectionState === 'connected') {
        clearPeerConnectionTimer(peer);
        core.reconnectAttempts = 0;
        clearReconnectTimer();
        publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
        void updateClientConnectionRoute(peer);
      }
      if (peer.pc.connectionState === 'failed') {
        publish({
          connectionStatus: 'disconnected',
          reconnecting: core.allowClientReconnect,
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
      setMultiplayerReceiverBuffer(event.receiver, core.multiplayerSettings.multiplayerAudioBufferMs);
      receiverMonitor.start(peer);
      // No attach here: every streamed attach happens via the `audio` message
      // (attachClientRemoteAudio), which runs the preroll (cushion build →
      // playout → route) so the audible start is clean. An attach at ontrack
      // would be a live zero-cushion sink playing the first seconds with the
      // start-of-track slowdown.
      if (!core.state.receiveAudio || core.latestAudioAvailability.sourceFile || !core.latestAudioAvailability.enabled) {
        event.track.enabled = false;
        publish({
          audioStatus: core.state.receiveAudio ? 'connecting' : 'refused',
          averageAudioBitrateKbps: null
        });
      }
    };
  }

  async function attachClientRemoteAudio(peer: PeerConnection): Promise<void> {
    if (core.clientPeer !== peer || !core.state.receiveAudio || !core.latestAudioAvailability.enabled) return;
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') return;
    track.enabled = true;
    const attachToken = ++clientAudioAttachToken;
    const bufferMs = core.multiplayerSettings.multiplayerAudioBufferMs;
    const statusHandler = (audioStatus: MultiplayerReceiverAudioStatus): void => {
      if (core.state.mode === 'client' && core.state.receiveAudio && core.latestAudioAvailability.enabled) {
        publish({ audioStatus });
        core.clientRemoteAudioReady = audioStatus === 'playing';
        sendClientPlaybackReadyIfPossible(peer);
      }
    };
    const bailIfSuperseded = (): boolean => attachToken !== clientAudioAttachToken
      || core.clientPeer !== peer
      || !core.state.receiveAudio
      || !core.latestAudioAvailability.enabled;

    // TAIL WAIT (switch path only) — the previous streamed track's retained
    // tail (~bufferMs, still queued in the receiver; a target flush does NOT
    // discard it) must be consumed by the DRAINED element before the preroll
    // takes over, otherwise the tail sits at the front of the fresh cushion
    // and the audible start replays a slice of the old track. The drained
    // element has been consuming it since the playback(loading) drain; wait
    // out the remainder (bufferMs + the element's own pipeline latency).
    const drainStartedAt = streamedDrainStartedAt;
    streamedDrainStartedAt = null;
    const tailWaitMs = drainStartedAt === null
      ? 0
      : Math.max(0, bufferMs + STREAMED_RETAINED_TAIL_MARGIN_MS - (Date.now() - drainStartedAt));
    if (tailWaitMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, tailWaitMs));
      if (bailIfSuperseded()) return;
    }

    // PREROLL — the fresh element must NEVER start audible from an empty
    // receiver buffer. The receiver's jitter-buffer target is a setpoint:
    // while the element consumes with the level below it, NetEq holds back
    // (time-stretches) toward the target, which is audible as the first
    // ~1-2 s of the track being glitchy/slowed. So the fresh element attaches
    // MUTED and out of the graph (the receiver's sink — consumption is what
    // lets NetEq's delay management run), the cushion is built and played out
    // inaudibly, and only then is the route connected.
    //
    // Phase A — build the cushion. The element consumes the wire (silence:
    // the host stays paused until we report readiness) while NetEq holds back
    // toward the target. The host's own audio only starts flowing AFTER the
    // cushion exists, so its beginning is buffered, not stretched. Ends when
    // the receiver's measured playout delay reaches the target (or a cap).
    // After the tail wait the level is already at the target, so this phase
    // ends immediately on the switch path.
    applyClientAudioBuffer(peer);
    multiplayerAudioService.clearRemoteTrack();
    const prerolled = await multiplayerAudioService.attachRemoteTrackPrerolled(
      track,
      new MediaStream([track]),
      statusHandler
    );
    if (!prerolled || bailIfSuperseded()) return;
    if (bufferMs > 0) {
      await waitForReceiverCushion(peer, bufferMs);
      if (bailIfSuperseded()) return;
    }
    // The cushion is in place: release the host's playback-preparation gate so
    // the track starts playing into the receiver. The preroll element consumes
    // the silence cushion at real time while the track's beginning accumulates
    // behind it — nothing is audible yet.
    core.clientRemoteAudioReady = true;
    sendClientPlaybackReadyIfPossible(peer);
    // Phase B — play out the cushion. The silence cushion (≈ bufferMs) plus
    // the element's own pipeline latency must be consumed before the front of
    // the receiver reaches the new track's beginning, so the audible start
    // (Phase C) begins at the track's start with the full cushion in place.
    if (bufferMs > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, bufferMs + STREAMED_RETAINED_TAIL_MARGIN_MS));
      if (bailIfSuperseded()) return;
    }
    // Phase C — audible. The element has been warm and the receiver is at
    // steady state the whole time, so the first sample the user hears is
    // clean.
    await multiplayerAudioService.connectRemoteRoute();
  }

  /**
   * Waits for the audio receiver's jitter-buffer level to reach the configured
   * cushion. The level is the average per-emitted-frame delay from the
   * receiver stats (jitterBufferDelay / jitterBufferEmittedCount), which is
   * meaningful only while a consumer (the preroll element) is attached — that
   * is exactly the state this runs in. Falls through on a cap so a receiver
   * that never builds (or a paused host) cannot stall the track indefinitely.
   */
  async function waitForReceiverCushion(peer: PeerConnection, bufferMs: number): Promise<void> {
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    if (!receiver) return;
    const targetMs = Math.max(0, Math.round(bufferMs));
    const thresholdMs = Math.max(200, targetMs - 100);
    const capMs = Math.min(STREAMED_PREROLL_BUILD_CAP_MS, Math.max(1000, targetMs + 500));
    const startedAt = Date.now();
    while (Date.now() - startedAt < capMs) {
      let levelMs = 0;
      try {
        const stats = await receiver.getStats();
        for (const stat of stats.values()) {
          if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') continue;
          const { jitterBufferDelay, jitterBufferEmittedCount } = stat as unknown as {
            jitterBufferDelay?: number;
            jitterBufferEmittedCount?: number;
          };
          if (typeof jitterBufferDelay === 'number'
            && typeof jitterBufferEmittedCount === 'number'
            && jitterBufferEmittedCount > 0) {
            levelMs = (jitterBufferDelay / jitterBufferEmittedCount) * 1000;
          }
          break;
        }
      } catch {
        // Stats are optional; keep polling.
      }
      if (levelMs >= thresholdMs) return;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
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
          // Source-file phase: keep the remote element as a silent sink (see
          // the audio message handler) and flush the receiver buffer, so the
          // previous streamed track's retained audio cannot survive into the
          // next streamed track. The transfer frame can arrive before the
          // audio message — drain and flush in both.
          multiplayerAudioService.drainRemoteTrack();
          flushClientReceiverBuffer(peer);
          // Keep the current file audible until its replacement is completely received
          // and prepared. Stopping the only active media element here lets mobile
          // Chromium suspend a locked client before the remaining chunks can arrive.
          if (core.state.receiveAudio) publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
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
        core.pendingClientSourceFile = { trackId: complete.frame.trackId, file };
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
      if (core.clientPeer === peer && core.latestAudioAvailability.sourceFile) {
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({ audioStatus: 'unavailable' });
      }
    };
  }

  function loadPendingClientSourceFile(peer: PeerConnection): void {
    const pending = core.pendingClientSourceFile;
    const remoteTrack = core.state.remotePlayback.track;
    if (!pending || !remoteTrack || remoteTrack.id !== pending.trackId) return;
    core.pendingClientSourceFile = null;
    void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then((loaded) => {
      if (core.clientPeer !== peer || !core.state.receiveAudio) return;
      publish({ audioStatus: loaded ? 'playing' : 'unavailable', averageAudioBitrateKbps: null });
      sendClientPlaybackReadyIfPossible(peer);
    });
  }

  function sendClientPlaybackReadyIfPossible(peer: PeerConnection): void {
    const preparation = core.pendingClientPlaybackPreparation;
    if (!preparation || core.clientPeer !== peer) return;
    const remoteTrackId = core.state.remotePlayback.track?.id ?? null;
    if (!isMultiplayerPlaybackPreparationReady(preparation, {
      remoteTrackId,
      receiveAudio: core.state.receiveAudio,
      loadedSourceTrackId: multiplayerSourcePlaybackService.isTrackReady(preparation.trackId)
        ? preparation.trackId
        : null,
      streamReady: core.clientRemoteAudioReady
    })) return;
    core.pendingClientPlaybackPreparation = null;
    sendToPeer(peer, {
      kind: 'playback.ready',
      preparationId: preparation.preparationId
    });
  }

  async function updateClientConnectionRoute(peer: PeerConnection): Promise<void> {
    try {
      const route = resolveMultiplayerConnectionRoute((await peer.pc.getStats()).values());
      if (core.clientPeer === peer && route) publish({ connectionRoute: route });
    } catch {
      // Connection stats are optional; the client remains usable without a route label.
    }
  }

  function applyClientAudioBuffer(peer: PeerConnection): void {
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      setMultiplayerReceiverBuffer(receiver, core.multiplayerSettings.multiplayerAudioBufferMs);
    }
  }

  /**
   * Drops the receiver's retained audio at a streamed→source-file transition.
   * The remote element is gone (no sink), so NetEq would otherwise freeze the
   * jitter buffer holding the previous streamed track's tail and replay it when
   * the next streamed track attaches. Flushing the target to zero discards it;
   * the next streamed track starts from an empty buffer (a clean gap).
   */
  function flushClientReceiverBuffer(peer: PeerConnection): void {
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      setMultiplayerReceiverBuffer(receiver, 0);
    }
  }

  function setReceiveAudio(enabled: boolean): void {
    if (core.state.receiveAudio === enabled) return;
    writeReceiveAudioPreference(enabled);
    publish({ receiveAudio: enabled });
    if (core.state.mode !== 'client' || !core.clientPeer) return;

    multiplayerSourcePlaybackService.setEnabled(enabled);
    if (!enabled) sendClientPlaybackReadyIfPossible(core.clientPeer);
    if (core.latestAudioAvailability.sourceFile) {
      multiplayerAudioService.clearRemoteTrack();
      publish({
        audioStatus: enabled
          ? multiplayerSourcePlaybackService.active ? 'playing' : 'connecting'
          : 'refused',
        averageAudioBitrateKbps: null
      });
      return;
    }

    const receiver = core.clientPeer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
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
    if (!core.latestAudioAvailability.enabled) {
      publish({ audioStatus: 'disabled' });
      return;
    }
    attachClientRemoteAudio(core.clientPeer);
  }

  function scheduleClientReconnect(delay?: number): void {
    if (!core.allowClientReconnect || core.state.mode !== 'client' || core.reconnectInFlight || core.reconnectTimer !== null) return;
    const inviteCode = core.state.inviteCode;
    if (!inviteCode) return;
    const backoff = [2_000, 5_000, 10_000, 20_000, 30_000];
    const wait = delay ?? backoff[Math.min(core.reconnectAttempts, backoff.length - 1)];
    core.reconnectTimer = window.setTimeout(() => {
      core.reconnectTimer = null;
      if (!core.allowClientReconnect || core.state.mode !== 'client') return;
      core.reconnectInFlight = true;
      core.reconnectAttempts += 1;
      publish({
        connectionStatus: 'connecting',
        reconnecting: true,
        audioStatus: 'connecting',
        connectionDetail: 'Reconnecting and gathering fresh ICE candidates...',
        message: 'Reconnecting to the host...'
      });
      void connectClient(inviteCode, true)
        .then(() => {
          core.reconnectInFlight = false;
          if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
        })
        .catch(() => {
          core.reconnectInFlight = false;
          scheduleClientReconnect();
        });
    }, wait);
  }

  function clearReconnectTimer(): void {
    if (core.reconnectTimer === null) return;
    window.clearTimeout(core.reconnectTimer);
    core.reconnectTimer = null;
  }

  function handleClientResume(): void {
    if (document.visibilityState === 'hidden') return;
    if (core.state.mode !== 'client' || !core.allowClientReconnect) return;
    if (core.clientPeer && isMultiplayerClientTransportHealthy(
      core.clientPeer.pc.connectionState,
      core.clientPeer.channel?.readyState
    )) {
      // A long-lived background connection can remain healthy while Media Session keeps
      // mobile playback alive. Elapsed hidden time alone is not a reason to replace it.
      clearReconnectTimer();
      applyClientAudioBuffer(core.clientPeer);
      if (core.latestAudioAvailability.sourceFile) multiplayerSourcePlaybackService.resume();
      else if (core.latestAudioAvailability.enabled) void multiplayerAudioService.resumeRemoteAudio();
      return;
    }
    clearReconnectTimer();
    scheduleClientReconnect(0);
  }

  function sendCommand(command: MultiplayerCommandInput): boolean {
    if (core.state.mode !== 'client' || core.state.connectionStatus !== 'connected' || !core.clientPeer) return false;
    const completeCommand = {
      ...command,
      commandId: crypto.randomUUID()
    } as MultiplayerCommand;
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    // Freeplay shuffle/repeat flags live on the host per peer. The host applies
    // the identical toggle and no longer re-ships the whole catalog for it, so
    // the client can flip its button optimistically: instant feedback with no
    // round-trip, and no risk of drifting because the toggle is deterministic.
    if (core.state.freeplay) {
      if (command.type === 'playlist.shuffle') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            shuffleEnabled: !core.state.remoteCatalog.shuffleEnabled
          }
        });
      } else if (command.type === 'playlist.repeat') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            repeatMode: cycleMultiplayerRepeatMode(core.state.remoteCatalog.repeatMode)
          }
        });
      }
    }
    return true;
  }

  async function leave(): Promise<void> {
    if (core.state.mode !== 'client') return;
    core.allowClientReconnect = false;
    clearReconnectTimer();
    await core.resetSession(true);
    await multiplayerSourcePlaybackService.endClientSession();
    publish({
      mode: 'idle',
      connectionStatus: 'idle',
      reconnecting: false,
      inviteCode: null,
      hostName: null,
      hostVersion: null,
      freeplayPaired: false,
      freeplay: false,
      freeplayQueue: [],
      clients: [],
      remoteCatalog: EMPTY_CATALOG,
      remotePlayback: EMPTY_REMOTE_PLAYBACK,
      remoteArtwork: null,
      remoteArtworkResolvedTrackKey: '',
      audioStatus: 'idle',
      remoteSourceFile: false,
      connectionRoute: null,
      averageAudioBitrateKbps: null,
      connectionStats: null,
      connectionDetail: null,
      message: null
    });
  }

  function resumeAudio(): Promise<boolean> {
    return multiplayerSourcePlaybackService.resume()
      ? Promise.resolve(true)
      : multiplayerAudioService.resumeRemoteAudio();
  }

  return {
    join,
    joinPaired,
    leave,
    sendCommand,
    setFreeplayQueue,
    setReceiveAudio,
    resumeAudio,
    applyClientAudioBuffer,
    handleClientResume,
    clearReceiverMonitor: () => receiverMonitor.clear(),
    // Session reset must also clear the streamed-attach closure state and
    // invalidate any in-flight preroll attach (Phase A/B/C waits): a stale
    // `streamedDrainStartedAt` would delay the next session's first attach,
    // and bumping the token makes any pending continuation bail.
    resetStreamedAudioState: () => {
      streamedDrainStartedAt = null;
      clientAudioAttachToken += 1;
    },
    clearReconnectTimer
  };
}
