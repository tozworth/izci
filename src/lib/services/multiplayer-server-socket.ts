/**
 * Server WebSocket transport: authenticates with a one-use ticket in the
 * first frame, then exchanges the Phase 2 signaling messages. Client routing
 * claims are ignored; role/room/connection bindings come from the server's
 * ready frame. Each socket has one logical reader; writes go straight to the
 * underlying socket. Callers dispose the handle on cancellation/server switch
 * before attaching new results.
 */
import {
  createServerRequestId,
  decodeServerMessage,
  encodeServerMessage,
  type ServerCandidatePayload,
  type ServerEnvelope,
  type ServerErrorPayload,
  type ServerMessageType,
  type ServerPeerRejectedPayload,
  type ServerPeerRequestedPayload,
  type ServerReadyPayload,
  type ServerSdpPayload
} from './multiplayer-server-protocol';

export type ServerSocketFactory = (url: string) => WebSocket;

const DEFAULT_SOCKET_FACTORY: ServerSocketFactory = (url) => new WebSocket(url);

export interface ServerSocketEvents {
  onMessage(envelope: ServerEnvelope): void;
  onClose(event: { code: number; reason: string }): void;
  onError?(error: unknown): void;
}

export interface ServerSocketHandle {
  readonly role: 'host' | 'guest' | null;
  readonly roomId: string | null;
  readonly connectionId: string | null;
  send(
    type: 'accept' | 'reject' | 'offer' | 'answer' | 'candidate' | 'candidates-end' | 'connected' | 'release',
    payload?: Record<string, unknown>,
    attemptId?: string
  ): void;
  close(code?: number, reason?: string): void;
  dispose(): void;
}

interface PendingReady {
  resolve: (ready: ServerReadyPayload) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function connectServerSocket(
  socketUrl: string,
  ticket: string,
  events: ServerSocketEvents,
  options: {
    signal?: AbortSignal;
    factory?: ServerSocketFactory;
    authTimeoutMs?: number;
  } = {}
): ServerSocketHandle {
  const factory = options.factory ?? DEFAULT_SOCKET_FACTORY;
  const authTimeoutMs = options.authTimeoutMs ?? 5_000;
  const ws = factory(socketUrl);
  let role: 'host' | 'guest' | null = null;
  let roomId: string | null = null;
  let connectionId: string | null = null;
  let disposed = false;
  let readySettled = false;
  let pendingReady: PendingReady | null = null;

  const readyPromise = new Promise<ServerReadyPayload>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (readySettled) return;
      readySettled = true;
      reject(new Error('Server socket authentication timed out.'));
      try {
        ws.close(4000, 'auth timeout');
      } catch {
        // Ignore close failures during timeout handling.
      }
    }, authTimeoutMs);
    pendingReady = { resolve, reject, timer };
  });
  void readyPromise.then(
    () => undefined,
    () => undefined
  );

  function settleReadyError(error: Error): void {
    if (readySettled || !pendingReady) return;
    readySettled = true;
    clearTimeout(pendingReady.timer);
    pendingReady.reject(error);
    pendingReady = null;
  }

  function settleReadyOk(ready: ServerReadyPayload): void {
    if (readySettled || !pendingReady) return;
    readySettled = true;
    clearTimeout(pendingReady.timer);
    pendingReady.resolve(ready);
    pendingReady = null;
  }

  ws.addEventListener('open', () => {
    if (disposed || options.signal?.aborted) {
      try {
        ws.close(4000, 'disposed');
      } catch {
        // Ignore.
      }
      return;
    }
    try {
      ws.send(encodeServerMessage('auth', createServerRequestId('req-auth'), { ticket }));
    } catch (error) {
      events.onError?.(error);
    }
  });

  ws.addEventListener('message', (event) => {
    const data = typeof event.data === 'string' ? event.data : String(event.data ?? '');
    const decoded = decodeServerMessage(data);
    if (!decoded.ok) {
      events.onError?.(new Error(`server: ${decoded.code}`));
      return;
    }
    const envelope = decoded.envelope;
    if (!readySettled) {
      if (envelope.type === 'ready') {
        const payload = envelope.payload as unknown as ServerReadyPayload;
        role = payload.role;
        roomId = payload.roomId;
        connectionId = payload.connectionId ?? null;
        settleReadyOk(payload);
        events.onMessage(envelope);
        return;
      }
      if (envelope.type === 'error') {
        const payload = envelope.payload as unknown as ServerErrorPayload;
        settleReadyError(new Error(payload.code ?? 'unauthorized'));
        events.onMessage(envelope);
        return;
      }
      settleReadyError(new Error('Server socket expected a ready frame.'));
      events.onMessage(envelope);
      return;
    }
    events.onMessage(envelope);
  });

  const handleClose = (event: Event) => {
    const closeEvent = event as Partial<CloseEvent>;
    const code = typeof closeEvent.code === 'number' ? closeEvent.code : 1006;
    const reason = typeof closeEvent.reason === 'string' ? closeEvent.reason : '';
    if (!readySettled) settleReadyError(new Error('Server socket closed before ready.'));
    if (!disposed) events.onClose({ code, reason });
  };
  ws.addEventListener('close', handleClose);
  ws.addEventListener('error', (event) => {
    events.onError?.(event);
  });

  const onAbort = () => {
    handle.dispose();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  const handle: ServerSocketHandle = {
    get role() {
      return role;
    },
    get roomId() {
      return roomId;
    },
    get connectionId() {
      return connectionId;
    },
    send(type, payload, attemptId) {
      if (disposed) return;
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(encodeServerMessage(type, createServerRequestId('req'), payload, attemptId));
    },
    close(code = 1000, reason = '') {
      try {
        ws.close(code, reason);
      } catch {
        // Ignore close failures.
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      options.signal?.removeEventListener('abort', onAbort);
      if (!readySettled) settleReadyError(new Error('aborted'));
      try {
        ws.close(1000, 'disposed');
      } catch {
        // Ignore.
      }
    }
  };
  return handle;
}

export function serverPayload<T>(envelope: ServerEnvelope): T {
  return (envelope.payload ?? {}) as T;
}

export type {
  ServerEnvelope,
  ServerMessageType,
  ServerReadyPayload,
  ServerPeerRequestedPayload,
  ServerPeerRejectedPayload,
  ServerSdpPayload,
  ServerCandidatePayload,
  ServerErrorPayload
};

/** Wait for a single message matching a predicate, bounded by a timeout. */
export function waitForServerMessage(
  subscribe: (listener: (envelope: ServerEnvelope) => void) => () => void,
  match: (envelope: ServerEnvelope) => boolean,
  options: { signal?: AbortSignal; timeoutMs?: number; label?: string } = {}
): Promise<ServerEnvelope> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      unsubscribe?.();
      unsubscribe = null;
      options.signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(options.signal?.reason ?? new Error(`aborted while waiting for ${options.label ?? 'message'}`));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${options.label ?? 'server message'}.`));
    }, timeoutMs);
    unsubscribe = subscribe((envelope) => {
      if (!match(envelope)) return;
      cleanup();
      resolve(envelope);
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
