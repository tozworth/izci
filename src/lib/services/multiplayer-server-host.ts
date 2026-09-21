/**
 * Server host room acquisition and signaling. Implements the Phase 2 host
 * exchange over HTTP + sockets: login, create/resume, ticket, socket auth,
 * peer.requested → accept/reject, offer → answer, candidates, connected,
 * release. Attempt-local connection IDs identify peers until the RTC hello
 * supplies identity/presentation.
 */
import {
  createServerSession,
  deleteServerRoom,
  deleteServerSession,
  createServerRoom,
  mintServerSocketTicket,
  resumeServerRoom,
  serverSocketUrl,
  sleepWithSignal,
  serverBackoffDelay,
  type ServerRoom
} from './multiplayer-server-http';
import {
  connectServerSocket,
  serverPayload,
  type ServerEnvelope,
  type ServerPeerRequestedPayload,
  type ServerSdpPayload,
  type ServerCandidatePayload,
  type ServerSocketHandle
} from './multiplayer-server-socket';

export interface ServerHostAcquiredRoom extends ServerRoom {
  endpoint: string;
  sessionToken: string;
}

export interface ServerHostEvents {
  onPeerRequested(connectionId: string, attemptId: string): void;
  onOffer(attemptId: string, sdp: string): void;
  onCandidate(attemptId: string, candidate: string, index: number, sdpMid: string, sdpMLineIndex: number): void;
  onCandidatesEnd(attemptId: string): void;
  onConnected(attemptId: string): void;
  onReleased(attemptId: string, reason: string): void;
  onError(envelope: ServerEnvelope): void;
  /** Signaling socket dropped; healthy RTC playback is untouched. */
  onSocketClose?(): void;
}

export interface ServerHostLink {
  readonly room: ServerHostAcquiredRoom;
  readonly socket: ServerSocketHandle;
  accept(attemptId: string): void;
  reject(attemptId: string): void;
  /** Release a reservation (kick, unpair cleanup); RTC teardown is separate. */
  release(attemptId: string): void;
  sendAnswer(attemptId: string, sdp: string): void;
  sendCandidate(attemptId: string, candidate: string, index: number, sdpMid: string, sdpMLineIndex: number): void;
  sendCandidatesEnd(attemptId: string): void;
  sendConnected(attemptId: string): void;
  dispose(): void;
}

export async function acquireServerHostRoom(
  endpoint: string,
  hostKey: string,
  capacity: number,
  options: {
    signal?: AbortSignal;
    resume?: { roomId: string; ownerSecret: string };
  } = {}
): Promise<ServerHostAcquiredRoom> {
  const session = await createServerSession(endpoint, hostKey.trim(), options.signal);
  try {
    return await acquireServerHostRoomWithSession(endpoint, session.sessionToken, capacity, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Best-effort logout when acquisition fails before handoff.
    try {
      await deleteServerSession(endpoint, session.sessionToken);
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }
}

/**
 * Acquire a room with a bearer the caller already owns (the setup
 * controller's login step). Ownership of the bearer moves to the returned
 * room on success; on failure the caller keeps it for logout/retry.
 */
export async function acquireServerHostRoomWithSession(
  endpoint: string,
  sessionToken: string,
  capacity: number,
  options: {
    signal?: AbortSignal;
    resume?: { roomId: string; ownerSecret: string };
  } = {}
): Promise<ServerHostAcquiredRoom> {
  if (options.resume) {
    await resumeServerRoom(
      endpoint,
      sessionToken,
      options.resume.roomId,
      options.resume.ownerSecret,
      options.signal
    );
    // Resume keeps the original invitation; the caller retains its copy.
    return {
      endpoint,
      sessionToken,
      roomId: options.resume.roomId,
      ownerSecret: options.resume.ownerSecret,
      invitationSecret: '',
      expiresAt: ''
    };
  }
  const room = await createServerRoom(endpoint, sessionToken, capacity, options.signal);
  return { endpoint, sessionToken, ...room };
}

export async function connectServerHost(
  room: ServerHostAcquiredRoom,
  events: ServerHostEvents,
  options: { signal?: AbortSignal } = {}
): Promise<ServerHostLink> {
  const ticket = await mintServerSocketTicket(room.endpoint, room.sessionToken, room.roomId, options.signal);
  let disposed = false;
  const listeners = new Set<(envelope: ServerEnvelope) => void>();
  const subscribe = (listener: (envelope: ServerEnvelope) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const socket = connectServerSocket(
    serverSocketUrl(room.endpoint),
    ticket.ticket,
    {
      onMessage(envelope) {
        if (disposed) return;
        dispatchHostEnvelope(envelope, events);
        for (const listener of [...listeners]) listener(envelope);
      },
      onClose() {
        // Reconnect is owned by the session layer so healthy RTC playback
        // survives signaling drops; this link just stops dispatching.
        if (!disposed) events.onSocketClose?.();
      },
      onError() {
        // Transport errors surface per-message; session decides on retry.
      }
    },
    { signal: options.signal }
  );

  // Wait for ready before returning so callers know auth succeeded. The
  // socket resolves ready internally; poll briefly for the bound role.
  await waitForHostReady(socket, subscribe, options.signal);

  const link: ServerHostLink = {
    room,
    socket,
    accept(attemptId) {
      socket.send('accept', undefined, attemptId);
    },
    reject(attemptId) {
      socket.send('reject', undefined, attemptId);
    },
    release(attemptId) {
      socket.send('release', undefined, attemptId);
    },
    sendAnswer(attemptId, sdp) {
      socket.send('answer', { sdp }, attemptId);
    },
    sendCandidate(attemptId, candidate, index, sdpMid, sdpMLineIndex) {
      socket.send('candidate', { candidate, index, sdpMid, sdpMLineIndex }, attemptId);
    },
    sendCandidatesEnd(attemptId) {
      socket.send('candidates-end', undefined, attemptId);
    },
    sendConnected(attemptId) {
      socket.send('connected', undefined, attemptId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      socket.dispose();
    }
  };
  options.signal?.addEventListener('abort', () => link.dispose(), { once: true });
  return link;
}

function dispatchHostEnvelope(envelope: ServerEnvelope, events: ServerHostEvents): void {
  switch (envelope.type) {
    case 'peer.requested': {
      const payload = serverPayload<ServerPeerRequestedPayload>(envelope);
      if (envelope.attemptId) events.onPeerRequested(payload.connectionId, envelope.attemptId);
      break;
    }
    case 'offer': {
      const payload = serverPayload<ServerSdpPayload>(envelope);
      if (envelope.attemptId) events.onOffer(envelope.attemptId, payload.sdp);
      break;
    }
    case 'candidate': {
      const payload = serverPayload<ServerCandidatePayload>(envelope);
      if (envelope.attemptId) {
        events.onCandidate(
          envelope.attemptId,
          payload.candidate,
          payload.index,
          payload.sdpMid,
          payload.sdpMLineIndex
        );
      }
      break;
    }
    case 'candidates-end': {
      if (envelope.attemptId) events.onCandidatesEnd(envelope.attemptId);
      break;
    }
    case 'peer.connected': {
      if (envelope.attemptId) events.onConnected(envelope.attemptId);
      break;
    }
    case 'peer.released': {
      const payload = serverPayload<{ reason?: string }>(envelope);
      if (envelope.attemptId) events.onReleased(envelope.attemptId, payload.reason ?? 'released');
      break;
    }
    case 'error': {
      events.onError(envelope);
      break;
    }
    default:
      break;
  }
}

function waitForHostReady(
  socket: ServerSocketHandle,
  subscribe: (listener: (envelope: ServerEnvelope) => void) => () => void,
  signal?: AbortSignal
): Promise<void> {
  if (socket.role) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Server host socket did not become ready.'));
    }, 8_000);
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe?.();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('aborted'));
    };
    let unsubscribe: (() => void) | null = subscribe((envelope) => {
      if (envelope.type !== 'ready') return;
      cleanup();
      resolve();
    });
    // The ready frame may have arrived before subscribe attached.
    if (socket.role) {
      cleanup();
      resolve();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function closeServerHostRoom(room: ServerHostAcquiredRoom): Promise<void> {
  try {
    await deleteServerRoom(room.endpoint, room.sessionToken, room.roomId);
  } finally {
    await deleteServerSession(room.endpoint, room.sessionToken).catch(() => undefined);
  }
}

/**
 * Reconnect host signaling with jittered backoff without touching RTC peers.
 * Bounded by the server's host reconnect grace (callers pass an AbortSignal
 * tied to that deadline). Returns a fresh link; the old link is disposed.
 */
export async function reconnectServerHost(
  room: ServerHostAcquiredRoom,
  events: ServerHostEvents,
  oldLink: ServerHostLink,
  options: { signal?: AbortSignal; maxAttempts?: number } = {}
): Promise<ServerHostLink> {
  oldLink.dispose();
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
    try {
      return await connectServerHost(room, events, { signal: options.signal });
    } catch (error) {
      lastError = error;
      await sleepWithSignal(serverBackoffDelay(attempt), options.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Server host reconnect failed.');
}
