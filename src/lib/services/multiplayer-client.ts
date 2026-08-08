import { rememberMultiplayerHost } from '$lib/stores/multiplayer-recents';
import {
  clearMultiplayerLastSession,
  rememberMultiplayerLastSession,
  type MultiplayerLastSession
} from '$lib/stores/multiplayer-last-session';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import {
  forgetMultiplayerPairing,
  multiplayerPairings,
  rememberMultiplayerPairing
} from '$lib/stores/multiplayer-pairings';
import {
  multiplayerFreeplayState,
  rememberMultiplayerFreeplayState
} from '$lib/stores/multiplayer-freeplay-state';
import { multiplayerAudioService, type MultiplayerReceiverAudioStatus } from './multiplayer-audio';
import { audioBusService } from '$lib/services/audio-bus';
import { enableOpusStereo } from './multiplayer-opus';
import { resolveMultiplayerConnectionRoute } from './multiplayer-ice';
import {
  ReceiverCushionTracker,
  estimateReceiverPlayoutLevelMs,
  setMultiplayerReceiverBuffer,
  type ReceiverPlayoutSample
} from './multiplayer-receiver';
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
 * The element's playout lags the receiver by its own media-pipeline latency
 * (~100-250 ms) on top of the jitter-buffer target, so the retained tail
 * spans `bufferMs + this margin`; the fresh attach must wait it out or it
 * starts by replaying a slice of the old track.
 */
const STREAMED_RETAINED_TAIL_MARGIN_MS = 250;

/**
 * Fast-poll window for the cushion build; scales with the target (a 750 ms
 * cushion reaches its floor in ~1.5-2.5 s on a healthy link). After the
 * window, polling continues at a slow cadence for
 * `STREAMED_PREROLL_BUILD_CAP_EXTRA_MS` — routing before the cushion exists
 * is the "nothing for 3 s, then stutters to life" regression.
 */
const STREAMED_PREROLL_BUILD_CAP_MS = 2500;

/**
 * Slow-cadence extension after the fast-poll window before giving up: a link
 * that cannot sustain real-time audio should not stall the track forever,
 * but a slow-but-working link gets the extra time to finish the build.
 */
const STREAMED_PREROLL_BUILD_CAP_EXTRA_MS = 3000;

/**
 * The build never quite reaches `multiplayerAudioBufferMs` (NetEq converges
 * to ~80-85 % of the target, asymptotically), so it exits on:
 * - STABLE: the level HOLDS at `STREAMED_PREROLL_LEVEL_RATIO` for several
 *   consecutive polls. Single-sample readings are never trusted.
 * - PLATEAU: level at/above a target-scaled FLOOR, not growing for
 *   `STREAMED_PREROLL_PLATEAU_MS`. Usual exit; early routes ARE the audible
 *   stutter.
 */
const STREAMED_PREROLL_LEVEL_RATIO = 0.75;
const STREAMED_PREROLL_MIN_LEVEL_MS = 400;
const STREAMED_PREROLL_FLOOR_RATIO = 0.55;
const STREAMED_PREROLL_PLATEAU_MS = 1200;
const STREAMED_PREROLL_FAST_POLL_MS = 150;
const STREAMED_PREROLL_SLOW_POLL_MS = 400;

export interface ReceiverCushionResult {
  /** Smoothed playout level (ms) measured at the end of the build. */
  levelMs: number;
  /** Which exit ended the build; logged for diagnosing real-network behavior. */
  reason: 'stable' | 'plateau' | 'budget' | 'no-receiver';
}

export function createMultiplayerClientSide(core: MultiplayerSessionCore): MultiplayerClientSide {
  const receiverMonitor = createReceiverBitrateMonitor({
    getState: () => core.state,
    publish: (patch) => core.publish(patch),
    isActivePeer: (peer) => core.clientPeer === peer
  });
  // When the last streamed→streamed switch drained the remote element, the
  // previous track's retained tail began playing out here; the attach waits
  // the remainder before the preroll takes over.
  let streamedDrainStartedAt: number | null = null;
  // Monotonic guard for concurrent async attaches (rapid track switches): only
  // the most recent attach may touch the pipeline.
  let clientAudioAttachToken = 0;
  // Set by the pairing handler after a reconnect when the previously-playing
  // Freeplay track should resume; consumed by the first `playback` message that
  // reports an empty host player (host restart wiped the selection).
  let freeplayResumeCandidate: string | null = null;

  function publish(patch: Parameters<MultiplayerSessionCore['publish']>[0]): void {
    core.publish(patch);
  }

  /**
   * Warms the AudioContext from a user gesture. The preroll runs from a
   * data-channel message — not a gesture — so its own resume() can be rejected
   * by the autoplay policy; a suspended context pulls nothing and the "warmed"
   * source node is cold at route time. Every call here originates in the UI.
   * Idempotent.
   */
  function warmClientAudioGraph(): void {
    if (!core.state.receiveAudio) return;
    void audioBusService.resume();
  }

  function updateLocalTimelineMode(): void {
    multiplayerSourcePlaybackService.setLocalTimeline(
      core.state.mode === 'client' && core.state.freeplay && core.latestAudioAvailability.sourceFile
    );
  }

  function setFreeplayQueue(itemIds: string[]): void {
    const sanitized = sanitizeFreeplayQueueIds(itemIds);
    publish({ freeplayQueue: sanitized });
    persistFreeplayState();
    sendFreeplayQueueToPeer();
  }

  function sendFreeplayQueueToPeer(): void {
    const peer = core.clientPeer;
    if (!peer || core.state.mode !== 'client' || !core.state.freeplay) return;
    if (peer.channel?.readyState !== 'open') return;
    sendToPeer(peer, {
      kind: 'freeplay.queue',
      itemIds: core.state.freeplayQueue,
      // A reconnect creates a fresh host peer, so the queue re-send doubles as
      // the transport-flag restore: the host applies these onto the fresh peer.
      shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
      repeatMode: core.state.remoteCatalog.repeatMode
    });
  }

  /**
   * Restores the persisted Freeplay state (queue + shuffle/repeat) for this
   * host after a fresh client session (reload/reconnect/restore). Keyed by
   * host id; skipped when the in-memory queue already has content (fresher).
   */
  function restoreFreeplayStateForHost(hostId: string): void {
    const record = multiplayerFreeplayState.getSnapshot();
    if (!record || record.hostId !== hostId) return;
    if (core.state.freeplayQueue.length > 0) return;
    if (record.queue.length === 0 && !record.shuffleEnabled && record.repeatMode === 'off') return;
    publish({
      freeplayQueue: record.queue,
      remoteCatalog: {
        ...core.state.remoteCatalog,
        shuffleEnabled: record.shuffleEnabled,
        repeatMode: record.repeatMode
      }
    });
    logInfo('multiplayer', 'Freeplay state restored', {
      hostId,
      queue: record.queue.length,
      shuffleEnabled: record.shuffleEnabled,
      repeatMode: record.repeatMode
    });
  }

  /**
   * Persists the client-owned Freeplay state keyed by the paired host, so a
   * later session with the same host restores the queue and transport flags.
   * Best-effort localStorage; only catalog item IDs, never host content.
   */
  function persistFreeplayState(): void {
    if (core.state.mode !== 'client' || !core.state.freeplay) return;
    const hostId = core.clientHostId;
    if (!hostId) return;
    // Keep the last real track id across transient empty-playback moments
    // (reconnect resets remotePlayback before the host re-announces a track).
    const liveTrackId = core.state.remotePlayback.track?.id ?? null;
    const previousRecord = multiplayerFreeplayState.getSnapshot();
    const previousTrackId = previousRecord && previousRecord.hostId === hostId
      ? previousRecord.currentTrackId
      : null;
    rememberMultiplayerFreeplayState({
      hostId,
      queue: core.state.freeplayQueue,
      shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
      repeatMode: core.state.remoteCatalog.repeatMode,
      currentTrackId: liveTrackId ?? previousTrackId
    });
  }

  /**
   * Joins a host by invite code. `silent` is the restore path: failures never
   * surface an error dialog — the state publishes as "reconnecting" and the
   * reconnect loop owns retries.
   */
  async function join(rawInviteCode: string, options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent === true;
    logInfo('multiplayer', 'Client joining', { inviteCode: rawInviteCode, silent });
    warmClientAudioGraph();
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
      await connectClient(rawInviteCode, false, silent);
      if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
    } catch (error) {
      logError('multiplayer', 'Client join failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (silent) {
        // Keep the retry loop alive; the source-playback session stays up so a
        // later successful connect can resume source-file playback.
        core.allowClientReconnect = true;
        scheduleClientReconnect(2_000);
        return;
      }
      await multiplayerSourcePlaybackService.endClientSession();
      throw error;
    }
  }

  async function joinPaired(hostId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(hostId)) {
      logWarning('multiplayer', 'Invalid paired host id', { hostId });
      throw new Error('That paired multiplayer host is invalid.');
    }
    warmClientAudioGraph();
    core.clientHostId = hostId;
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
      logWarning('multiplayer', 'Paired host is not currently hosting', { hostId });
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

  /**
   * Resolves a paired host's current room from its Firebase directory; null
   * when not hosting, the protocol differs, or no longer paired (the directory
   * is only readable by the host and its paired clients).
   */
  async function resolveDirectoryRoomCode(hostId: string): Promise<string | null> {
    try {
      const firebase = core.firebaseRuntime ?? await loadFirebase();
      const directory = (await firebase.get(firebase.ref(
        firebase.database,
        `multiplayer/hosts/${hostId}/directory`
      ))).val() as {
        currentRoom?: string;
        protocolVersion?: number;
      } | null;
      if (!directory || directory.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) return null;
      return normalizeInviteCode(directory.currentRoom ?? '');
    } catch (error) {
      logDebug('multiplayer', 'Paired host directory lookup failed', {
        error: errorMessage(error, 'directory lookup failed')
      });
      return null;
    }
  }

  /**
   * Restores a remembered client session: prefers the paired-host directory
   * (survives a host restart with a fresh room), falls back to the remembered
   * invite code, then joins silently with the reconnect loop owning retries.
   */
  async function restoreClientJoin(last: MultiplayerLastSession): Promise<void> {
    const directoryRoom = last.hostId ? await resolveDirectoryRoomCode(last.hostId) : null;
    const inviteCode = directoryRoom ?? last.inviteCode;
    if (!inviteCode) {
      logWarning('multiplayer', 'No restorable client session', { hasHostId: Boolean(last.hostId) });
      throw new Error('No multiplayer session to restore.');
    }
    core.clientHostId = last.hostId ?? null;
    if (directoryRoom) {
      logInfo('multiplayer', 'Restoring client session via paired host', { hostId: last.hostId, inviteCode: directoryRoom });
    } else {
      logInfo('multiplayer', 'Restoring client session via invite code', { inviteCode });
    }
    await join(inviteCode, { silent: true });
  }

  async function connectClient(rawInviteCode: string, reconnecting: boolean, silent = false): Promise<void> {
    clearReconnectTimer();
    await core.resetSession(true);
    const inviteCode = normalizeInviteCode(rawInviteCode);
    if (!inviteCode) {
      const error = new Error('Enter a valid multiplayer invite code.');
      logWarning('multiplayer', 'Invalid invite code');
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
        logError('multiplayer', 'Session unavailable or protocol mismatch', {
          remoteVersion: meta?.protocolVersion ?? null,
          localVersion: MULTIPLAYER_PROTOCOL_VERSION
        });
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
        effectiveAudioBufferMs()
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
            logWarning('multiplayer', 'Host reached its listener limit');
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
              logError('multiplayer', 'Host answer rejected by the browser', {
                error: errorMessage(error, 'invalid session description')
              });
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
      logError('multiplayer', 'Client connection attempt failed', {
        reconnecting,
        error: errorMessage(error, 'signaling failure')
      });
      if ((reconnecting || silent) && core.allowClientReconnect) {
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
      logInfo('multiplayer', 'Connected to host', { inviteCode: core.state.inviteCode ?? null });
      publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
      if (core.state.inviteCode && core.state.hostName) {
        rememberMultiplayerHost(core.state.hostName, core.state.inviteCode);
      }
      rememberMultiplayerLastSession('client', {
        inviteCode: core.state.inviteCode,
        hostId: core.clientHostId,
        hostName: core.state.hostName
      });
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
        logDebug('multiplayer', 'Remote catalog received', {
          library: message.catalog.library?.length ?? 0,
          playlist: message.catalog.playlist?.length ?? 0,
          favorites: message.catalog.favorites?.length ?? 0
        });
        publish({
          remoteCatalog: {
            ...message.catalog,
            // Transport flags come from `state` messages + the client's own optimistic
            // toggles; an in-flight catalog echo must never clobber the button state.
            shuffleEnabled: core.state.remoteCatalog.shuffleEnabled,
            repeatMode: core.state.remoteCatalog.repeatMode
          }
        });
      }
      if (message.kind === 'state') {
        logDebug('multiplayer', 'Freeplay flags state', {
          shuffleEnabled: message.shuffleEnabled,
          repeatMode: message.repeatMode
        });
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            shuffleEnabled: message.shuffleEnabled,
            repeatMode: message.repeatMode
          }
        });
        persistFreeplayState();
      }
      if (message.kind === 'playback') {
        const previousTrackId = core.state.remotePlayback.track?.id ?? null;
        const previousState = core.state.remotePlayback.snapshot.state;
        const loadingNewTrack =
          message.playback.snapshot.state === 'loading'
          && message.playback.track?.id != null
          && message.playback.track.id !== previousTrackId;
        // The playback message streams every progress tick; log only actual
        // track/state transitions to keep the buffer useful.
        if (
          message.playback.track?.id !== previousTrackId
          || message.playback.snapshot.state !== previousState
        ) {
          logDebug('multiplayer', 'Remote playback transition', {
            state: message.playback.snapshot.state,
            trackId: message.playback.track?.id ?? null
          });
        }
        publish({ remotePlayback: message.playback });
        // Keep the persisted record's current-track id fresh on real transitions
        // (id-compared; the playback message streams 4x/sec). Null tracks are not
        // persisted — an idle announcement must not wipe the resume target.
        if (core.state.freeplay
          && message.playback.track?.id
          && message.playback.track.id !== previousTrackId) {
          persistFreeplayState();
        }
        if (freeplayResumeCandidate) {
          const resumeTrackId = freeplayResumeCandidate;
          freeplayResumeCandidate = null;
          if (!message.playback.track && core.state.freeplay) {
            // The host's player is empty — it did NOT resume (host restart wiped the
            // memory). Re-activate the previously playing track; the queue was already
            // re-sent, so the host can resolve it.
            logInfo('multiplayer', 'Re-activating Freeplay track after reconnect', { trackId: resumeTrackId });
            sendToPeer(peer, {
              kind: 'command',
              command: {
                type: 'collection.activate',
                commandId: crypto.randomUUID(),
                collection: 'playlist',
                itemId: resumeTrackId
              }
            });
          }
          // else: the host already resumed (playback carries a track) — the
          // candidate is dropped so the running track is not restarted.
        }
        if (loadingNewTrack && core.latestAudioAvailability.enabled) {
          // Different streamed track loading: drain the element NOW (zero headroom)
          // while keeping it as the silent sink — the retained tail (~buffer ms) is
          // still queued; a target flush does NOT discard it.
          multiplayerAudioService.drainRemoteTrack();
          streamedDrainStartedAt = Date.now();
          // The previous track's preroll left `clientRemoteAudioReady = true`; it must
          // not leak into this track's readiness handshake (the audio message handler
          // sends readiness synchronously after the un-awaited attach, so the stale
          // flag would release the host's play gate mid-preroll — intro skipped). The
          // new attach re-arms it after the cushion is built.
          core.clientRemoteAudioReady = false;
          // Keep the configured cushion applied through the drain (an interlude
          // flushed it to 0): silence/new-track audio accumulates behind the old tail,
          // so the following preroll starts from a built level.
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
        logWarning('multiplayer', 'Host rejected a command', {
          message: message.message ?? 'command could not be applied'
        });
        publish({ message: message.message ?? 'The host could not apply that command.' });
      }
      if (message.kind === 'artwork') {
        publish({
          remoteArtwork: message.artwork,
          remoteArtworkResolvedTrackKey: getMultiplayerArtworkTrackKey(core.state.remotePlayback.track)
        });
      }
      if (message.kind === 'pairing') {
        logInfo('multiplayer', 'Pairing state from host', {
          paired: message.paired,
          freeplayActive: message.freeplayActive,
          freeplayPaired: message.freeplayPaired
        });
        if (message.paired) {
          rememberMultiplayerPairing(message.hostId, message.name, message.freeplayPaired);
          core.clientHostId = message.hostId;
          rememberMultiplayerLastSession('client', {
            inviteCode: core.state.inviteCode,
            hostId: message.hostId,
            hostName: message.name
          });
        }
        else forgetMultiplayerPairing(message.hostId);
        publish({
          freeplayPaired: message.paired && message.freeplayPaired,
          freeplay: message.paired && message.freeplayActive
        });
        updateLocalTimelineMode();
        if (message.paired && message.freeplayActive) {
          // Reconnect creates a fresh host peer; re-sync the owned queue so the host
          // can resolve it and step within it. A fresh session restores queue + flags
          // first — the message then carries both.
          restoreFreeplayStateForHost(message.hostId);
          sendFreeplayQueueToPeer();
          // A host restart wipes the host-side selection memory, so the fresh peer's
          // player has NO track — the queue re-send alone leaves audio unavailable.
          // Remember the previously-playing track and let the first post-reconnect
          // `playback` message decide: empty player → re-activate; host resumed → no-op.
          const record = multiplayerFreeplayState.getSnapshot();
          const liveTrackId = core.state.remotePlayback.track?.id ?? null;
          const restoredTrackId = record && record.hostId === message.hostId
            ? record.currentTrackId
            : null;
          const resumeTrackId = liveTrackId ?? restoredTrackId;
          if (resumeTrackId && core.state.freeplayQueue.includes(resumeTrackId)) {
            freeplayResumeCandidate = resumeTrackId;
          }
        }
      }
      if (message.kind === 'audio') {
        core.latestAudioAvailability = message.audio;
        logDebug('multiplayer', 'Audio availability', {
          enabled: message.audio.enabled,
          sourceFile: message.audio.sourceFile
        });
        publish({ remoteSourceFile: message.audio.sourceFile });
        updateLocalTimelineMode();
        if (!message.audio.enabled) core.clientRemoteAudioReady = false;
        if (!core.state.receiveAudio) {
          multiplayerSourcePlaybackService.setEnabled(false);
          publish({ audioStatus: 'refused', averageAudioBitrateKbps: null });
        } else if (message.audio.sourceFile) {
          // Source-file phase: keep the remote element as a silent sink (the host's
          // silence anchor feeds the receiver through the interlude) and keep the
          // cushion APPLIED — a target flush does NOT discard retained audio and would
          // drain the pre-built level. The old tail clears by the sink playing it out.
          multiplayerAudioService.drainRemoteTrack();
          applyClientAudioBuffer(peer);
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
      if (message.kind === 'buffer') {
        // Host-authoritative listener buffer: apply the new target live to the
        // receiver; the preroll reads the same effective value.
        logDebug('multiplayer', 'Host audio buffer target', { bufferMs: message.bufferMs });
        core.hostAudioBufferMs = message.bufferMs;
        applyClientAudioBuffer(peer);
      }
      if (message.kind === 'kicked') {
        core.allowClientReconnect = false;
        clearMultiplayerLastSession();
        logWarning('multiplayer', 'Client kicked by host');
        multiplayerSourcePlaybackService.clearLoadedFile();
        publish({
          connectionStatus: 'disconnected',
          audioStatus: 'unavailable',
          message: 'The host removed this client.'
        });
        peer.pc.close();
      }
      if (message.kind === 'hello' && message.version !== MULTIPLAYER_PROTOCOL_VERSION) {
        logError('multiplayer', 'Protocol mismatch with host', {
          hostVersion: message.version,
          localVersion: MULTIPLAYER_PROTOCOL_VERSION
        });
        publish({ connectionStatus: 'error', message: 'The host uses an incompatible protocol.' });
      }
      if (message.kind === 'hello') {
        const hostName = sanitizeClientName(message.name);
        logInfo('multiplayer', 'Host identified', { name: hostName, appVersion: message.appVersion });
        publish({ hostName, hostVersion: message.appVersion });
        if (core.state.inviteCode) rememberMultiplayerHost(hostName, core.state.inviteCode);
        rememberMultiplayerLastSession('client', {
          inviteCode: core.state.inviteCode,
          hostId: core.clientHostId,
          hostName
        });
      }
    };
    channel.onclose = () => {
      if (core.clientPeer !== peer) return;
      multiplayerSourcePlaybackService.clearLoadedFile();
      logWarning('multiplayer', 'Connection to host closed', {
        willReconnect: core.allowClientReconnect
      });
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
        logInfo('multiplayer', 'Peer connection established');
        publish({ connectionStatus: 'connected', reconnecting: false, connectionDetail: null, message: null });
        void updateClientConnectionRoute(peer);
      }
      if (peer.pc.connectionState === 'failed') {
        logWarning('multiplayer', 'Peer connection failed', {
          detail: describeIceFailure(peer)
        });
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
      logDebug('multiplayer', 'Remote audio track received');
      setMultiplayerReceiverBuffer(event.receiver, effectiveAudioBufferMs());
      receiverMonitor.start(peer);
      if (!core.state.receiveAudio) {
        event.track.enabled = false;
        publish({
          audioStatus: 'refused',
          averageAudioBitrateKbps: null
        });
        return;
      }
      // Persistent silent sink from session start: attach the receiver track to a
      // muted, out-of-graph element that is PLAYING — the receiver's only sink, so
      // NetEq's delay management runs and the cushion pre-builds (the host's
      // silence anchor keeps silence flowing through idle/source-file phases).
      // Never audible; the first streamed attach replaces it.
      event.track.enabled = true;
      void multiplayerAudioService.attachRemoteTrackPrerolled(
        event.track,
        new MediaStream([event.track]),
        (status) => {
          if (core.state.mode === 'client' && core.state.receiveAudio) {
            publish({ audioStatus: status, averageAudioBitrateKbps: null });
          }
        }
      );
    };
  }

  async function attachClientRemoteAudio(peer: PeerConnection): Promise<void> {
    if (core.clientPeer !== peer || !core.state.receiveAudio || !core.latestAudioAvailability.enabled) return;
    // Defensive re-arm: the readiness gate must not see the PREVIOUS track's
    // completed preroll (the audio message can arrive without a preceding
    // loading message). Only this attach's own cushion-build completion re-arms it.
    core.clientRemoteAudioReady = false;
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    const track = receiver?.track;
    if (!track || track.readyState === 'ended') return;
    track.enabled = true;
    const attachToken = ++clientAudioAttachToken;
    const bufferMs = effectiveAudioBufferMs();
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

    // TAIL WAIT (switch path): the previous track's retained tail (~bufferMs; a
    // target flush does NOT discard it) must be consumed by the DRAINED element
    // before the preroll takes over, or it sits at the front of the fresh
    // cushion and the audible start replays old audio.
    const drainStartedAt = streamedDrainStartedAt;
    streamedDrainStartedAt = null;
    const tailWaitMs = drainStartedAt === null
      ? 0
      : Math.max(0, bufferMs + STREAMED_RETAINED_TAIL_MARGIN_MS - (Date.now() - drainStartedAt));
    if (tailWaitMs > 0) {
      logDebug('multiplayer', 'Waiting out previous streamed tail', { ms: tailWaitMs });
      await new Promise((resolve) => window.setTimeout(resolve, tailWaitMs));
      if (bailIfSuperseded()) return;
    }

    // PREROLL — never start audible from an empty receiver buffer: the target
    // is a setpoint, and NetEq time-stretches toward it while consuming below
    // it (audible as a glitchy/slowed first ~1-2 s). Attach MUTED + out of the
    // graph (the receiver's sink — consumption runs NetEq's delay management),
    // build the cushion, play it out inaudibly, then route.
    //
    // Phase A — build: the element consumes silence (the host stays paused
    // until we report readiness) while NetEq holds back toward the target.
    // Level = DELTA between stats polls (the lifetime average never terminates);
    // after a tail wait the level is already at target, so this ends fast on
    // switches.
    applyClientAudioBuffer(peer);
    multiplayerAudioService.clearRemoteTrack();
    logDebug('multiplayer', 'Remote audio preroll start (cushion build)');
    const prerolled = await multiplayerAudioService.attachRemoteTrackPrerolled(
      track,
      new MediaStream([track]),
      statusHandler
    );
    if (!prerolled || bailIfSuperseded()) return;
    let cushion: ReceiverCushionResult = { levelMs: 0, reason: 'no-receiver' };
    if (bufferMs > 0) {
      cushion = await waitForReceiverCushion(peer, bufferMs);
      if (bailIfSuperseded()) return;
    }
    const builtLevelMs = cushion.levelMs;
    logDebug('multiplayer', 'Remote audio cushion built', {
      levelMs: Math.round(builtLevelMs),
      reason: cushion.reason,
      targetMs: bufferMs
    });
    // Cushion in place: release the host's playback-preparation gate. The
    // preroll element consumes the silence cushion at real time while the
    // track's beginning accumulates behind it — nothing audible yet.
    core.clientRemoteAudioReady = true;
    sendClientPlaybackReadyIfPossible(peer);
    // Phase B — play out the cushion (≈ level built in Phase A + element
    // latency) before routing, so the audible start begins at the track's start.
    // Scaling to the MEASURED level is what makes switches fast — they arrive
    // with the level already built and only the margin wait remains.
    if (bufferMs > 0) {
      // Floor the playout wait: a level reading of 0 (no receiver/stats) must
      // not collapse Phase B to nothing.
      const playoutMs = Math.max(builtLevelMs, Math.min(bufferMs, 350));
      logDebug('multiplayer', 'Remote audio playing out cushion', {
        ms: Math.round(playoutMs),
        levelMs: Math.round(builtLevelMs)
      });
      await new Promise((resolve) => window.setTimeout(resolve, playoutMs + STREAMED_RETAINED_TAIL_MARGIN_MS));
      if (bailIfSuperseded()) return;
    }
    // Phase C — audible. The element has been warm and the receiver at steady
    // state the whole time, so the first sample is clean. (The pre-route level
    // probe was removed — it added ~250 ms to every streamed start.)
    logDebug('multiplayer', 'Remote audio route connected (audible)');
    await multiplayerAudioService.connectRemoteRoute();
    void sampleReceiverRouteLevel(peer, 'route');
    void traceReceiverRouteLevel(peer);
  }

  /**
   * Bounded post-route level trace (diagnostic): polls the receiver level at
   * ~200 ms for 2 s after the route. A collapse right after routing = NetEq
   * stretching the AUDIBLE start; a steady level with garbled audio points at
   * the source node's startup window. One shot per attach.
   */
  async function traceReceiverRouteLevel(peer: PeerConnection): Promise<void> {
    try {
      const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
      if (!receiver) return;
      let previous: ReceiverPlayoutSample | null = null;
      const startedAt = Date.now();
      let tick = 0;
      while (Date.now() - startedAt < 2_000) {
        let level = 0;
        try {
          const stats = await receiver.getStats();
          for (const stat of stats.values()) {
            if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') continue;
            const { jitterBufferDelay = 0, jitterBufferEmittedCount = 0 } = stat as unknown as {
              jitterBufferDelay?: number;
              jitterBufferEmittedCount?: number;
            };
            const current: ReceiverPlayoutSample = { delay: jitterBufferDelay, emitted: jitterBufferEmittedCount };
            const delta = estimateReceiverPlayoutLevelMs(current, previous);
            if (delta > 0) level = delta;
            previous = current;
            break;
          }
        } catch {
          // Stats are optional.
        }
        if (tick % 2 === 0) {
          logDebug('multiplayer', 'Remote audio route trace', {
            tMs: Date.now() - startedAt,
            levelMs: Math.round(level),
            elementMs: Math.round(multiplayerAudioService.remoteElementPositionMs)
          });
        }
        tick += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 200));
      }
    } catch {
      // Diagnostics are best-effort.
    }
  }

  /**
   * One-shot receiver level probe around the audible route (diagnostic): two
   * stats polls ~250 ms apart give a delta level, logged right after the route
   * and again ~1 s later. Not on any per-tick path.
   */
  async function sampleReceiverRouteLevel(peer: PeerConnection, when: string): Promise<void> {
    try {
      const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
      if (!receiver) return;
      let previous: ReceiverPlayoutSample | null = null;
      let level = 0;
      for (let i = 0; i < 2; i++) {
        const stats = await receiver.getStats();
        for (const stat of stats.values()) {
          if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') continue;
          const { jitterBufferDelay = 0, jitterBufferEmittedCount = 0 } = stat as unknown as {
            jitterBufferDelay?: number;
            jitterBufferEmittedCount?: number;
          };
          const current: ReceiverPlayoutSample = { delay: jitterBufferDelay, emitted: jitterBufferEmittedCount };
          const delta = estimateReceiverPlayoutLevelMs(current, previous);
          if (delta > 0) level = delta;
          previous = current;
          break;
        }
        if (i === 0) await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      logDebug('multiplayer', 'Remote audio receiver level', {
        when,
        levelMs: Math.round(level),
        elementMs: Math.round(multiplayerAudioService.remoteElementPositionMs)
      });
    } catch {
      // Diagnostics are best-effort.
    }
  }

  /**
   * Builds the receiver's jitter-buffer cushion for the audible start. Level =
   * DELTA between consecutive stats polls (the lifetime average lags so badly
   * it never terminates and burns its whole cap). Exits only when the cushion
   * is REAL (see ReceiverCushionTracker): stable at target, or plateau at a
   * target-scaled floor; single-sample readings are never trusted. The total
   * budget is the last resort. Returns the smoothed level + exit reason.
   */
  async function waitForReceiverCushion(peer: PeerConnection, bufferMs: number): Promise<ReceiverCushionResult> {
    const receiver = peer.pc.getReceivers().find(({ track }) => track.kind === 'audio');
    if (!receiver) return { levelMs: 0, reason: 'no-receiver' };
    const targetMs = Math.max(0, Math.round(bufferMs));
    // NetEq converges toward ~80-85 % of the target; the plateau floor is a
    // target-scaled share of that, never below an absolute minimum, capped at
    // the asymptote so small targets stay reachable.
    const floorMs = Math.min(
      Math.max(STREAMED_PREROLL_MIN_LEVEL_MS, Math.round(targetMs * STREAMED_PREROLL_FLOOR_RATIO)),
      Math.round(targetMs * 0.85)
    );
    const stableTargetMs = Math.max(floorMs, Math.round(targetMs * STREAMED_PREROLL_LEVEL_RATIO));
    // Fast-poll window scales with the target; the slow-poll extension covers a
    // slow build; the total budget is the last resort.
    const fastPollCapMs = Math.min(4_000, Math.max(STREAMED_PREROLL_BUILD_CAP_MS, Math.round(targetMs + 1500)));
    const totalBudgetMs = fastPollCapMs + STREAMED_PREROLL_BUILD_CAP_EXTRA_MS;
    const startedAt = Date.now();
    let previous: ReceiverPlayoutSample | null = null;
    const tracker = new ReceiverCushionTracker();
    while (Date.now() - startedAt < totalBudgetMs) {
      const nowMs = Date.now();
      try {
        const stats = await receiver.getStats();
        for (const stat of stats.values()) {
          if (stat.type !== 'inbound-rtp' || stat.kind !== 'audio') continue;
          const { jitterBufferDelay = 0, jitterBufferEmittedCount = 0 } = stat as unknown as {
            jitterBufferDelay?: number;
            jitterBufferEmittedCount?: number;
          };
          const current: ReceiverPlayoutSample = {
            delay: jitterBufferDelay,
            emitted: jitterBufferEmittedCount
          };
          const deltaLevel = estimateReceiverPlayoutLevelMs(current, previous);
          previous = current;
          if (deltaLevel > 0) tracker.push(deltaLevel, nowMs);
          break;
        }
      } catch {
        // Stats are optional; keep polling.
      }
      if (tracker.isHoldingAtOrAbove(stableTargetMs)) {
        return { levelMs: tracker.levelMs, reason: 'stable' };
      }
      if (tracker.isPlateaued(floorMs, STREAMED_PREROLL_PLATEAU_MS, Date.now())) {
        return { levelMs: tracker.levelMs, reason: 'plateau' };
      }
      const elapsed = Date.now() - startedAt;
      const pollMs = elapsed < fastPollCapMs
        ? STREAMED_PREROLL_FAST_POLL_MS
        : STREAMED_PREROLL_SLOW_POLL_MS;
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }
    return { levelMs: tracker.levelMs, reason: 'budget' };
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
          logDebug('multiplayer', 'Source file transfer begin', {
            name: frame.name,
            bytes: frame.size
          });
          // Source-file phase: keep the element as a silent sink + cushion applied
          // (see the audio message handler). The transfer frame can arrive before the
          // audio message — drain and re-apply in both.
          multiplayerAudioService.drainRemoteTrack();
          applyClientAudioBuffer(peer);
          // Keep the current file audible until its replacement is fully received and
          // prepared: stopping the only active media element lets mobile Chromium
          // suspend a locked client before the remaining chunks can arrive.
          if (core.state.receiveAudio) publish({ audioStatus: 'connecting', averageAudioBitrateKbps: null });
          return;
        }
        if (!pending || pending.frame.transferId !== frame.transferId) return;
        const complete = pending;
        pending = null;
        if (complete.received !== complete.frame.size) {
          logWarning('multiplayer', 'Source file transfer incomplete', {
            name: complete.frame.name,
            received: complete.received,
            expected: complete.frame.size
          });
          publish({ audioStatus: 'unavailable' });
          return;
        }
        logInfo('multiplayer', 'Source file received', {
          name: complete.frame.name,
          bytes: complete.received
        });
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
    logInfo('multiplayer', 'Loading transferred source file', {
      trackId: pending.trackId,
      name: pending.file.name
    });
    void multiplayerSourcePlaybackService.loadFile(remoteTrack, pending.file).then((loaded) => {
      if (core.clientPeer !== peer || !core.state.receiveAudio) return;
      if (!loaded) {
        logWarning('multiplayer', 'Transferred source file playback failed', {
          trackId: pending.trackId
        });
      }
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

  function effectiveAudioBufferMs(): number {
    // The host's `buffer` message is authoritative while connected.
    return core.hostAudioBufferMs ?? core.multiplayerSettings.multiplayerAudioBufferMs;
  }

  function applyClientAudioBuffer(peer: PeerConnection): void {
    for (const receiver of peer.pc.getReceivers()) {
      if (receiver.track.kind !== 'audio') continue;
      setMultiplayerReceiverBuffer(receiver, effectiveAudioBufferMs());
    }
  }

  function setReceiveAudio(enabled: boolean): void {
    if (core.state.receiveAudio === enabled) return;
    logInfo('multiplayer', 'Receive audio', { enabled });
    writeReceiveAudioPreference(enabled);
    publish({ receiveAudio: enabled });
    if (core.state.mode !== 'client' || !core.clientPeer) return;
    warmClientAudioGraph();

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
      void (async () => {
        // A paired host that restarted publishes a fresh room; re-resolve the
        // directory so the reconnect follows the host instead of hammering a dead
        // room. Falls back to the last known code when the directory is unavailable.
        let targetCode = inviteCode;
        if (core.clientHostId) {
          const directoryRoom = await resolveDirectoryRoomCode(core.clientHostId);
          if (directoryRoom) targetCode = directoryRoom;
        }
        if (!core.allowClientReconnect || core.state.mode !== 'client') return;
        core.reconnectInFlight = true;
        core.reconnectAttempts += 1;
        logWarning('multiplayer', 'Reconnecting to host', {
          attempt: core.reconnectAttempts,
          delayMs: wait,
          inviteCode: targetCode
        });
        publish({
          connectionStatus: 'connecting',
          reconnecting: true,
          audioStatus: 'connecting',
          connectionDetail: 'Reconnecting and gathering fresh ICE candidates...',
          message: 'Reconnecting to the host...'
        });
        void connectClient(targetCode, true)
          .then(() => {
            core.reconnectInFlight = false;
            if (core.state.connectionStatus !== 'connected') scheduleClientReconnect(15_000);
          })
          .catch(() => {
            core.reconnectInFlight = false;
            scheduleClientReconnect();
          });
      })();
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
    // Every command originates in a UI tap — the reliable moment to start the
    // AudioContext (see warmClientAudioGraph), so the preroll's muted route is
    // genuinely warm by the time the streamed track arrives.
    warmClientAudioGraph();
    const completeCommand = {
      ...command,
      commandId: crypto.randomUUID()
    } as MultiplayerCommand;
    logDebug('multiplayer', 'Client command sent', { type: command.type });
    sendToPeer(core.clientPeer, { kind: 'command', command: completeCommand });
    // Freeplay shuffle/repeat flags live on the host per peer. The host applies
    // the identical toggle and no longer re-ships the catalog, so the client can
    // flip its button optimistically — deterministic, no drift.
    if (core.state.freeplay) {
      if (command.type === 'playlist.shuffle') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            shuffleEnabled: !core.state.remoteCatalog.shuffleEnabled
          }
        });
        persistFreeplayState();
      } else if (command.type === 'playlist.repeat') {
        publish({
          remoteCatalog: {
            ...core.state.remoteCatalog,
            repeatMode: cycleMultiplayerRepeatMode(core.state.remoteCatalog.repeatMode)
          }
        });
        persistFreeplayState();
      }
    }
    return true;
  }

  async function leave(): Promise<void> {
    if (core.state.mode !== 'client') return;
    logInfo('multiplayer', 'Client leaving session');
    core.allowClientReconnect = false;
    clearReconnectTimer();
    clearMultiplayerLastSession();
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
    restoreClientJoin,
    leave,
    sendCommand,
    setFreeplayQueue,
    setReceiveAudio,
    resumeAudio,
    applyClientAudioBuffer,
    handleClientResume,
    clearReceiverMonitor: () => receiverMonitor.clear(),
    // Session reset must also clear the streamed-attach closure state and
    // invalidate any in-flight preroll attach (stale streamedDrainStartedAt
    // would delay the next session's first attach; token bump bails pendings).
    resetStreamedAudioState: () => {
      streamedDrainStartedAt = null;
      clientAudioAttachToken += 1;
      freeplayResumeCandidate = null;
    },
    clearReconnectTimer
  };
}
