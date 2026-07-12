import { visualizerService } from '$lib/services/visualizer';

type AudioBusSource = AudioNode | MediaElementAudioSourceNode;

export class AudioBusService {
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #output: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #activeSource: AudioBusSource | null = null;
  #mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  get context(): AudioContext {
    this.#ensureGraph();
    return this.#context as AudioContext;
  }

  connectHtmlMediaElement(element: HTMLMediaElement | null): MediaElementAudioSourceNode | null {
    if (!element) {
      return null;
    }

    this.#ensureGraph();

    try {
      let source = this.#mediaSources.get(element);

      if (!source) {
        source = this.context.createMediaElementSource(element);
        this.#mediaSources.set(element, source);
      }

      this.#connectSource(source);
      return source;
    } catch {
      // If Web Audio cannot adopt the element, leave Howler's native output untouched.
      return null;
    }
  }

  connectAudioNode(node: AudioNode | null): AudioNode | null {
    if (!node) {
      return null;
    }

    this.#ensureGraph();

    if (node.context !== this.#context) {
      throw new Error('Audio bus sources must use the shared AudioContext.');
    }

    this.#connectSource(node);
    return node;
  }

  disconnect(source: AudioBusSource | null): void {
    if (!source || source !== this.#activeSource || !this.#input) {
      return;
    }

    try {
      source.disconnect(this.#input);
    } catch {
      // The source owner may already have disconnected it during teardown.
    }

    this.#activeSource = null;
  }

  resume(): void {
    if (this.#context?.state === 'suspended') {
      void this.#context.resume().catch(() => undefined);
    }
  }

  destroy(): void {
    this.disconnect(this.#activeSource);
    visualizerService.clear();

    try {
      this.#input?.disconnect();
      this.#output?.disconnect();
      this.#analyser?.disconnect();
    } catch {
      // Ignore graph teardown races during window shutdown.
    }

    const context = this.#context;

    this.#context = null;
    this.#input = null;
    this.#output = null;
    this.#analyser = null;
    this.#mediaSources = new WeakMap();

    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  #connectSource(source: AudioBusSource): void {
    if (source === this.#activeSource || !this.#input) {
      return;
    }

    this.disconnect(this.#activeSource);
    source.connect(this.#input);
    this.#activeSource = source;
  }

  #ensureGraph(): void {
    if (this.#context) {
      return;
    }

    if (typeof window === 'undefined') {
      throw new Error('The audio bus is only available in a browser window.');
    }

    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      throw new Error('Web Audio is unavailable in this browser.');
    }

    const context = new AudioContextConstructor();
    const input = context.createGain();
    const output = context.createGain();
    const analyser = context.createAnalyser();

    input.connect(output);
    output.connect(analyser);
    analyser.connect(context.destination);

    this.#context = context;
    this.#input = input;
    this.#output = output;
    this.#analyser = analyser;
    visualizerService.setAnalyser(analyser);
  }
}

export const audioBusService = new AudioBusService();
