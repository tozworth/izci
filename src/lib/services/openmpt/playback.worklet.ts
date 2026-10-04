import type { OpenMptCore } from './abi';
import { OpenMptModule } from './module';
import type { OpenMptCommand, OpenMptEvent, OpenMptProgress } from './protocol';
import { initializeOpenMpt } from './runtime';

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

export class OpenMptProcessor extends AudioWorkletProcessor {
  #core: OpenMptCore | undefined;
  #module: OpenMptModule | undefined;
  #playing = false;
  #ended = false;
  #disposed = false;
  #nextProgress = 0;
  #renderedFrames = 0;
  #lastProgress: OpenMptProgress | undefined;

  constructor(options: AudioWorkletNodeOptions = {}) {
    super();
    this.port.onmessage = (event: MessageEvent<OpenMptCommand>) => this.command(event.data);
    void initializeOpenMpt(options.processorOptions?.wasmBinary as ArrayBuffer).then((core) => {
      if (this.#disposed) return;
      this.#core = core;
      this.#post({ type: 'ready' });
    }).catch((error) => this.#error(error));
  }

  command(command: OpenMptCommand): void {
    if (this.#disposed) return;
    try {
      switch (command.type) {
        case 'load': {
          this.#playing = false;
          this.#module?.dispose();
          this.#module = undefined;
          if (!this.#core) throw new Error('libopenmpt is not initialized.');
          const module = new OpenMptModule(this.#core, command.buffer, command.subsong);
          this.#module = module;
          module.configure(command.settings);
          module.reserveFrames(128);
          this.#ended = false;
          this.#lastProgress = undefined;
          this.#post({ type: 'loaded', id: command.id, inspection: module.inspect() });
          this.#progress(true);
          break;
        }
        case 'play':
          if (!this.#module) return;
          if (this.#ended) this.#module.seek(0);
          this.#ended = false;
          this.#playing = true;
          break;
        case 'pause':
          this.#playing = false;
          this.#progress(true);
          break;
        case 'seek':
          this.#module?.seek(command.seconds);
          this.#ended = false;
          this.#progress(true);
          break;
        case 'subsong':
          if (!this.#module) return;
          this.#module.selectSubsong(command.subsong);
          this.#ended = false;
          this.#post({ type: 'metadata', inspection: this.#module.inspect() });
          this.#progress(true);
          break;
        case 'settings': this.#module?.configure(command.settings); break;
        case 'channels': this.#module?.setChannelMutes(command.muted); break;
        case 'dispose':
          this.#disposed = true;
          this.#playing = false;
          this.#module?.dispose();
          this.#module = undefined;
          this.#post({ type: 'disposed' });
          this.port.close();
          break;
      }
    } catch (error) {
      this.#error(error, command.type === 'load' ? command.id : undefined);
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (this.#disposed) return false;
    const [left, right] = outputs[0] ?? [];
    if (!left || !right || !this.#playing || !this.#module) return true;
    try {
      const frames = this.#module.read(sampleRate, left.length, (l, r) => { left.set(l); right.set(r); });
      this.#renderedFrames += frames;
      if (frames === 0) {
        this.#playing = false;
        this.#ended = true;
        this.#progress(true);
        this.#post({ type: 'ended' });
      } else this.#progress();
    } catch (error) {
      this.#error(error);
    }
    return true;
  }

  #progress(force = false): void {
    if (!this.#module) return;
    // At most 50 Hz, with a 125 ms clock update while a tracker row is unchanged.
    if (!force && this.#renderedFrames < this.#nextProgress) return;
    this.#nextProgress = this.#renderedFrames + sampleRate / 50;
    const progress = this.#module.progress();
    const previous = this.#lastProgress;
    if (!force && previous && progress.order === previous.order && progress.pattern === previous.pattern && progress.row === previous.row &&
      progress.subsong === previous.subsong && Math.abs(progress.currentTime - previous.currentTime) < 0.125) return;
    this.#lastProgress = progress;
    this.#post({ type: 'progress', progress });
  }

  #post(event: OpenMptEvent): void { this.port.postMessage(event); }
  #error(error: unknown, id?: number): void {
    this.#playing = false;
    this.#module?.dispose();
    this.#module = undefined;
    this.#post({ type: 'error', id, message: error instanceof Error ? error.message : 'Module playback failed.' });
  }
}

registerProcessor('izci-openmpt', OpenMptProcessor);
