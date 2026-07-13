import { RAF_EFFECT_REGISTRY, type RafEffectDefinition } from '$lib/services/raf-effect-registry';
import { RAF_PARAMETER_RAMP_SECONDS, disconnectNode, setAudioParam, type RafEffectNode } from '$lib/services/raf-effects/shared';
import { rafSettings } from '$lib/stores/raf-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { publishRafMeter } from '$lib/services/raf-meter';
import type { RafEffectSettings, RafRackSettings } from '$lib/types';
import type { Unsubscriber } from 'svelte/store';

interface LiveEffect {
  settings: RafEffectSettings;
  definition: RafEffectDefinition;
  processor: RafEffectNode | null;
  nodes: AudioNode[];
  dryGain: GainNode;
  wetGain: GainNode;
}

interface LiveChain {
  input: GainNode;
  outputGain: GainNode;
  effects: LiveEffect[];
}

const GRAPH_CROSSFADE_SECONDS = 0.02;

export class RafEngine {
  readonly input: GainNode;
  readonly output: GainNode;

  #dryGain: GainNode;
  #inputAnalyser: AnalyserNode;
  #outputAnalyser: AnalyserNode;
  #meterTimer: ReturnType<typeof setInterval>;
  #activeChain: LiveChain | null = null;
  #settings: RafRackSettings | null = null;
  #unsubscribers: Unsubscriber[];
  #featureEnabled = false;
  #disposeTimers = new Set<ReturnType<typeof setTimeout>>();
  #destroyed = false;

  constructor(readonly context: BaseAudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.#dryGain = context.createGain();
    this.#inputAnalyser = context.createAnalyser();
    this.#outputAnalyser = context.createAnalyser();
    this.#inputAnalyser.fftSize = 2048;
    this.#outputAnalyser.fftSize = 2048;
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
    this.#meterTimer = setInterval(() => this.#publishMeters(), 100);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#unsubscribers.forEach((unsubscribe) => unsubscribe());
    clearInterval(this.#meterTimer);
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
    this.#inputAnalyser.connect(nextChain.input);
    nextChain.outputGain.connect(this.#outputAnalyser);

    const rackEnabled = this.#featureEnabled && settings.enabled;
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
    return { input, outputGain, effects: liveEffects };
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
      entry.connect(processor.input);
      processor.output.connect(wetGain);
      wetGain.connect(exit);
    } catch (error) {
      console.error(`Raf could not construct effect ${settings.id}; using its dry path.`, error);
    }

    const enabled = settings.enabled && processor !== null;
    dryGain.gain.value = enabled ? 0 : 1;
    wetGain.gain.value = enabled ? 1 : 0;

    return { settings, definition, processor, nodes: [entry, exit, dryGain, wetGain], dryGain, wetGain };
  }

  #updateEffect(liveEffect: LiveEffect, settings: RafEffectSettings): void {
    const previousSettings = liveEffect.settings;
    if (liveEffect.processor) {
      liveEffect.definition.updateNode(liveEffect.processor, settings, this.context, previousSettings);
    }
    const enabled = settings.enabled && liveEffect.processor !== null;
    const previouslyEnabled = previousSettings.enabled && liveEffect.processor !== null;
    if (enabled !== previouslyEnabled) {
      setAudioParam(liveEffect.dryGain.gain, enabled ? 0 : 1, this.context);
      setAudioParam(liveEffect.wetGain.gain, enabled ? 1 : 0, this.context);
    }
    liveEffect.settings = settings;
  }

  #setRackEnabled(enabled: boolean): void {
    setAudioParam(this.#dryGain.gain, enabled ? 0 : 1, this.context);
    if (this.#activeChain) setAudioParam(this.#activeChain.outputGain.gain, enabled ? 1 : 0, this.context);
  }

  #disposeChain(chain: LiveChain): void {
    disconnectNode(chain.input);
    disconnectNode(chain.outputGain);
    for (const effect of chain.effects) {
      effect.nodes.forEach(disconnectNode);
      if (effect.processor) effect.definition.disposeNode(effect.processor);
    }
  }

  #publishMeters(): void {
    const input = new Float32Array(this.#inputAnalyser.fftSize);
    const output = new Float32Array(this.#outputAnalyser.fftSize);
    this.#inputAnalyser.getFloatTimeDomainData(input);
    this.#outputAnalyser.getFloatTimeDomainData(output);
    publishRafMeter(peakDb(input), peakDb(output));
  }
}

function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? 20 * Math.log10(peak) : -60;
}

export function sameTopology(first: RafEffectSettings[], second: RafEffectSettings[]): boolean {
  return first.length === second.length
    && first.every((effect, index) => effect.id === second[index].id && effect.type === second[index].type);
}

export function sameEffectSettings(first: RafEffectSettings, second: RafEffectSettings): boolean {
  if (first.id !== second.id || first.type !== second.type || first.enabled !== second.enabled) return false;

  switch (first.type) {
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
  }
}

function sameArray<T>(first: T[], second: T[]): boolean {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}
