import workletUrl from './playback.worklet.ts?worker&url';
import audioWasmUrl from '../../../../libzci/generated/libzci_audio_web.wasm?url';
import { audioBusService } from '$lib/services/audio-bus';
import type {
  WorkerMessage,
  WorkerRequest,
  WorkerResultMessage,
  WorkerSnapshotMessage
} from './protocol';

/**
 * Single import site for the production Svelte bridge's generated libzci
 * browser assets. These files are built by
 * `libzci/consumers/crude-pwa/scripts/build-wasm.py` (plus the browser
 * codec/module recipes) into the workspace's ignored `libzci/generated/`
 * directory and bundled into the Svelte shells from here.
 */
export const LIBZCI_WORKLET_URL: string = workletUrl;
export const LIBZCI_AUDIO_WASM_URL: string = audioWasmUrl;

const workletLoads = new WeakMap<AudioContext, Promise<void>>();

/** Shared AudioWorklet module registration, cached per AudioContext. */
export function ensureLibzciWorklet(context: AudioContext): Promise<void> {
  let pending = workletLoads.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(LIBZCI_WORKLET_URL).catch((error) => {
      workletLoads.delete(context);
      throw error;
    });
    workletLoads.set(context, pending);
  }
  return pending;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Request/response multiplexer for one engine-worker link. Extracted so the
 * routing is unit-testable without a Worker or AudioContext.
 */
export class EngineRequestTable {
  #pending = new Map<string, PendingRequest>();

  get size(): number {
    return this.#pending.size;
  }

  add(id: string, pending: PendingRequest): void {
    this.#pending.set(id, pending);
  }

  resolve(id: string, value: unknown): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    pending.resolve(value);
    return true;
  }

  reject(id: string, error: Error): boolean {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    pending.reject(error);
    return true;
  }

  rejectAll(error: Error): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const request of pending) request.reject(error);
  }
}

export interface EngineSnapshotHandlers {
  onSnapshot: (message: WorkerSnapshotMessage) => void;
  onError: (error: Error) => void;
}

export interface EngineLink {
  readonly worker: Worker;
  readonly node: AudioWorkletNode;
  request<T = unknown>(message: Extract<WorkerRequest, { request: string }>): Promise<T>;
  /** Forward the current AudioContext state to the worker. */
  notifyContextState(): void;
  close(): void;
}

/**
 * Owns one libzci browser engine attachment: a dedicated decode/control
 * worker pair plus the shared audio-only worklet node on the shared bus
 * context. Player services keep their metadata/pattern/settings mapping;
 * this link owns only bootstrapping, request multiplexing and teardown.
 */
export async function createLibzciEngineLink(
  context: AudioContext,
  handlers: EngineSnapshotHandlers,
  label: string
): Promise<EngineLink> {
  await ensureLibzciWorklet(context);
  const response = await fetch(LIBZCI_AUDIO_WASM_URL);
  if (!response.ok) throw new Error(`libzci audio WASM HTTP ${response.status}`);
  const module = await WebAssembly.compileStreaming(response);
  // Keep the `new URL(..., import.meta.url)` inline so Vite still emits the
  // worker chunk for this call site.
  const worker = new Worker(new URL('./playback.worker.ts', import.meta.url), { type: 'module' });
  const node = new AudioWorkletNode(context, 'libzci-output', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { module }
  });
  const table = new EngineRequestTable();
  const decode = new MessageChannel();
  const control = new MessageChannel();
  let closed = false;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const reportError = (error: Error): void => {
    if (!closed) handlers.onError(error);
  };

  const failAll = (error: Error): void => {
    table.rejectAll(error);
  };

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;
    if (message.type === 'ready') {
      readySettled = true;
      resolveReady();
      return;
    }
    if (message.type === 'result') {
      const result = message as WorkerResultMessage;
      if (result.error) table.reject(result.request, new Error(result.error));
      else table.resolve(result.request, result.value);
      return;
    }
    if (message.type === 'snapshot') {
      handlers.onSnapshot(message as WorkerSnapshotMessage);
      return;
    }
    if (message.type === 'error') {
      const error = new Error(message.detail);
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      reportError(error);
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || `libzci ${label} worker failed`);
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    failAll(error);
    reportError(error);
  };
  node.onprocessorerror = () => reportError(new Error(`libzci ${label} processor failed`));
  node.port.postMessage(
    { type: 'attach', control: control.port2, decode: decode.port2 },
    [control.port2, decode.port2]
  );
  const latency = (context.baseLatency + (context.outputLatency ?? 0)) * context.sampleRate;
  worker.postMessage(
    {
      type: 'init',
      rate: context.sampleRate,
      latency,
      control: control.port1,
      decode: decode.port1
    } satisfies WorkerRequest,
    [control.port1, decode.port1]
  );

  const notifyContextState = (): void => {
    if (closed) return;
    worker.postMessage({ type: 'context', state: context.state } satisfies WorkerRequest);
  };
  context.addEventListener('statechange', notifyContextState);

  try {
    await ready;
  } catch (error) {
    context.removeEventListener('statechange', notifyContextState);
    worker.terminate();
    throw error;
  }

  return {
    worker,
    node,
    request<T = unknown>(message: Extract<WorkerRequest, { request: string }>): Promise<T> {
      if (closed) return Promise.reject(new Error(`libzci ${label} is closed`));
      return new Promise<T>((resolve, reject) => {
        table.add(message.request, {
          resolve: (value) => resolve(value as T),
          reject
        });
        worker.postMessage(message);
      });
    },
    notifyContextState,
    close(): void {
      if (closed) return;
      closed = true;
      failAll(new Error(`libzci ${label} closed`));
      context.removeEventListener('statechange', notifyContextState);
      try {
        worker.postMessage({ type: 'close' } satisfies WorkerRequest);
      } catch {
        // Terminating below still releases the worker.
      }
      // Give the worker one task turn to tell the worklet to release
      // renderer memory before terminating the shared port pair.
      setTimeout(() => worker.terminate(), 50);
    }
  };
}
