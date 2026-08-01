import { visualizerService } from '$lib/services/visualizer';
import { RafEngine } from '$lib/services/raf-engine';
import { setAudioParam } from '$lib/services/raf-effects/shared';
import type { RafEffectType } from '$lib/types';

type AudioBusSource = AudioNode | MediaElementAudioSourceNode;

export class AudioBusService {
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #output: GainNode | null = null;
  #rafEngine: RafEngine | null = null;
  #analyser: AnalyserNode | null = null;
  #activeSource: AudioBusSource | null = null;
  #mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  #inputGain = 1;
  #outputGain = 1;
  #bypassedRafEffectTypes = new Set<RafEffectType>();

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

  setInputGain(gain: number, immediate = false): void {
    this.#inputGain = Math.max(gain, 0);

    if (this.#input && this.#context) {
      if (immediate) {
        const now = this.#context.currentTime;
        this.#input.gain.cancelScheduledValues(now);
        this.#input.gain.setValueAtTime(this.#inputGain, now);
      } else {
        setAudioParam(this.#input.gain, this.#inputGain, this.#context);
      }
    }
  }

  setOutputGain(gain: number): void {
    this.#outputGain = Math.max(gain, 0);

    if (this.#output && this.#context) {
      setAudioParam(this.#output.gain, this.#outputGain, this.#context);
    }
  }

  setRafEffectBypass(type: RafEffectType, bypassed: boolean): void {
    if (bypassed) {
      this.#bypassedRafEffectTypes.add(type);
    } else {
      this.#bypassedRafEffectTypes.delete(type);
    }

    this.#rafEngine?.setBypassedEffectTypes(this.#bypassedRafEffectTypes);
  }

  destroy(): void {
    this.disconnect(this.#activeSource);
    visualizerService.clear();

    try {
      this.#input?.disconnect();
      this.#rafEngine?.destroy();
      this.#analyser?.disconnect();
      this.#output?.disconnect();
    } catch {
      // Ignore graph teardown races during window shutdown.
    }

    const context = this.#context;

    this.#context = null;
    this.#input = null;
    this.#output = null;
    this.#rafEngine = null;
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
    const rafEngine = new RafEngine(context);
    rafEngine.setBypassedEffectTypes(this.#bypassedRafEffectTypes);

    input.gain.value = this.#inputGain;
    output.gain.value = this.#outputGain;
    input.connect(rafEngine.input);
    rafEngine.output.connect(analyser);
    analyser.connect(output);
    output.connect(context.destination);

    this.#context = context;
    this.#input = input;
    this.#output = output;
    this.#rafEngine = rafEngine;
    this.#analyser = analyser;
    visualizerService.setAnalyser(analyser);
  }
}

export const audioBusService = new AudioBusService();
