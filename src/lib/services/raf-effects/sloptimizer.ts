import type { RafSloptimizerSettings } from '$lib/types';
import { decibelsToGain, disconnectNode, setAudioParam, type RafEffectNode } from './shared';

export const SLOPTIMIZER_SLOP_MIN = 0;
export const SLOPTIMIZER_SLOP_MAX = 100;
export const SLOPTIMIZER_LIFT_MIN_DB = -6;
export const SLOPTIMIZER_LIFT_MAX_DB = 12;
export const SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ = 60;
export const SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ = 400;
export const SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ = 1000;
export const SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ = 8000;
export const SLOPTIMIZER_DENSITY_MIN = 0;
export const SLOPTIMIZER_DENSITY_MAX = 100;
export const SLOPTIMIZER_SPEED_MIN = 0;
export const SLOPTIMIZER_SPEED_MAX = 100;
export const SLOPTIMIZER_UPWARD_RATIO_MIN = 1;
export const SLOPTIMIZER_UPWARD_RATIO_MAX = 8;
export const SLOPTIMIZER_UPWARD_THRESHOLD_MIN_DB = -60;
export const SLOPTIMIZER_UPWARD_THRESHOLD_MAX_DB = -12;
export const SLOPTIMIZER_UPWARD_BOOST_MIN_DB = 0;
export const SLOPTIMIZER_UPWARD_BOOST_MAX_DB = 24;
const SLOPTIMIZER_UPWARD_DETECTOR_FLOOR_DB = -72;
export const SLOPTIMIZER_CEILING_MIN_DB = -6;
export const SLOPTIMIZER_CEILING_MAX_DB = 0;
export const SLOPTIMIZER_CROSSOVERS = [180, 3000] as const;

const LINKWITZ_RILEY_Q = Math.SQRT1_2;
const LIMITER_CURVE_SIZE = 4097;
const UPWARD_FLOOR_FADE_DB = 6;
const UPWARD_PROCESSOR_NAME = 'raf-upward-compressor';
const UPWARD_WORKLET_URL = '/raf-upward-compressor.worklet.js';
const upwardWorkletLoads = new WeakMap<BaseAudioContext, Promise<boolean>>();

interface SloptimizerMacroParameters {
  lowLiftDb: number;
  midLiftDb: number;
  highLiftDb: number;
  density: number;
  speed: number;
  upwardRatio: number;
  upwardThresholdDb: number;
  upwardMaximumBoostDb: number;
  ceilingDb: number;
}

interface SloptimizerBandNode {
  filters: BiquadFilterNode[];
  upwardInput: GainNode;
  upwardBypass: GainNode;
  upwardWet: GainNode;
  upward: AudioWorkletNode | null;
  compressor: DynamicsCompressorNode;
  lift: GainNode;
}

interface SloptimizerNode extends RafEffectNode {
  input: GainNode;
  output: GainNode;
  dry: GainNode;
  processed: GainNode;
  bands: SloptimizerBandNode[];
  limiter: DynamicsCompressorNode;
  saturator: WaveShaperNode;
  nodes: AudioNode[];
  latestSettings: RafSloptimizerSettings;
  disposed: boolean;
  ready: Promise<void>;
}

export function mapSlopToParameters(slop: number): SloptimizerMacroParameters {
  const amount = clamp(slop, SLOPTIMIZER_SLOP_MIN, SLOPTIMIZER_SLOP_MAX) / 100;
  return {
    // The macro deliberately develops a smile curve: weight returns in the
    // lows, the broad mid band stays tucked, and the highs supply the flashy
    // OTT-like detail that makes the effect read as "sloptimized".
    lowLiftDb: 8 * amount ** 1.05,
    midLiftDb: 4.5 * amount ** 1.2,
    highLiftDb: 11.5 * amount ** 0.88,
    density: 100 * amount ** 0.75,
    speed: 30 + 50 * amount ** 0.8,
    upwardRatio: 1 + 3 * amount ** 0.85,
    upwardThresholdDb: -36 + 12 * amount ** 0.8,
    upwardMaximumBoostDb: 12 * amount ** 0.9,
    ceilingDb: amount === 0 ? 0 : -0.5 - 0.5 * amount ** 0.7
  };
}

export function createSloptimizerNode(
  context: BaseAudioContext,
  settings: RafSloptimizerSettings
): SloptimizerNode {
  const input = context.createGain();
  const output = context.createGain();
  const dry = context.createGain();
  const sum = context.createGain();
  const processed = context.createGain();
  const low = createBand(context, [
    createCrossoverFilter(context, 'lowpass', settings.lowCrossoverHz),
    createCrossoverFilter(context, 'lowpass', settings.lowCrossoverHz)
  ]);
  const mid = createBand(context, [
    createCrossoverFilter(context, 'highpass', settings.lowCrossoverHz),
    createCrossoverFilter(context, 'highpass', settings.lowCrossoverHz),
    createCrossoverFilter(context, 'lowpass', settings.highCrossoverHz),
    createCrossoverFilter(context, 'lowpass', settings.highCrossoverHz)
  ]);
  const high = createBand(context, [
    createCrossoverFilter(context, 'highpass', settings.highCrossoverHz),
    createCrossoverFilter(context, 'highpass', settings.highCrossoverHz)
  ]);
  const bands = [low, mid, high];
  const limiter = context.createDynamicsCompressor();
  const saturator = context.createWaveShaper();
  saturator.oversample = '2x';

  input.connect(dry);
  dry.connect(output);
  for (const band of bands) {
    input.connect(band.filters[0]);
    connectSequence([...band.filters, band.upwardInput]);
    band.upwardInput.connect(band.upwardBypass);
    band.upwardBypass.connect(band.compressor);
    connectSequence([band.compressor, band.lift, sum]);
  }
  sum.connect(limiter);
  limiter.connect(saturator);
  saturator.connect(processed);
  processed.connect(output);

  applySloptimizerParameters({ dry, processed, bands, limiter, saturator }, settings, context, false);
  const nodes: AudioNode[] = [
    input,
    output,
    dry,
    sum,
    processed,
    limiter,
    saturator,
    ...bands.flatMap((band) => [
      ...band.filters,
      band.upwardInput,
      band.upwardBypass,
      band.upwardWet,
      band.compressor,
      band.lift
    ])
  ];
  const node: SloptimizerNode = {
    input,
    output,
    dry,
    processed,
    bands,
    limiter,
    saturator,
    nodes,
    latestSettings: settings,
    disposed: false,
    ready: Promise.resolve()
  };
  node.ready = activateUpwardProcessors(node, context);
  return node;
}

export function updateSloptimizerNode(
  node: SloptimizerNode,
  settings: RafSloptimizerSettings,
  context: BaseAudioContext,
  previousSettings?: RafSloptimizerSettings
): void {
  node.latestSettings = settings;
  applySloptimizerParameters(node, settings, context, true, previousSettings);
}

export function disposeSloptimizerNode(node: SloptimizerNode): void {
  node.disposed = true;
  node.nodes.forEach(disconnectNode);
}

export function calculateUpwardBoostDb(
  levelDb: number,
  thresholdDb: number,
  ratio: number,
  maximumBoostDb: number
): number {
  if (
    ratio <= SLOPTIMIZER_UPWARD_RATIO_MIN
    || maximumBoostDb <= 0
    || levelDb >= thresholdDb
    || levelDb <= SLOPTIMIZER_UPWARD_DETECTOR_FLOOR_DB
  ) return 0;
  const boostDb = Math.min(maximumBoostDb, (thresholdDb - levelDb) * (1 - 1 / ratio));
  const floorFade = Math.min(1, (levelDb - SLOPTIMIZER_UPWARD_DETECTOR_FLOOR_DB) / UPWARD_FLOOR_FADE_DB);
  return boostDb * floorFade;
}

export function createSafeLimiterCurve(ceilingDb: number): Float32Array<ArrayBuffer> {
  const ceiling = decibelsToGain(clamp(ceilingDb, SLOPTIMIZER_CEILING_MIN_DB, SLOPTIMIZER_CEILING_MAX_DB));
  const knee = ceiling * 0.72;
  const curve = new Float32Array(new ArrayBuffer(LIMITER_CURVE_SIZE * Float32Array.BYTES_PER_ELEMENT));
  for (let index = 0; index < curve.length; index += 1) {
    const input = index / (curve.length - 1) * 2 - 1;
    const magnitude = Math.abs(input);
    if (magnitude <= knee) {
      curve[index] = input;
      continue;
    }
    const remaining = (1 - magnitude) / (1 - knee);
    const exponent = (1 - knee) / Math.max(ceiling - knee, Number.EPSILON);
    // The power curve meets the identity path with a unity slope, stays at
    // or below it, and flattens into the bounded ceiling without a hard corner.
    const magnitudeOut = ceiling - (ceiling - knee) * remaining ** exponent;
    curve[index] = Math.sign(input) * Math.min(ceiling, magnitudeOut);
  }
  return curve;
}

export function sloptimizerIsTransparent(settings: RafSloptimizerSettings): boolean {
  return settings.density === 0
    && (settings.upwardRatio === 1 || settings.upwardMaximumBoostDb === 0)
    && settings.lowLiftDb === 0
    && settings.midLiftDb === 0
    && settings.highLiftDb === 0
    && settings.ceilingDb === 0;
}

function createBand(context: BaseAudioContext, filters: BiquadFilterNode[]): SloptimizerBandNode {
  const upwardInput = context.createGain();
  const upwardBypass = context.createGain();
  const upwardWet = context.createGain();
  upwardBypass.gain.value = 1;
  upwardWet.gain.value = 0;
  return {
    filters,
    upwardInput,
    upwardBypass,
    upwardWet,
    upward: null,
    compressor: context.createDynamicsCompressor(),
    lift: context.createGain()
  };
}

function createCrossoverFilter(
  context: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number
): BiquadFilterNode {
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = Math.min(frequency, context.sampleRate * 0.45);
  filter.Q.value = LINKWITZ_RILEY_Q;
  return filter;
}

function connectSequence(nodes: AudioNode[]): void {
  for (let index = 0; index < nodes.length - 1; index += 1) nodes[index].connect(nodes[index + 1]);
}

async function activateUpwardProcessors(node: SloptimizerNode, context: BaseAudioContext): Promise<void> {
  if (!await ensureUpwardWorklet(context) || node.disposed) return;

  for (const band of node.bands) {
    if (node.disposed) return;
    const settings = node.latestSettings;
    let upward: AudioWorkletNode | null = null;
    try {
      upward = new AudioWorkletNode(context, UPWARD_PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        parameterData: {
          thresholdDb: settings.upwardThresholdDb,
          ratio: settings.upwardRatio,
          maximumBoostDb: settings.upwardMaximumBoostDb,
          speed: settings.speed / 100
        }
      });
      band.upward = upward;
      node.nodes.push(upward);
      band.upwardInput.connect(upward);
      upward.connect(band.upwardWet);
      band.upwardWet.connect(band.compressor);
      setAudioParam(band.upwardWet.gain, 1, context);
      setAudioParam(band.upwardBypass.gain, 0, context);
    } catch (error) {
      if (upward) disconnectNode(upward);
      console.error('Raf could not construct a Sloptimizer upward-compression stage; using its bypass.', error);
    }
  }
}

function ensureUpwardWorklet(context: BaseAudioContext): Promise<boolean> {
  const cached = upwardWorkletLoads.get(context);
  if (cached) return cached;
  if (!('audioWorklet' in context) || typeof AudioWorkletNode === 'undefined') return Promise.resolve(false);

  const worklet = (context as AudioContext).audioWorklet;
  const load = worklet.addModule(UPWARD_WORKLET_URL)
    .then(() => true)
    .catch((error) => {
      console.error('Raf could not load the Sloptimizer upward-compression worklet; using its bypass.', error);
      return false;
    });
  upwardWorkletLoads.set(context, load);
  return load;
}

function applySloptimizerParameters(
  node: Pick<SloptimizerNode, 'dry' | 'processed' | 'bands' | 'limiter' | 'saturator'>,
  settings: RafSloptimizerSettings,
  context: BaseAudioContext,
  ramp: boolean,
  previousSettings?: RafSloptimizerSettings
): void {
  const density = settings.density / 100;
  const speed = settings.speed / 100;
  const threshold = -3 - 29 * density ** 1.25;
  const ratio = 1 + 11 * density ** 1.15;
  const knee = 3 + 17 * density;
  const attack = (30 - 27 * speed) / 1000;
  const release = (320 - 250 * speed) / 1000;
  const lifts = [settings.lowLiftDb, settings.midLiftDb, settings.highLiftDb];
  const transparent = sloptimizerIsTransparent(settings);
  const previousDensity = previousSettings ? previousSettings.density / 100 : null;
  const previousSpeed = previousSettings ? previousSettings.speed / 100 : null;
  const previousThreshold = previousDensity === null ? null : -3 - 29 * previousDensity ** 1.25;
  const previousRatio = previousDensity === null ? null : 1 + 11 * previousDensity ** 1.15;
  const previousKnee = previousDensity === null ? null : 3 + 17 * previousDensity;
  const previousAttack = previousSpeed === null ? null : (30 - 27 * previousSpeed) / 1000;
  const previousRelease = previousSpeed === null ? null : (320 - 250 * previousSpeed) / 1000;
  const previousUpwardRatio = previousSettings?.upwardRatio ?? null;
  const previousUpwardThresholdDb = previousSettings?.upwardThresholdDb ?? null;
  const previousUpwardMaximumBoostDb = previousSettings?.upwardMaximumBoostDb ?? null;
  const previousLifts = previousSettings
    ? [previousSettings.lowLiftDb, previousSettings.midLiftDb, previousSettings.highLiftDb]
    : null;
  const crossoverFrequencies = [
    [settings.lowCrossoverHz, settings.lowCrossoverHz],
    [settings.lowCrossoverHz, settings.lowCrossoverHz, settings.highCrossoverHz, settings.highCrossoverHz],
    [settings.highCrossoverHz, settings.highCrossoverHz]
  ];
  const previousCrossoverFrequencies = previousSettings ? [
    [previousSettings.lowCrossoverHz, previousSettings.lowCrossoverHz],
    [previousSettings.lowCrossoverHz, previousSettings.lowCrossoverHz, previousSettings.highCrossoverHz, previousSettings.highCrossoverHz],
    [previousSettings.highCrossoverHz, previousSettings.highCrossoverHz]
  ] : null;
  const previousTransparent = previousSettings ? sloptimizerIsTransparent(previousSettings) : null;

  node.bands.forEach((band, index) => {
    band.filters.forEach((filter, filterIndex) => {
      const maximum = context.sampleRate * 0.45;
      setParamIfChanged(
        filter.frequency,
        Math.min(crossoverFrequencies[index][filterIndex], maximum),
        previousCrossoverFrequencies
          ? Math.min(previousCrossoverFrequencies[index][filterIndex], maximum)
          : null,
        context,
        ramp
      );
    });
    setParamIfChanged(band.compressor.threshold, threshold, previousThreshold, context, ramp);
    setParamIfChanged(band.compressor.ratio, ratio, previousRatio, context, ramp);
    setParamIfChanged(band.compressor.knee, knee, previousKnee, context, ramp);
    setParamIfChanged(band.compressor.attack, attack, previousAttack, context, ramp);
    setParamIfChanged(band.compressor.release, release, previousRelease, context, ramp);
    setWorkletParamIfChanged(
      band.upward,
      'thresholdDb',
      settings.upwardThresholdDb,
      previousUpwardThresholdDb,
      context,
      ramp
    );
    setWorkletParamIfChanged(
      band.upward,
      'ratio',
      settings.upwardRatio,
      previousUpwardRatio,
      context,
      ramp
    );
    setWorkletParamIfChanged(
      band.upward,
      'maximumBoostDb',
      settings.upwardMaximumBoostDb,
      previousUpwardMaximumBoostDb,
      context,
      ramp
    );
    setWorkletParamIfChanged(band.upward, 'speed', speed, previousSpeed, context, ramp);
    setParamIfChanged(
      band.lift.gain,
      decibelsToGain(lifts[index]),
      previousLifts ? decibelsToGain(previousLifts[index]) : null,
      context,
      ramp
    );
  });

  setParamIfChanged(
    node.limiter.threshold,
    Math.max(-8, settings.ceilingDb - 2.5),
    previousSettings ? Math.max(-8, previousSettings.ceilingDb - 2.5) : null,
    context,
    ramp
  );
  setParamIfChanged(node.limiter.ratio, 20, previousSettings ? 20 : null, context, ramp);
  setParamIfChanged(node.limiter.knee, 1.5, previousSettings ? 1.5 : null, context, ramp);
  setParamIfChanged(node.limiter.attack, 0.002, previousSettings ? 0.002 : null, context, ramp);
  setParamIfChanged(
    node.limiter.release,
    (110 - 55 * speed) / 1000,
    previousSpeed === null ? null : (110 - 55 * previousSpeed) / 1000,
    context,
    ramp
  );
  if (!previousSettings || settings.ceilingDb !== previousSettings.ceilingDb) {
    node.saturator.curve = createSafeLimiterCurve(settings.ceilingDb);
  }
  setParamIfChanged(node.dry.gain, transparent ? 1 : 0, previousTransparent === null ? null : previousTransparent ? 1 : 0, context, ramp);
  setParamIfChanged(node.processed.gain, transparent ? 0 : 1, previousTransparent === null ? null : previousTransparent ? 0 : 1, context, ramp);
}

function setWorkletParamIfChanged(
  node: AudioWorkletNode | null,
  name: string,
  value: number,
  previousValue: number | null,
  context: BaseAudioContext,
  ramp: boolean
): void {
  if (!node || previousValue === value) return;
  const parameter = node.parameters.get(name);
  if (parameter) setParam(parameter, value, context, ramp);
}

function setParamIfChanged(
  parameter: AudioParam,
  value: number,
  previousValue: number | null,
  context: BaseAudioContext,
  ramp: boolean
): void {
  if (previousValue === value) return;
  setParam(parameter, value, context, ramp);
}

function setParam(parameter: AudioParam, value: number, context: BaseAudioContext, ramp: boolean): void {
  if (ramp) setAudioParam(parameter, value, context);
  else parameter.value = value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
