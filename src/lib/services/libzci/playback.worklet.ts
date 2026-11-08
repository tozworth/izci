import { BLOCK_FRAMES, POOL_SIZE, type WorkletBlock, type WorkletDecodeMessage } from './protocol';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

type AudioWasm = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  renderer_new(): number;
  renderer_free(pointer: number): void;
  renderer_input(pointer: number): number;
  renderer_output(pointer: number): number;
  renderer_reset(pointer: number, generation: number, position: number): void;
  renderer_settings(pointer: number, running: number, volume: number, mute: number, latency: number): void;
  renderer_replay_gain(pointer: number, gain: number): void;
  renderer_enqueue(
    pointer: number,
    id: number,
    generation: number,
    start: number,
    end: number,
    output: number,
    sourceRate: number,
    rate: number,
    frames: number
  ): number;
  renderer_eof(pointer: number, generation: number): void;
  renderer_process(pointer: number): void;
  renderer_recycled_count(pointer: number): number;
  renderer_recycled(pointer: number, index: number): number;
  renderer_position(pointer: number): number;
  renderer_media(pointer: number): number;
  renderer_consumed(pointer: number): number;
  renderer_silence(pointer: number): number;
  renderer_finished(pointer: number): number;
};

/**
 * Shared Rust renderer at the live output boundary. It consumes bounded PCM
 * blocks and owns audible position; the main document never supplies clock or
 * processing state from a UI timer.
 */
class LibzciOutput extends AudioWorkletProcessor {
  #wasm: AudioWasm;
  #pointer: number;
  #input: Float32Array;
  #samples: Float32Array;
  #buffers = new Map<number, ArrayBuffer>();
  #decode!: MessagePort;
  #control!: MessagePort;
  #generation = -1;
  #count = 0;
  #reportPending = false;
  #closed = false;
  #reportedFinished = false;
  #highWater = 0;
  #peak = 0;
  #energy = 0;
  #intervalPeak = 0;

  constructor(options: { processorOptions: { module: WebAssembly.Module } }) {
    super();
    this.#wasm = new WebAssembly.Instance(options.processorOptions.module, {}).exports as AudioWasm;
    this.#pointer = this.#wasm.renderer_new();
    this.#input = new Float32Array(this.#wasm.memory.buffer, this.#wasm.renderer_input(this.#pointer), BLOCK_FRAMES * 2);
    this.#samples = new Float32Array(this.#wasm.memory.buffer, this.#wasm.renderer_output(this.#pointer), 256);
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data.type !== 'attach') return;
      this.#decode = event.data.decode as MessagePort;
      this.#control = event.data.control as MessagePort;
      this.#decode.onmessage = (message) => this.#block(message.data as WorkletDecodeMessage);
      this.#control.onmessage = (message) => this.#command(message.data);
    };
  }

  #recycle(id: number): void {
    const pcm = this.#buffers.get(id);
    if (!pcm) return;
    this.#buffers.delete(id);
    this.#decode.postMessage({ type: 'recycle', id, pcm }, [pcm]);
  }

  #block(message: WorkletDecodeMessage): void {
    if (this.#closed) {
      if (message.type === 'block') this.#decode.postMessage({ type: 'recycle', id: message.id, pcm: message.pcm }, [message.pcm]);
      return;
    }
    if (message.type === 'eof') {
      this.#wasm.renderer_eof(this.#pointer, message.generation);
      return;
    }

    const descriptor = message.descriptor;
    if (message.id < 0 || message.id >= POOL_SIZE || this.#buffers.has(message.id) || message.pcm.byteLength !== BLOCK_FRAMES * 8) {
      this.#control.postMessage({ type: 'failed', detail: 'invalid worklet pool credit' });
      return;
    }
    this.#buffers.set(message.id, message.pcm);
    if (descriptor.generation !== this.#generation) {
      this.#recycle(message.id);
      return;
    }
    if (descriptor.frames < 1 || descriptor.frames > BLOCK_FRAMES || descriptor.rate !== sampleRate) {
      this.#recycle(message.id);
      this.#control.postMessage({ type: 'failed', detail: 'invalid output block' });
      return;
    }
    this.#input.set(new Float32Array(message.pcm, 0, descriptor.frames * 2));
    if (!this.#wasm.renderer_enqueue(
      this.#pointer,
      message.id,
      descriptor.generation,
      descriptor.source_start,
      descriptor.source_end,
      descriptor.output_start,
      descriptor.source_rate,
      descriptor.rate,
      descriptor.frames
    )) {
      this.#recycle(message.id);
      this.#control.postMessage({ type: 'failed', detail: 'worklet capacity exceeded' });
      return;
    }
    this.#highWater = Math.max(this.#highWater, this.#buffers.size);
  }

  #command(message: Record<string, unknown>): void {
    if (message.type === 'report-ack') {
      this.#reportPending = false;
      return;
    }
    if (message.type === 'close') {
      for (const id of this.#buffers.keys()) this.#recycle(id);
      this.#wasm.renderer_free(this.#pointer);
      this.#closed = true;
      return;
    }
    if (this.#closed) return;

    if (message.type === 'reset' || (message.type === 'anchor' && message.generation === this.#generation)) {
      this.#generation = Number(message.generation);
      this.#reportedFinished = false;
      this.#peak = 0;
      this.#energy = 0;
      this.#intervalPeak = 0;
      this.#highWater = 0;
      for (const id of this.#buffers.keys()) this.#recycle(id);
      this.#wasm.renderer_reset(this.#pointer, this.#generation, Number(message.position));
      this.#control.postMessage({ type: message.type === 'anchor' ? 'anchor-ack' : 'reset-ack', generation: this.#generation });
    } else if (message.type === 'settings' && message.generation === this.#generation) {
      this.#wasm.renderer_settings(
        this.#pointer,
        Number(message.running),
        Number(message.volume),
        Number(message.mute),
        Number(message.latency)
      );
      this.#wasm.renderer_replay_gain(this.#pointer, Number(message.replayGain));
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.#closed) return false;
    this.#wasm.renderer_process(this.#pointer);
    const channels = outputs[0]!;
    for (let index = 0; index < 128; index += 1) {
      channels[0]![index] = this.#samples[index * 2]!;
      channels[1]![index] = this.#samples[index * 2 + 1]!;
      const left = Math.abs(this.#samples[index * 2]!);
      const right = Math.abs(this.#samples[index * 2 + 1]!);
      this.#peak = Math.max(this.#peak, left, right);
      this.#energy += left * left + right * right;
      this.#intervalPeak = Math.max(this.#intervalPeak, left, right);
    }
    for (let index = 0; index < this.#wasm.renderer_recycled_count(this.#pointer); index += 1) {
      this.#recycle(this.#wasm.renderer_recycled(this.#pointer, index));
    }
    const finished = Boolean(this.#wasm.renderer_finished(this.#pointer));
    if (this.#control && !this.#reportPending && (++this.#count % 16 === 0 || (finished && !this.#reportedFinished))) {
      this.#reportPending = true;
      this.#reportedFinished = finished;
      this.#control.postMessage({
        type: 'report',
        generation: this.#generation,
        position: this.#wasm.renderer_position(this.#pointer),
        media: this.#wasm.renderer_media(this.#pointer),
        consumedFrames: this.#wasm.renderer_consumed(this.#pointer),
        observedAt: Date.now(),
        silence: this.#wasm.renderer_silence(this.#pointer),
        finished,
        queuedBlocks: this.#buffers.size,
        highWater: this.#highWater,
        peak: this.#peak,
        intervalPeak: this.#intervalPeak,
        energy: this.#energy,
        rate: sampleRate,
        audioHeapBytes: this.#wasm.memory.buffer.byteLength
      });
      this.#intervalPeak = 0;
    }
    return true;
  }
}

registerProcessor('libzci-output', LibzciOutput);
