import { Channel, invoke } from '@tauri-apps/api/core';
import type { BuiltinSignalingOptions, BuiltinSignalingReady, SignalingSocket } from '$lib/services/platform-signaling-types';

let builtinEndpoint: string | null = null;

export async function startBuiltinSignaling(options: BuiltinSignalingOptions): Promise<BuiltinSignalingReady> {
  const ready = await invoke<BuiltinSignalingReady>('start_builtin_signaling', { options });
  builtinEndpoint = ready.endpoint;
  return ready;
}

export async function stopBuiltinSignaling(endpoint?: string): Promise<void> {
  if (endpoint && endpoint !== builtinEndpoint) return;
  await invoke('stop_builtin_signaling', { endpoint });
  builtinEndpoint = null;
}

export function isBuiltinSignalingEndpoint(endpoint: string): boolean { return endpoint === builtinEndpoint; }

export async function fetchSignaling(url: string, init: RequestInit = {}): Promise<Response> {
  if (!url.startsWith('http:')) return fetch(url, init);
  const id = crypto.randomUUID();
  const signal = init.signal;
  signal?.throwIfAborted();
  const headers = new Headers(init.headers);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      void invoke('cancel_signaling_http', { id }).catch(() => undefined);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const response = await Promise.race([
      invoke<{ status: number; body: string; retryAfter: string | null }>('signaling_http', {
        request: {
          id, url, method: init.method ?? 'GET', body: init.body ?? null,
          bearer: headers.get('Authorization')?.replace(/^Bearer /, '') ?? null
        }
      }), cancelled
    ]);
    signal?.throwIfAborted();
    return new Response(response.status === 204 ? null : response.body, {
      status: response.status,
      headers: response.retryAfter ? { 'Retry-After': response.retryAfter } : {}
    });
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

class NativeSignalingSocket extends EventTarget {
  readonly id = crypto.randomUUID();
  readyState: number = WebSocket.CONNECTING;
  private opening: Promise<void>;
  private writes = Promise.resolve();

  constructor(url: string) {
    super();
    const events = new Channel<{ type: string; data?: string; code?: number; reason?: string }>();
    events.onmessage = (event) => {
      if (event.type === 'close') {
        this.readyState = WebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code: event.code, reason: event.reason }));
      } else if (this.readyState < WebSocket.CLOSING) {
        if (event.type === 'open') this.readyState = WebSocket.OPEN;
        this.dispatchEvent(event.type === 'message'
          ? new MessageEvent('message', { data: event.data }) : new Event(event.type));
      }
    };
    this.opening = invoke<void>('open_signaling_socket', { id: this.id, url, events });
    void this.opening.catch(() => {
      this.dispatchEvent(new Event('error'));
      this.readyState = WebSocket.CLOSED;
      this.dispatchEvent(new CloseEvent('close', { code: 1006 }));
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN || typeof data !== 'string') throw new Error('Signaling socket is not open.');
    this.enqueue(data);
  }

  private enqueue(text: string | null): void {
    this.writes = this.writes.then(() => this.opening)
      .then(() => invoke<void>('send_signaling_socket', { id: this.id, text }))
      .catch(() => {
        if (this.readyState < WebSocket.CLOSING) {
          this.dispatchEvent(new Event('error'));
          this.close();
        }
      });
  }

  close(_code?: number, _reason?: string): void {
    if (this.readyState >= WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    this.enqueue(null);
  }
}

export function createSignalingSocket(url: string): SignalingSocket {
  return url.startsWith('ws:') ? new NativeSignalingSocket(url) as SignalingSocket : new WebSocket(url);
}
