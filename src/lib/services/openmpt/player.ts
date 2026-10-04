import workletUrl from './playback.worklet.ts?worker&url';
import { loadOpenMptBytes } from './assets';
import type { OpenMptCommand, OpenMptEvent, OpenMptInspection, OpenMptProgress, OpenMptSettings } from './protocol';

const workletLoads = new WeakMap<AudioContext, Promise<void>>();
const TIMEOUT_MS = 10_000;

function ensureWorklet(context: AudioContext): Promise<void> {
  let pending = workletLoads.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule(workletUrl).catch((error) => {
      workletLoads.delete(context);
      throw error;
    });
    workletLoads.set(context, pending);
  }
  return pending;
}

interface PlayerHandlers {
  metadata?(inspection: OpenMptInspection): void;
  progress?(progress: OpenMptProgress): void;
  ended?(): void;
  error?(message: string): void;
}

export class OpenMptPlayer {
  readonly context: AudioContext;
  readonly gain: GainNode;
  readonly node: AudioWorkletNode;
  handlers: PlayerHandlers = {};
  duration = 0;
  #disposed = false;
  #id = 0;
  #pending = new Map<number, { resolve(value: OpenMptInspection): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  #ready: { resolve(): void; reject(error: Error): void } | undefined;

  private constructor(context: AudioContext, bytes: ArrayBuffer) {
    this.context = context;
    this.gain = context.createGain();
    this.node = new AudioWorkletNode(context, 'izci-openmpt', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasmBinary: bytes }
    });
    this.node.connect(this.gain);
    this.node.port.onmessage = (event: MessageEvent<OpenMptEvent>) => this.#receive(event.data);
    this.node.onprocessorerror = () => this.#fail('The libopenmpt audio processor failed.');
  }

  static async create(context: AudioContext): Promise<OpenMptPlayer> {
    let assetTimer: ReturnType<typeof setTimeout> | undefined;
    const [bytes] = await Promise.race([
      Promise.all([loadOpenMptBytes(), ensureWorklet(context)]),
      new Promise<never>((_resolve, reject) => {
        assetTimer = setTimeout(() => reject(new Error('libopenmpt runtime loading timed out.')), TIMEOUT_MS);
      })
    ]).finally(() => clearTimeout(assetTimer));
    const player = new OpenMptPlayer(context, bytes);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        player.#ready = { resolve, reject };
        timer = setTimeout(() => reject(new Error('libopenmpt AudioWorklet initialization timed out.')), TIMEOUT_MS);
      });
      return player;
    } catch (error) {
      player.dispose();
      throw error;
    } finally {
      clearTimeout(timer);
      player.#ready = undefined;
    }
  }

  load(buffer: ArrayBuffer, subsong: number, settings: OpenMptSettings): Promise<OpenMptInspection> {
    if (this.#disposed) return Promise.reject(new Error('Module player disposed.'));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('Module loading timed out.'));
        this.dispose();
      }, TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      try { this.node.port.postMessage({ type: 'load', id, buffer, subsong, settings } satisfies OpenMptCommand, [buffer]); }
      catch (error) { clearTimeout(timer); this.#pending.delete(id); reject(error); }
    });
  }

  play(): void { this.#send({ type: 'play' }); }
  pause(): void { this.#send({ type: 'pause' }); }
  seek(seconds: number): void { this.#send({ type: 'seek', seconds }); }
  selectSubsong(subsong: number): void { this.#send({ type: 'subsong', subsong }); }
  configure(settings: OpenMptSettings): void { this.#send({ type: 'settings', settings }); }
  setChannelMutes(muted: boolean[]): void { this.#send({ type: 'channels', muted }); }

  #send(command: OpenMptCommand): void {
    if (!this.#disposed) this.node.port.postMessage(command);
  }

  #receive(event: OpenMptEvent): void {
    if (event.type === 'disposed') { this.#close(); return; }
    if (this.#disposed) return;
    switch (event.type) {
      case 'ready': this.#ready?.resolve(); break;
      case 'loaded': {
        this.duration = event.inspection.metadata.duration ?? 0;
        const request = this.#pending.get(event.id);
        if (request) { clearTimeout(request.timer); this.#pending.delete(event.id); request.resolve(event.inspection); }
        break;
      }
      case 'metadata':
        this.duration = event.inspection.metadata.duration ?? 0;
        this.handlers.metadata?.(event.inspection);
        break;
      case 'progress': this.handlers.progress?.(event.progress); break;
      case 'ended': this.handlers.ended?.(); break;
      case 'error': this.#fail(event.message); break;
    }
  }

  #fail(message: string): void {
    const error = new Error(message);
    this.#rejectPending(error);
    this.handlers.error?.(message);
    this.dispose();
  }

  #rejectPending(error: Error): void {
    this.#ready?.reject(error);
    for (const request of this.#pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.#pending.clear();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.handlers = {};
    this.#rejectPending(new Error('Module player disposed.'));
    this.gain.disconnect();
    // Keep the port alive until WASM ownership is released on the audio thread.
    this.node.port.postMessage({ type: 'dispose' } satisfies OpenMptCommand);
    const timer = setTimeout(() => this.#close(), TIMEOUT_MS);
    const previous = this.node.port.onmessage;
    this.node.port.onmessage = (event) => {
      if ((event.data as OpenMptEvent).type === 'disposed') clearTimeout(timer);
      previous?.call(this.node.port, event);
    };
  }

  #close(): void {
    this.node.disconnect();
    this.node.port.onmessage = null;
    this.node.onprocessorerror = null;
    this.node.port.close();
  }
}
