import { RAF_EFFECT_REGISTRY, type RafEffectDefinition } from '$lib/services/raf-effect-registry';
import { RAF_PARAMETER_RAMP_SECONDS, disconnectNode, setAudioParam, type RafEffectNode } from '$lib/services/raf-effects/shared';
import { rafSettings } from '$lib/stores/raf-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { publishRafMeter } from '$lib/services/raf-meter';
import type { RafEffectSettings, RafEffectType, RafRackSettings } from '$lib/types';
import type { Unsubscriber } from 'svelte/store';

interface LiveEffect {
  settings: RafEffectSettings;
  definition: RafEffectDefinition;
  processor: RafEffectNode | null;
  nodes: AudioNode[];
  dryGain: GainNode;
  wetGain: GainNode;
  wetConnected: boolean;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

interface LiveChain {
  input: GainNode;
  outputGain: GainNode;
  effects: LiveEffect[];
  connected: boolean;
}

const GRAPH_CROSSFADE_SECONDS = 0.02;

export class RafEngine {
  readonly input: GainNode;
  readonly output: GainNode;

  #dryGain: GainNode;
  #inputAnalyser: AnalyserNode;
  #outputAnalyser: AnalyserNode;
  #inputMeterSamples: Float32Array<ArrayBuffer>;
  #outputMeterSamples: Float32Array<ArrayBuffer>;
  #meterTimer: ReturnType<typeof setInterval> | null;
  #activeChain: LiveChain | null = null;
  #settings: RafRackSettings | null = null;
  #unsubscribers: Unsubscriber[];
  #featureEnabled = false;
  #bypassedEffectTypes = new Set<RafEffectType>();
  #disposeTimers = new Set<ReturnType<typeof setTimeout>>();
  #activeChainDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;

  constructor(
    readonly context: BaseAudioContext,
    { publishMeters = true }: { publishMeters?: boolean } = {}
  ) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.#dryGain = context.createGain();
    this.#inputAnalyser = context.createAnalyser();
    this.#outputAnalyser = context.createAnalyser();
    this.#inputAnalyser.fftSize = 2048;
    this.#outputAnalyser.fftSize = 2048;
    this.#inputMeterSamples = new Float32Array(
      new ArrayBuffer(this.#inputAnalyser.fftSize * Float32Array.BYTES_PER_ELEMENT)
    );
    this.#outputMeterSamples = new Float32Array(
      new ArrayBuffer(this.#outputAnalyser.fftSize * Float32Array.BYTES_PER_ELEMENT)
    );
    this.input.connect(this.#inputAnalyser);
    this.#inputAnalyser.connect(this.#dryGain);
    this.#dryGain.connect(this.#outputAnalyser);
    this.#outputAnalyser.connect(this.output);
    this.#dryGain.gain.value = 1;
    this.#featureEnabled = playbackSettings.getSnapshot().enableRaf;
    this.#unsubscribers = [
      playbackSettings.subscribe((settings) => {
        this.#featureEnabled = settings.enableRaf;
        this.#setRackEnabled(settings.enableRaf && (this.#settings?.enabled ?? false));
      }),
      rafSettings.subscribe((settings) => this.#applySettings(settings))
    ];
    this.#meterTimer = publishMeters ? setInterval(() => this.#publishMeters(), 100) : null;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe());
    if (this.#meterTimer !== null) clearInterval(this.#meterTimer);
    this.#cancelActiveChainDisconnect();
    for (const timer of this.#disposeTimers) clearTimeout(timer);
    this.#disposeTimers.clear();
    if (this.#activeChain) this.#disposeChain(this.#activeChain);
    disconnectNode(this.input);
    disconnectNode(this.#dryGain);
    disconnectNode(this.#inputAnalyser);
    disconnectNode(this.#outputAnalyser);
    disconnectNode(this.output);
    this.#activeChain = null;
  }

  setBypassedEffectTypes(types: Iterable<RafEffectType>): void {
    const previousTypes = this.#bypassedEffectTypes;
    const nextTypes = new Set(types);
    if (sameSet(previousTypes, nextTypes)) return;
    this.#bypassedEffectTypes = nextTypes;

    for (const effect of this.#activeChain?.effects ?? []) {
      if (previousTypes.has(effect.settings.type) === nextTypes.has(effect.settings.type)) continue;
      const enabled = this.#isEffectEnabled(effect.settings, effect.processor);
      this.#setEffectEnabled(effect, enabled);
    }
  }

  #applySettings(settings: RafRackSettings): void {
    if (this.#destroyed) return;
    const previousSettings = this.#settings;
    const topologyChanged = !previousSettings || !sameTopology(previousSettings.effects, settings.effects);
    this.#settings = settings;

    if (topologyChanged) {
      this.#replaceChain(settings);
    } else if (this.#activeChain) {
      settings.effects.forEach((effect, index) => {
        const liveEffect = this.#activeChain!.effects[index];
        if (!sameEffectSettings(liveEffect.settings, effect)) {
          this.#updateEffect(liveEffect, effect);
        }
      });
      if (previousSettings.enabled !== settings.enabled) {
        this.#setRackEnabled(this.#featureEnabled && settings.enabled);
      }
    }
  }

  #replaceChain(settings: RafRackSettings): void {
    const nextChain = this.#createChain(settings.effects);
    const previousChain = this.#activeChain;
    this.#activeChain = nextChain;

    nextChain.outputGain.gain.value = 0;

    const rackEnabled = this.#featureEnabled && settings.enabled;
    if (rackEnabled) this.#connectChain(nextChain);
    const target = rackEnabled ? 1 : 0;
    setAudioParam(nextChain.outputGain.gain, target, this.context, GRAPH_CROSSFADE_SECONDS);
    setAudioParam(this.#dryGain.gain, rackEnabled ? 0 : 1, this.context, GRAPH_CROSSFADE_SECONDS);

    if (previousChain) {
      setAudioParam(previousChain.outputGain.gain, 0, this.context, GRAPH_CROSSFADE_SECONDS);
      const timer = setTimeout(() => {
        this.#disposeTimers.delete(timer);
        this.#disposeChain(previousChain);
      }, GRAPH_CROSSFADE_SECONDS * 1000 + 5);
      this.#disposeTimers.add(timer);
    }
  }

  #createChain(effects: RafEffectSettings[]): LiveChain {
    const input = this.context.createGain();
    const outputGain = this.context.createGain();
    const liveEffects: LiveEffect[] = [];
    let previous: AudioNode = input;

    for (const settings of effects) {
      const liveEffect = this.#createEffect(settings);
      previous.connect(liveEffect.nodes[0]);
      previous = liveEffect.nodes[1];
      liveEffects.push(liveEffect);
    }

    previous.connect(outputGain);
    return { input, outputGain, effects: liveEffects, connected: false };
  }

  #createEffect(settings: RafEffectSettings): LiveEffect {
    const definition = RAF_EFFECT_REGISTRY[settings.type];
    const entry = this.context.createGain();
    const exit = this.context.createGain();
    const dryGain = this.context.createGain();
    const wetGain = this.context.createGain();
    let processor: RafEffectNode | null = null;

    entry.connect(dryGain);
    dryGain.connect(exit);

    try {
      processor = definition.createNode(this.context, settings);
    } catch (error) {
      console.error(`Raf could not construct effect ${settings.id}; using its dry path.`, error);
    }

    const enabled = this.#isEffectEnabled(settings, processor);
    this.#setDryWetGains({ dryGain, wetGain, settings }, enabled, false);
    let wetConnected = false;
    if (enabled && processor) {
      entry.connect(processor.input);
      processor.output.connect(wetGain);
      wetGain.connect(exit);
      wetConnected = true;
    }

    return {
      settings,
      definition,
      processor,
      nodes: [entry, exit, dryGain, wetGain],
      dryGain,
      wetGain,
      wetConnected,
      disconnectTimer: null
    };
  }

  #updateEffect(liveEffect: LiveEffect, settings: RafEffectSettings): void {
    const previousSettings = liveEffect.settings;
    if (liveEffect.processor) {
      liveEffect.definition.updateNode(liveEffect.processor, settings, this.context, previousSettings);
    }
    liveEffect.settings = settings;
    const enabled = this.#isEffectEnabled(settings, liveEffect.processor);
    const previouslyEnabled = this.#isEffectEnabled(previousSettings, liveEffect.processor);
    if (enabled !== previouslyEnabled) {
      this.#setEffectEnabled(liveEffect, enabled);
    } else if (previousSettings.dryWet !== settings.dryWet) {
      // Keep the wet path live and only rebalance the dry/wet gains; the
      // bypass crossfade itself is owned by the enabled flag.
      this.#setDryWetGains(liveEffect, enabled, true);
    }
  }

  #isEffectEnabled(settings: RafEffectSettings, processor: RafEffectNode | null): boolean {
    return settings.enabled && processor !== null && !this.#bypassedEffectTypes.has(settings.type);
  }

  #setRackEnabled(enabled: boolean): void {
    this.#cancelActiveChainDisconnect();
    if (enabled && this.#activeChain) this.#connectChain(this.#activeChain);
    setAudioParam(this.#dryGain.gain, enabled ? 0 : 1, this.context);
    if (this.#activeChain) setAudioParam(this.#activeChain.outputGain.gain, enabled ? 1 : 0, this.context);
    if (!enabled && this.#activeChain?.connected) {
      const chain = this.#activeChain;
      this.#activeChainDisconnectTimer = setTimeout(() => {
        this.#activeChainDisconnectTimer = null;
        if (this.#activeChain === chain) this.#disconnectChain(chain);
      }, GRAPH_CROSSFADE_SECONDS * 1000 + 5);
    }
  }

  #disposeChain(chain: LiveChain): void {
    this.#disconnectChain(chain);
    disconnectNode(chain.input);
    disconnectNode(chain.outputGain);
    for (const effect of chain.effects) {
      if (effect.disconnectTimer !== null) clearTimeout(effect.disconnectTimer);
      effect.nodes.forEach(disconnectNode);
      if (effect.processor) effect.definition.disposeNode(effect.processor);
    }
  }

  #connectChain(chain: LiveChain): void {
    if (chain.connected) return;
    this.#inputAnalyser.connect(chain.input);
    chain.outputGain.connect(this.#outputAnalyser);
    chain.connected = true;
  }

  #disconnectChain(chain: LiveChain): void {
    if (!chain.connected) return;
    try {
      this.#inputAnalyser.disconnect(chain.input);
      chain.outputGain.disconnect(this.#outputAnalyser);
    } catch {
      // A replaced graph can already be detached while its crossfade timer settles.
    }
    chain.connected = false;
  }

  #cancelActiveChainDisconnect(): void {
    if (this.#activeChainDisconnectTimer === null) return;
    clearTimeout(this.#activeChainDisconnectTimer);
    this.#activeChainDisconnectTimer = null;
  }

  #setEffectEnabled(effect: LiveEffect, enabled: boolean): void {
    if (effect.disconnectTimer !== null) {
      clearTimeout(effect.disconnectTimer);
      effect.disconnectTimer = null;
    }

    if (enabled && effect.processor && !effect.wetConnected) {
      effect.nodes[0].connect(effect.processor.input);
      effect.processor.output.connect(effect.wetGain);
      effect.wetGain.connect(effect.nodes[1]);
      effect.wetConnected = true;
    }

    this.#setDryWetGains(effect, enabled, true);

    if (!enabled && effect.processor && effect.wetConnected) {
      effect.disconnectTimer = setTimeout(() => {
        effect.disconnectTimer = null;
        disconnectFrom(effect.nodes[0], effect.processor!.input);
        disconnectFrom(effect.processor!.output, effect.wetGain);
        disconnectFrom(effect.wetGain, effect.nodes[1]);
        effect.wetConnected = false;
      }, RAF_PARAMETER_RAMP_SECONDS * 1000 + 5);
    }
  }

  #setDryWetGains(
    effect: Pick<LiveEffect, 'dryGain' | 'wetGain' | 'settings'>,
    enabled: boolean,
    ramp: boolean
  ): void {
    const wetRatio = dryWetToRatio(effect.settings.dryWet);
    const apply = (parameter: AudioParam, value: number) => {
      if (ramp) setAudioParam(parameter, value, this.context);
      else parameter.value = value;
    };
    apply(effect.dryGain.gain, enabled ? 1 - wetRatio : 1);
    apply(effect.wetGain.gain, enabled ? wetRatio : 0);
  }

  #publishMeters(): void {
    this.#inputAnalyser.getFloatTimeDomainData(this.#inputMeterSamples);
    this.#outputAnalyser.getFloatTimeDomainData(this.#outputMeterSamples);
    publishRafMeter(peakDb(this.#inputMeterSamples), peakDb(this.#outputMeterSamples));
  }
}

function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? 20 * Math.log10(peak) : -60;
}

function dryWetToRatio(dryWet: number): number {
  if (!Number.isFinite(dryWet)) return 1;
  return Math.min(100, Math.max(0, dryWet)) / 100;
}

export function sameTopology(first: RafEffectSettings[], second: RafEffectSettings[]): boolean {
  return first.length === second.length
    && first.every((effect, index) => effect.id === second[index].id && effect.type === second[index].type);
}

export function sameEffectSettings(first: RafEffectSettings, second: RafEffectSettings): boolean {
  if (first.id !== second.id || first.type !== second.type || first.enabled !== second.enabled || first.dryWet !== second.dryWet) return false;

  switch (first.type) {
    case 'auto-amp': {
      const candidate = second as typeof first;
      return first.gainDb === candidate.gainDb
        && first.mode === candidate.mode
        && first.targetDb === candidate.targetDb
        && first.maximumReductionDb === candidate.maximumReductionDb
        && first.maximumBoostDb === candidate.maximumBoostDb
        && first.peakHoldSeconds === candidate.peakHoldSeconds
        && first.recoveryDbPerSecond === candidate.recoveryDbPerSecond
        && first.lookaheadMs === candidate.lookaheadMs;
    }
    case 'graphic-eq': {
      const candidate = second as typeof first;
      return first.preampDb === candidate.preampDb
        && sameArray(first.bandGainsDb, candidate.bandGainsDb);
    }
    case 'stereo-width':
      return first.widthDb === (second as typeof first).widthDb;
    case 'crystalizer': {
      const candidate = second as typeof first;
      return sameArray(first.bandIntensities, candidate.bandIntensities)
        && sameArray(first.bandMuted, candidate.bandMuted)
        && sameArray(first.bandBypassed, candidate.bandBypassed);
    }
    case 'sloptimizer': {
      const candidate = second as typeof first;
      return first.advanced === candidate.advanced
        && first.slop === candidate.slop
        && first.customized === candidate.customized
        && first.lowLiftDb === candidate.lowLiftDb
        && first.midLiftDb === candidate.midLiftDb
        && first.highLiftDb === candidate.highLiftDb
        && first.lowCrossoverHz === candidate.lowCrossoverHz
        && first.highCrossoverHz === candidate.highCrossoverHz
        && first.density === candidate.density
        && first.speed === candidate.speed
        && first.upwardRatio === candidate.upwardRatio
        && first.upwardThresholdDb === candidate.upwardThresholdDb
        && first.upwardMaximumBoostDb === candidate.upwardMaximumBoostDb
        && first.ceilingDb === candidate.ceilingDb;
    }
    case 'reverb': {
      const candidate = second as typeof first;
      return first.mix === candidate.mix
        && first.roomSize === candidate.roomSize
        && first.decaySeconds === candidate.decaySeconds
        && first.preDelayMs === candidate.preDelayMs
        && first.dampingHz === candidate.dampingHz;
    }
    case 'pitch': {
      const candidate = second as typeof first;
      return first.semitones === candidate.semitones
        && first.engine === candidate.engine
        && first.windowSize === candidate.windowSize
        && first.maxPeaks === candidate.maxPeaks
        && first.peakFloorDb === candidate.peakFloorDb
        && first.grainSize === candidate.grainSize
        && first.alignmentWindow === candidate.alignmentWindow;
    }
  }
}

function sameArray<T>(first: T[], second: T[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function sameSet<T>(first: Set<T>, second: Set<T>): boolean {
  return first.size === second.size && [...first].every((value) => second.has(value));
}

function disconnectFrom(source: AudioNode, destination: AudioNode): void {
  try {
    source.disconnect(destination);
  } catch {
    // A chain replacement can dispose either side while a crossfade timer settles.
  }
}
