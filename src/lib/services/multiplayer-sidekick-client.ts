/**
 * Sidekick guest connection: join, socket auth, accept → offer → answer,
 * candidates, connected, release. Uses AbortSignal for the whole attempt;
 * cancellation/server switch disposes subscriptions, timers, sockets, and
 * pending work before new results attach. Attempt ownership is checked after
 * every await so late callbacks cannot mutate the current session. A new
 * negotiation gets a fresh attempt ID via re-join.
 */
import { createSidekickNonce } from './multiplayer-sidekick-protocol';
import {
  joinSidekickRoom,
  mintSidekickSocketTicket,
  sidekickSocketUrl,
  sleepWithSignal,
  sidekickBackoffDelay
} from './multiplayer-sidekick-http';
import {
  connectSidekickSocket,
  sidekickPayload,
  type SidekickCandidatePayload,
  type SidekickEnvelope,
  type SidekickSdpPayload,
  type SidekickSocketHandle
} from './multiplayer-sidekick-socket';

export interface SidekickGuestEvents {
  onAccepted(attemptId: string): void;
  onRejected(attemptId: string, reason: string): void;
  onAnswer(attemptId: string, sdp: string): void;
  onCandidate(attemptId: string, candidate: string, index: number, sdpMid: string, sdpMLineIndex: number): void;
  onCandidatesEnd(attemptId: string): void;
  onConnected(attemptId: string): void;
  onReleased(attemptId: string, reason: string): void;
  onError(envelope: SidekickEnvelope): void;
  /** Signaling socket dropped; healthy RTC playback is untouched. */
  onSocketClose?(): void;
}

export interface SidekickGuestConnection {
  readonly endpoint: string;
  readonly roomId: string;
  readonly attemptId: string;
  readonly connectionId: string;
  readonly connectionToken: string;
  readonly socket: SidekickSocketHandle;
  sendOffer(sdp: string): void;
  sendCandidate(candidate: string, index: number, sdpMid: string, sdpMLineIndex: number): void;
  sendCandidatesEnd(): void;
  sendConnected(): void;
  sendRelease(): void;
  /** Re-mint a socket ticket and reconnect signaling; RTC stays untouched. */
  reconnectSignaling(signal?: AbortSignal): Promise<void>;
  dispose(): void;
}

export async function connectSidekickGuest(
  endpoint: string,
  roomId: string,
  invitationSecret: string,
  events: SidekickGuestEvents,
  options: { signal?: AbortSignal; attemptNonce?: string } = {}
): Promise<SidekickGuestConnection> {
  const attemptNonce = options.attemptNonce ?? createSidekickNonce();
  const join = await joinSidekickRoom(endpoint, roomId, invitationSecret, attemptNonce, options.signal);
  const generation = { current: true };
  const signal = options.signal;
  let disposed = false;
  let socket: SidekickSocketHandle | null = null;

  const checkOwned = (): boolean => generation.current && !disposed && !signal?.aborted;

  function dispatch(envelope: SidekickEnvelope): void {
    if (!checkOwned()) return;
    // Guest sockets are scoped to their own connection; ignore stale attempts.
    if (envelope.attemptId && envelope.attemptId !== join.attemptId) return;
    switch (envelope.type) {
      case 'peer.accepted': {
        if (envelope.attemptId) events.onAccepted(envelope.attemptId);
        break;
      }
      case 'peer.rejected': {
        const payload = sidekickPayload<{ reason?: string }>(envelope);
        if (envelope.attemptId) events.onRejected(envelope.attemptId, payload.reason ?? 'rejected');
        break;
      }
      case 'answer': {
        const payload = sidekickPayload<SidekickSdpPayload>(envelope);
        if (envelope.attemptId) events.onAnswer(envelope.attemptId, payload.sdp);
        break;
      }
      case 'candidate': {
        const payload = sidekickPayload<SidekickCandidatePayload>(envelope);
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
        const payload = sidekickPayload<{ reason?: string }>(envelope);
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

  async function openSocket(ticket: string): Promise<SidekickSocketHandle> {
    return new Promise((resolve, reject) => {
      if (!checkOwned()) {
        reject(signal?.reason ?? new Error('aborted'));
        return;
      }
      const handle = connectSidekickSocket(
        sidekickSocketUrl(endpoint),
        ticket,
        {
          onMessage: dispatch,
          onClose: () => {
            // Signaling drops do not tear down RTC; the session layer
            // decides whether to reconnect via reconnectSignaling().
            if (checkOwned()) events.onSocketClose?.();
          },
          onError: () => undefined
        },
        { signal }
      );
      // Wait for the bound role before resolving; auth failures reject.
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Sidekick guest socket did not become ready.'));
      }, 8_000);
      const poll = setInterval(() => {
        if (handle.role) {
          cleanup();
          resolve(handle);
        }
      }, 25);
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(poll);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        try {
          handle.dispose();
        } catch {
          // Ignore.
        }
        reject(signal?.reason ?? new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      // Immediate check in case ready already arrived.
      if (handle.role) {
        cleanup();
        resolve(handle);
      }
    });
  }

  socket = await openSocket(join.socketTicket);
  if (!checkOwned()) {
    socket.dispose();
    throw signal?.reason ?? new Error('aborted');
  }

  const connection: SidekickGuestConnection = {
    endpoint,
    roomId,
    attemptId: join.attemptId,
    connectionId: join.connectionId,
    connectionToken: join.connectionToken,
    get socket() {
      // Reconnected sockets replace this binding.
      return socket as SidekickSocketHandle;
    },
    sendOffer(sdp) {
      socket?.send('offer', { sdp }, join.attemptId);
    },
    sendCandidate(candidate, index, sdpMid, sdpMLineIndex) {
      socket?.send('candidate', { candidate, index, sdpMid, sdpMLineIndex }, join.attemptId);
    },
    sendCandidatesEnd() {
      socket?.send('candidates-end', undefined, join.attemptId);
    },
    sendConnected() {
      socket?.send('connected', undefined, join.attemptId);
    },
    sendRelease() {
      socket?.send('release', undefined, join.attemptId);
    },
    async reconnectSignaling(reconnectSignal?: AbortSignal) {
      if (disposed) throw new Error('Sidekick guest connection is disposed.');
      // Transient retry with jittered backoff, bounded by the attempt
      // deadline owned by the caller's signal.
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const combined = reconnectSignal ?? signal;
        if (combined?.aborted) throw combined.reason ?? new Error('aborted');
        try {
          const fresh = await mintSidekickSocketTicket(
            endpoint,
            join.connectionToken,
            null,
            combined
          );
          if (!checkOwned()) throw combined?.reason ?? new Error('aborted');
          const next = await openSocket(fresh.ticket);
          if (!checkOwned()) {
            next.dispose();
            throw combined?.reason ?? new Error('aborted');
          }
          socket?.dispose();
          socket = next;
          return;
        } catch (error) {
          lastError = error;
          await sleepWithSignal(sidekickBackoffDelay(attempt), combined);
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Sidekick signaling reconnect failed.');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation.current = false;
      try {
        socket?.dispose();
      } catch {
        // Ignore.
      }
      socket = null;
    }
  };
  signal?.addEventListener('abort', () => connection.dispose(), { once: true });
  return connection;
}
