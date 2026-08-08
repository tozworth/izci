import { visualizerService } from '$lib/services/visualizer';
import { RafEngine } from '$lib/services/raf-engine';
import { setAudioParam } from '$lib/services/raf-effects/shared';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import type { RafEffectType } from '$lib/types';

type AudioBusSource = AudioNode | MediaElementAudioSourceNode;

export class AudioBusService {
  #context: AudioContext | null = null;
  #input: GainNode | null = null;
  #output: GainNode | null = null;
  #rafEngine: RafEngine | null = null;
  #analyser: AnalyserNode | null = null;
  #broadcastGain: GainNode | null = null;
  #broadcastDestination: MediaStreamAudioDestinationNode | null = null;
  #broadcastSource: AudioNode | null = null;
  #broadcastGainValue = 1;
  #sourceGains = new Map<AudioBusSource, GainNode>();
  #mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  #inputGain = 1;
  #outputGain = 1;
  #bypassedRafEffectTypes = new Set<RafEffectType>();

  get context(): AudioContext {
    this.#ensureGraph();
    return this.#context as AudioContext;
  }

  connectHtmlMediaElement(element: HTMLMediaElement | null): MediaElementAudioSourceNode | null {
    return this.#connectHtmlMediaElement(element, 'input');
  }

  connectHtmlMediaElementAfterRaf(element: HTMLMediaElement | null): MediaElementAudioSourceNode | null {
    return this.#connectHtmlMediaElement(element, 'analyser');
  }

  #connectHtmlMediaElement(
    element: HTMLMediaElement | null,
    target: 'input' | 'analyser'
  ): MediaElementAudioSourceNode | null {
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

      this.#connectSource(source, target === 'analyser' ? this.#analyser : this.#input);
      return source;
    } catch (error) {
      // If Web Audio cannot adopt the element, leave Howler's native output untouched.
      logWarning('playback', 'Media element Web Audio routing unavailable — native output fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
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
    logDebug('playback', 'Audio node connected to bus', { nodeType: node.constructor.name });
    return node;
  }

  disconnect(source: AudioBusSource | null): void {
    if (!source) {
      return;
    }

    const sourceGain = this.#sourceGains.get(source);
    if (!sourceGain) return;

    try {
      source.disconnect(sourceGain);
      sourceGain.disconnect();
    } catch {
      // The source owner may already have disconnected it during teardown.
    }

    this.#sourceGains.delete(source);
    logDebug('playback', 'Audio source disconnected from bus');
  }

  connectMediaStream(stream: MediaStream | null): MediaStreamAudioSourceNode | null {
    return this.#connectMediaStream(stream, 'input', 1);
  }

  /**
   * Connects the stream into the bus with the source gain at 0 — the route
   * exists and consumes the track (so the source node syncs to the live
   * WebRTC track and the AudioContext is warm) but nothing is audible yet.
   * `setMediaStreamSourceGain` unmutes it later. A cold audible route garbles
   * the first ~1-3 s of a mid-stream track ("stuttering into life").
   */
  connectMediaStreamSilent(stream: MediaStream | null): MediaStreamAudioSourceNode | null {
    return this.#connectMediaStream(stream, 'input', 0);
  }

  /**
   * Ramps the source's bus gain (0 = muted route, 1 = audible). The source
   * node stays connected and consuming the track either way, so mute/unmute
   * never tears the pipeline down.
   */
  setMediaStreamSourceGain(source: MediaStreamAudioSourceNode | null, gain: number): void {
    if (!source || !this.#context) return;
    const sourceGain = this.#sourceGains.get(source);
    if (!sourceGain) return;
    sourceGain.gain.setTargetAtTime(gain, this.#context.currentTime, 0.02);
  }

  connectMediaStreamAfterRaf(stream: MediaStream | null): MediaStreamAudioSourceNode | null {
    return this.#connectMediaStream(stream, 'analyser', 1);
  }

  #connectMediaStream(
    stream: MediaStream | null,
    target: 'input' | 'analyser',
    initialGain: number
  ): MediaStreamAudioSourceNode | null {
    if (!stream || stream.getAudioTracks().length === 0) return null;

    this.#ensureGraph();

    try {
      const source = this.context.createMediaStreamSource(stream);
      this.#connectSource(source, target === 'analyser' ? this.#analyser : this.#input, initialGain);
      return source;
    } catch (error) {
      logWarning('playback', 'Media stream Web Audio routing failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  getBroadcastTrack(postRaf = false): MediaStreamTrack | null {
    this.#ensureGraph();
    if (!this.#context || !this.#input || !this.#analyser) return null;

    const source = postRaf ? this.#analyser : this.#input;

    if (!this.#broadcastDestination) {
      logDebug('playback', 'Broadcast destination created (multiplayer audio)');
      const gain = this.#context.createGain();
      const destination = this.#context.createMediaStreamDestination();
      destination.channelCount = 2;
      gain.gain.value = this.#broadcastGainValue;
      source.connect(gain);
      gain.connect(destination);
      this.#broadcastGain = gain;
      this.#broadcastDestination = destination;
      this.#broadcastSource = source;
    } else if (this.#broadcastSource !== source && this.#broadcastGain) {
      try {
        this.#broadcastSource?.disconnect(this.#broadcastGain);
      } catch {
        // The previous branch may already have been disconnected during graph teardown.
      }
      source.connect(this.#broadcastGain);
      this.#broadcastSource = source;
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
    logDebug('playback', 'Broadcast track released');

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
    const sourceGain = this.#sourceGains.get(source);
    if (!sourceGain) return;

    const now = this.#context.currentTime;
    const target = Math.max(gain, 0);
    const start = sourceGain.gain.value;
    if (typeof sourceGain.gain.cancelAndHoldAtTime === 'function') {
      sourceGain.gain.cancelAndHoldAtTime(now);
    } else {
      sourceGain.gain.cancelScheduledValues(now);
      sourceGain.gain.setValueAtTime(sourceGain.gain.value, now);
    }

    if (durationSeconds > 0 && typeof sourceGain.gain.setValueCurveAtTime === 'function') {
      const curve = new Float32Array(64);
      for (let index = 0; index < curve.length; index += 1) {
        const progress = index / (curve.length - 1);
        // A power curve reaches perceived silence earlier than a linear-amplitude ramp.
        const shapedProgress = 1 - (1 - progress) ** 2;
        curve[index] = start + (target - start) * shapedProgress;
      }
      sourceGain.gain.setValueCurveAtTime(curve, now, durationSeconds);
    } else if (durationSeconds > 0) {
      sourceGain.gain.linearRampToValueAtTime(target, now + durationSeconds);
    } else {
      sourceGain.gain.setValueAtTime(target, now);
    }
  }

  async resume(): Promise<boolean> {
    try {
      this.#ensureGraph();
    } catch {
      return false;
    }
    const context = this.#context;
    if (context && context.state !== 'running' && context.state !== 'closed') {
      await context.resume().catch(() => undefined);
    }
    const running = this.#context?.state === 'running';
    if (running) {
      logDebug('playback', 'Audio context running');
    } else if (this.#context && this.#context.state !== 'closed') {
      logWarning('playback', 'Audio context did not resume', { state: this.#context.state });
    }
    return running;
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
    for (const source of this.#sourceGains.keys()) this.disconnect(source);
    this.releaseBroadcastTrack();
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
    this.#broadcastGain = null;
    this.#broadcastDestination = null;
    this.#broadcastSource = null;
    this.#mediaSources = new WeakMap();
    this.#sourceGains.clear();

    if (context) {
      void context.close().catch(() => undefined);
    }
  }

  #connectSource(source: AudioBusSource, target: AudioNode | null = this.#input, initialGain = 1): void {
    if (this.#sourceGains.has(source) || !target || !this.#context) {
      return;
    }

    const sourceGain = this.#context.createGain();
    sourceGain.gain.value = initialGain;
    source.connect(sourceGain);
    sourceGain.connect(target);
    this.#sourceGains.set(source, sourceGain);
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
      logError('playback', 'Web Audio unavailable in this browser');
      throw new Error('Web Audio is unavailable in this browser.');
    }

    // izci is a media player, not an instrument. The default interactive hint gives
    // mobile Chromium very little render-buffer headroom and is prone to underruns
    // once the Raf graph becomes non-trivial.
    const context = new AudioContextConstructor({ latencyHint: 'playback' });
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
    logInfo('playback', 'Audio graph created', {
      state: context.state,
      sampleRate: context.sampleRate
    });
  }
}

export const audioBusService = new AudioBusService();
