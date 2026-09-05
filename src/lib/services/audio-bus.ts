import { visualizerService } from '$lib/services/visualizer';
import { RafEngine } from '$lib/services/raf-engine';
import { setAudioParam } from '$lib/services/raf-effects/shared';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import type { RafEffectType } from '$lib/types';

type AudioBusSource = AudioNode | MediaElementAudioSourceNode;

interface AudioBusSourceRoute {
  transitionGain: GainNode;
  localGain: GainNode;
}

export class AudioBusService {
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #program: GainNode | null = null;
  #output: GainNode | null = null;
  #rafEngine: RafEngine | null = null;
  #analyser: AnalyserNode | null = null;
  #broadcastGain: GainNode | null = null;
  #broadcastDestination: MediaStreamAudioDestinationNode | null = null;
  #broadcastSource: AudioNode | null = null;
  #broadcastGainValue = 1;
  #sourceRoutes = new Map<AudioBusSource, AudioBusSourceRoute>();
  #mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
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

    try {
      this.#ensureGraph();
      let source = this.#mediaSources.get(element);

      if (!source) {
        source = this.context.createMediaElementSource(element);
        this.#mediaSources.set(element, source);
      }

      this.#connectSource(source, true);
      return source;
    } catch (error) {
      // If Web Audio cannot adopt the element, leave Howler's native output untouched.
      logWarning('playback', 'Media element Web Audio routing unavailable', error);
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

    this.#connectSource(node, true);
    return node;
  }

  disconnect(source: AudioBusSource | null): void {
    if (!source) {
      return;
    }

    const route = this.#sourceRoutes.get(source);
    if (!route) return;

    try {
      source.disconnect(route.transitionGain);
      route.transitionGain.disconnect();
      route.localGain.disconnect();
    } catch {
      // The source owner may already have disconnected it during teardown.
    }

    this.#sourceRoutes.delete(source);
  }

  connectMediaStream(stream: MediaStream | null): MediaStreamAudioSourceNode | null {
    if (!stream || stream.getAudioTracks().length === 0) return null;

    this.#ensureGraph();

    try {
      const source = this.context.createMediaStreamSource(stream);
      // Received WebRTC audio is a listener-only source and must never feed a
      // host broadcast tap, even if session teardown and startup overlap.
      this.#connectSource(source, false);
      return source;
    } catch {
      return null;
    }
  }

  getBroadcastTrack(): MediaStreamTrack | null {
    this.#ensureGraph();
    if (!this.#context || !this.#program) return null;

    if (!this.#broadcastDestination) {
      const gain = this.#context.createGain();
      const destination = this.#context.createMediaStreamDestination();
      destination.channelCount = 2;
      gain.gain.value = this.#broadcastGainValue;
      this.#program.connect(gain);
      gain.connect(destination);
      this.#broadcastGain = gain;
      this.#broadcastDestination = destination;
      this.#broadcastSource = this.#program;
    }

    const track = this.#broadcastDestination.stream.getAudioTracks()[0] ?? null;
    if (track && 'contentHint' in track) track.contentHint = 'music';
    return track;
  }

  setBroadcastGain(gain: number): void {
    this.#broadcastGainValue = Math.max(gain, 0);
    if (!this.#broadcastGain || !this.#context) return;
    setAudioParam(this.#broadcastGain.gain, this.#broadcastGainValue, this.#context);
  }

  releaseBroadcastTrack(): void {
    const destination = this.#broadcastDestination;
    if (!destination) return;

    for (const track of destination.stream.getTracks()) track.stop();
    try {
      this.#broadcastSource?.disconnect(this.#broadcastGain as GainNode);
      this.#broadcastGain?.disconnect();
      destination.disconnect();
    } catch {
      // The graph may already be closing.
    }
    this.#broadcastGain = null;
    this.#broadcastDestination = null;
    this.#broadcastSource = null;
  }

  setSourceGain(source: AudioBusSource | null, gain: number, durationSeconds = 0): void {
    if (!source || !this.#context) return;
    const transitionGain = this.#sourceRoutes.get(source)?.transitionGain;
    if (!transitionGain) return;

    const now = this.#context.currentTime;
    const target = Math.max(gain, 0);
    const start = transitionGain.gain.value;
    if (typeof transitionGain.gain.cancelAndHoldAtTime === 'function') {
      transitionGain.gain.cancelAndHoldAtTime(now);
    } else {
      transitionGain.gain.cancelScheduledValues(now);
      transitionGain.gain.setValueAtTime(transitionGain.gain.value, now);
    }

    if (durationSeconds > 0 && typeof transitionGain.gain.setValueCurveAtTime === 'function') {
      const curve = new Float32Array(64);
      for (let index = 0; index < curve.length; index += 1) {
        const progress = index / (curve.length - 1);
        // A power curve reaches perceived silence earlier than a linear-amplitude ramp.
        const shapedProgress = 1 - (1 - progress) ** 2;
        curve[index] = start + (target - start) * shapedProgress;
      }
      transitionGain.gain.setValueCurveAtTime(curve, now, durationSeconds);
    } else if (durationSeconds > 0) {
      transitionGain.gain.linearRampToValueAtTime(target, now + durationSeconds);
    } else {
      transitionGain.gain.setValueAtTime(target, now);
    }
  }

  setSourceReplayGain(source: AudioBusSource | null, gain: number): void {
    if (!source || !this.#context) return;
    const localGain = this.#sourceRoutes.get(source)?.localGain;
    if (!localGain) return;
    setAudioParam(localGain.gain, Math.max(gain, 0), this.#context);
  }

  async resume(): Promise<boolean> {
    try {
      this.#ensureGraph();
    } catch {
      return false;
    }
    const context = this.#context;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      await waitForAudioContextResume(context);
    }
    const running = this.#context?.state === 'running';
    if (running) logDebug('playback', 'Audio context running');
    else if (this.#context) logWarning('playback', 'Audio context did not resume', { state: this.#context.state });
    return running;
  }

  setOutputGain(gain: number): void {
    this.#outputGain = Math.max(gain, 0);

    if (this.#output && this.#context) {
      setAudioParam(this.#output.gain, this.#outputGain, this.#context);
    }
  }

  setRafEffectBypass(type: RafEffectType, bypassed: boolean): void {
    const changed = bypassed
      ? !this.#bypassedRafEffectTypes.has(type)
      : this.#bypassedRafEffectTypes.has(type);
    if (!changed) return;

    if (bypassed) {
      this.#bypassedRafEffectTypes.add(type);
    } else {
      this.#bypassedRafEffectTypes.delete(type);
    }

    this.#rafEngine?.setBypassedEffectTypes(this.#bypassedRafEffectTypes);
  }

  destroy(): void {
    logInfo('playback', 'Audio graph destroyed');
    for (const source of this.#sourceRoutes.keys()) this.disconnect(source);
    this.releaseBroadcastTrack();
    visualizerService.clear();

    try {
      this.#input?.disconnect();
      this.#program?.disconnect();
      this.#rafEngine?.destroy();
      this.#analyser?.disconnect();
      this.#output?.disconnect();
    } catch {
      // Ignore graph teardown races during window shutdown.
    }

    const context = this.#context;

    this.#context = null;
    this.#input = null;
    this.#program = null;
    this.#output = null;
    this.#rafEngine = null;
    this.#analyser = null;
    this.#broadcastGain = null;
    this.#broadcastDestination = null;
    this.#broadcastSource = null;
    this.#mediaSources = new WeakMap();
    this.#sourceRoutes.clear();

    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  #connectSource(source: AudioBusSource, broadcastEligible: boolean): void {
    if (this.#sourceRoutes.has(source) || !this.#input || !this.#program || !this.#context) {
      return;
    }

    const transitionGain = this.#context.createGain();
    const localGain = this.#context.createGain();
    transitionGain.gain.value = 1;
    localGain.gain.value = 1;
    source.connect(transitionGain);
    transitionGain.connect(localGain);
    localGain.connect(this.#input);
    if (broadcastEligible) transitionGain.connect(this.#program);
    this.#sourceRoutes.set(source, { transitionGain, localGain });
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

    // izci is a media player, not an instrument. The default interactive hint gives
    // mobile Chromium very little render-buffer headroom and is prone to underruns
    // once the Raf graph becomes non-trivial.
    const context = new AudioContextConstructor({ latencyHint: 'playback' });
    const input = context.createGain();
    const output = context.createGain();
    const program = context.createGain();
    const analyser = context.createAnalyser();
    const rafEngine = new RafEngine(context);
    rafEngine.setBypassedEffectTypes(this.#bypassedRafEffectTypes);

    program.gain.value = 1;
    output.gain.value = this.#outputGain;
    input.connect(rafEngine.input);
    rafEngine.output.connect(analyser);
    analyser.connect(output);
    output.connect(context.destination);

    this.#context = context;
    this.#input = input;
    this.#program = program;
    this.#output = output;
    this.#rafEngine = rafEngine;
    this.#analyser = analyser;
    visualizerService.setAnalyser(analyser);
    logInfo('playback', 'Audio graph created', { state: context.state, sampleRate: context.sampleRate });
  }
}

function waitForAudioContextResume(context: AudioContext, timeoutMs = 1_200): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    void context.resume().then(finish, finish);
  });
}

export const audioBusService = new AudioBusService();
