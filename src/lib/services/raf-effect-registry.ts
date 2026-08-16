import type {
  RafAutoAmpSettings,
  RafCrystalizerSettings,
  RafEffectSettings,
  RafEffectType,
  RafGraphicEqSettings,
  RafPitchEngine,
  RafPitchSettings,
  RafReverbSettings,
  RafSloptimizerSettings,
  RafStereoWidthSettings
} from '$lib/types';
import {
  AUTO_AMP_BOOST_MAX_DB,
  AUTO_AMP_GAIN_MAX_DB,
  AUTO_AMP_GAIN_MIN_DB,
  AUTO_AMP_LOOKAHEAD_MAX_MS,
  AUTO_AMP_LOOKAHEAD_MIN_MS,
  AUTO_AMP_PEAK_HOLD_MAX_SECONDS,
  AUTO_AMP_RECOVERY_MAX_DB_PER_SECOND,
  AUTO_AMP_RECOVERY_MIN_DB_PER_SECOND,
  AUTO_AMP_REDUCTION_MAX_DB,
  AUTO_AMP_TARGET_MAX_DB,
  AUTO_AMP_TARGET_MIN_DB,
  createAutoAmpNode,
  disposeAutoAmpNode,
  isAutoAmpMode,
  updateAutoAmpNode
} from './raf-effects/auto-amp';
import {
  CRYSTALIZER_FREQUENCIES,
  CRYSTALIZER_INTENSITY_MAX,
  CRYSTALIZER_INTENSITY_MIN,
  createCrystalizerNode,
  disposeCrystalizerNode,
  updateCrystalizerNode
} from './raf-effects/crystalizer';
import {
  GRAPHIC_EQ_FREQUENCIES,
  RAF_GAIN_MAX_DB,
  RAF_GAIN_MIN_DB,
  createGraphicEqNode,
  disposeGraphicEqNode,
  updateGraphicEqNode
} from './raf-effects/graphic-eq';
import { STEREO_WIDTH_MAX_DB, STEREO_WIDTH_MIN_DB, createStereoWidthNode, disposeStereoWidthNode, updateStereoWidthNode } from './raf-effects/mid-side';
import {
  REVERB_DAMPING_MAX_HZ,
  REVERB_DAMPING_MIN_HZ,
  REVERB_DECAY_MAX_SECONDS,
  REVERB_DECAY_MIN_SECONDS,
  REVERB_MIX_MAX,
  REVERB_MIX_MIN,
  REVERB_PRE_DELAY_MAX_MS,
  REVERB_PRE_DELAY_MIN_MS,
  REVERB_ROOM_SIZE_MAX,
  REVERB_ROOM_SIZE_MIN,
  createReverbNode,
  disposeReverbNode,
  updateReverbNode
} from './raf-effects/reverb';
import {
  SLOPTIMIZER_CEILING_MAX_DB,
  SLOPTIMIZER_CEILING_MIN_DB,
  SLOPTIMIZER_DENSITY_MAX,
  SLOPTIMIZER_DENSITY_MIN,
  SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ,
  SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ,
  SLOPTIMIZER_LIFT_MAX_DB,
  SLOPTIMIZER_LIFT_MIN_DB,
  SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ,
  SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ,
  SLOPTIMIZER_SLOP_MAX,
  SLOPTIMIZER_SLOP_MIN,
  SLOPTIMIZER_SPEED_MAX,
  SLOPTIMIZER_SPEED_MIN,
  SLOPTIMIZER_UPWARD_BOOST_MAX_DB,
  SLOPTIMIZER_UPWARD_BOOST_MIN_DB,
  SLOPTIMIZER_UPWARD_RATIO_MAX,
  SLOPTIMIZER_UPWARD_RATIO_MIN,
  SLOPTIMIZER_UPWARD_THRESHOLD_MAX_DB,
  SLOPTIMIZER_UPWARD_THRESHOLD_MIN_DB,
  SLOPTIMIZER_CROSSOVERS,
  createSloptimizerNode,
  disposeSloptimizerNode,
  mapSlopToParameters,
  updateSloptimizerNode
} from './raf-effects/sloptimizer';
import type { RafEffectNode } from './raf-effects/shared';
import {
  PITCH_ALIGNMENT_OPTIONS,
  PITCH_DEFAULT_ALIGNMENT_WINDOW,
  PITCH_DEFAULT_GRAIN_SIZE,
  PITCH_DEFAULT_MAX_PEAKS,
  PITCH_DEFAULT_PEAK_FLOOR_DB,
  PITCH_DEFAULT_WINDOW_SIZE,
  PITCH_GRAIN_SIZES,
  PITCH_MAX_PEAKS_OPTIONS,
  PITCH_PEAK_FLOOR_OPTIONS,
  PITCH_SEMITONES_MAX,
  PITCH_SEMITONES_MIN,
  PITCH_WINDOW_SIZES,
  createPitchNode,
  disposePitchNode,
  isRafPitchEngine,
  updatePitchNode
} from './raf-effects/pitch';

export interface RafEffectDefinition {
  type: RafEffectType;
  name: string;
  icon: string;
  createDefault: (id: string) => RafEffectSettings;
  normalize: (value: unknown) => RafEffectSettings | null;
  createNode: (context: BaseAudioContext, settings: RafEffectSettings) => RafEffectNode;
  updateNode: (
    node: RafEffectNode,
    settings: RafEffectSettings,
    context: BaseAudioContext,
    previousSettings?: RafEffectSettings
  ) => void;
  disposeNode: (node: RafEffectNode) => void;
}

function normalizeGain(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(RAF_GAIN_MAX_DB, Math.max(RAF_GAIN_MIN_DB, value))
    : null;
}

function normalizeAutoAmp(value: unknown): RafAutoAmpSettings | null {
  const base = normalizeBase(value, 'auto-amp');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  const numericKeys = [
    'gainDb',
    'targetDb',
    'maximumReductionDb',
    'maximumBoostDb',
    'peakHoldSeconds',
    'recoveryDbPerSecond',
    'lookaheadMs'
  ] as const;
  if (!isAutoAmpMode(source.mode) || !numericKeys.every((key) => typeof source[key] === 'number' && Number.isFinite(source[key]))) {
    return null;
  }
  return {
    ...base,
    type: 'auto-amp',
    gainDb: clamp(source.gainDb as number, AUTO_AMP_GAIN_MIN_DB, AUTO_AMP_GAIN_MAX_DB),
    mode: source.mode,
    targetDb: clamp(source.targetDb as number, AUTO_AMP_TARGET_MIN_DB, AUTO_AMP_TARGET_MAX_DB),
    maximumReductionDb: clamp(source.maximumReductionDb as number, 0, AUTO_AMP_REDUCTION_MAX_DB),
    maximumBoostDb: clamp(source.maximumBoostDb as number, 0, AUTO_AMP_BOOST_MAX_DB),
    peakHoldSeconds: clamp(source.peakHoldSeconds as number, 0, AUTO_AMP_PEAK_HOLD_MAX_SECONDS),
    recoveryDbPerSecond: clamp(
      source.recoveryDbPerSecond as number,
      AUTO_AMP_RECOVERY_MIN_DB_PER_SECOND,
      AUTO_AMP_RECOVERY_MAX_DB_PER_SECOND
    ),
    lookaheadMs: clamp(source.lookaheadMs as number, AUTO_AMP_LOOKAHEAD_MIN_MS, AUTO_AMP_LOOKAHEAD_MAX_MS)
  };
}

export function normalizeRafEffectDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const displayName = value.trim().replace(/\s+/g, ' ').slice(0, 64);
  return displayName || undefined;
}

function normalizeBase(value: unknown, type: RafEffectType): { id: string; enabled: boolean; displayName?: string } | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (source.type !== type || typeof source.enabled !== 'boolean') return null;
  if (typeof source.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.id)) return null;
  const displayName = normalizeRafEffectDisplayName(source.displayName);
  return { id: source.id, enabled: source.enabled, ...(displayName ? { displayName } : {}) };
}

function normalizeGraphicEq(value: unknown): RafGraphicEqSettings | null {
  const base = normalizeBase(value, 'graphic-eq');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  const preampDb = normalizeGain(source.preampDb);
  if (preampDb === null || !Array.isArray(source.bandGainsDb) || source.bandGainsDb.length !== GRAPHIC_EQ_FREQUENCIES.length) {
    return null;
  }
  const bandGainsDb = source.bandGainsDb.map(normalizeGain);
  if (bandGainsDb.some((gain) => gain === null)) return null;
  return { ...base, type: 'graphic-eq', preampDb, bandGainsDb: bandGainsDb as number[] };
}

function normalizeStereoWidth(value: unknown): RafStereoWidthSettings | null {
  const base = normalizeBase(value, 'stereo-width');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.widthDb !== 'number' || !Number.isFinite(source.widthDb)) return null;
  const widthDb = Math.min(STEREO_WIDTH_MAX_DB, Math.max(STEREO_WIDTH_MIN_DB, source.widthDb));
  return { ...base, type: 'stereo-width', widthDb };
}

function normalizeCrystalizer(value: unknown): RafCrystalizerSettings | null {
  const base = normalizeBase(value, 'crystalizer');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  const length = CRYSTALIZER_FREQUENCIES.length;
  if (
    !Array.isArray(source.bandIntensities) || source.bandIntensities.length !== length ||
    !Array.isArray(source.bandMuted) || source.bandMuted.length !== length ||
    !Array.isArray(source.bandBypassed) || source.bandBypassed.length !== length
  ) return null;
  if (!source.bandIntensities.every((intensity) => typeof intensity === 'number' && Number.isFinite(intensity))) return null;
  if (!source.bandMuted.every((muted) => typeof muted === 'boolean')) return null;
  if (!source.bandBypassed.every((bypassed) => typeof bypassed === 'boolean')) return null;
  return {
    ...base,
    type: 'crystalizer',
    bandIntensities: source.bandIntensities.map((intensity) =>
      Math.min(CRYSTALIZER_INTENSITY_MAX, Math.max(CRYSTALIZER_INTENSITY_MIN, intensity as number))
    ),
    bandMuted: [...source.bandMuted] as boolean[],
    bandBypassed: [...source.bandBypassed] as boolean[]
  };
}

function normalizeSloptimizer(value: unknown): RafSloptimizerSettings | null {
  const base = normalizeBase(value, 'sloptimizer');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.advanced !== 'boolean' || typeof source.customized !== 'boolean') return null;
  const numericKeys = [
    'slop',
    'lowLiftDb',
    'midLiftDb',
    'highLiftDb',
    'lowCrossoverHz',
    'highCrossoverHz',
    'density',
    'speed',
    'upwardRatio',
    'upwardThresholdDb',
    'upwardMaximumBoostDb',
    'ceilingDb'
  ] as const;
  if (!numericKeys.every((key) => typeof source[key] === 'number' && Number.isFinite(source[key]))) return null;
  const slop = clamp(source.slop as number, SLOPTIMIZER_SLOP_MIN, SLOPTIMIZER_SLOP_MAX);
  const customized = source.customized;
  const normalized: RafSloptimizerSettings = {
    ...base,
    type: 'sloptimizer',
    advanced: source.advanced,
    customized,
    slop,
    lowLiftDb: clamp(source.lowLiftDb as number, SLOPTIMIZER_LIFT_MIN_DB, SLOPTIMIZER_LIFT_MAX_DB),
    midLiftDb: clamp(source.midLiftDb as number, SLOPTIMIZER_LIFT_MIN_DB, SLOPTIMIZER_LIFT_MAX_DB),
    highLiftDb: clamp(source.highLiftDb as number, SLOPTIMIZER_LIFT_MIN_DB, SLOPTIMIZER_LIFT_MAX_DB),
    lowCrossoverHz: clamp(
      source.lowCrossoverHz as number,
      SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ,
      SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ
    ),
    highCrossoverHz: clamp(
      source.highCrossoverHz as number,
      SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ,
      SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ
    ),
    density: clamp(source.density as number, SLOPTIMIZER_DENSITY_MIN, SLOPTIMIZER_DENSITY_MAX),
    speed: clamp(source.speed as number, SLOPTIMIZER_SPEED_MIN, SLOPTIMIZER_SPEED_MAX),
    upwardRatio: clamp(source.upwardRatio as number, SLOPTIMIZER_UPWARD_RATIO_MIN, SLOPTIMIZER_UPWARD_RATIO_MAX),
    upwardThresholdDb: clamp(
      source.upwardThresholdDb as number,
      SLOPTIMIZER_UPWARD_THRESHOLD_MIN_DB,
      SLOPTIMIZER_UPWARD_THRESHOLD_MAX_DB
    ),
    upwardMaximumBoostDb: clamp(
      source.upwardMaximumBoostDb as number,
      SLOPTIMIZER_UPWARD_BOOST_MIN_DB,
      SLOPTIMIZER_UPWARD_BOOST_MAX_DB
    ),
    ceilingDb: clamp(source.ceilingDb as number, SLOPTIMIZER_CEILING_MIN_DB, SLOPTIMIZER_CEILING_MAX_DB)
  };
  return customized ? normalized : { ...normalized, ...mapSlopToParameters(slop) };
}

function normalizeReverb(value: unknown): RafReverbSettings | null {
  const base = normalizeBase(value, 'reverb');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  const numericKeys = ['mix', 'roomSize', 'decaySeconds', 'preDelayMs', 'dampingHz'] as const;
  if (!numericKeys.every((key) => typeof source[key] === 'number' && Number.isFinite(source[key]))) return null;
  return {
    ...base,
    type: 'reverb',
    mix: clamp(source.mix as number, REVERB_MIX_MIN, REVERB_MIX_MAX),
    roomSize: clamp(source.roomSize as number, REVERB_ROOM_SIZE_MIN, REVERB_ROOM_SIZE_MAX),
    decaySeconds: clamp(source.decaySeconds as number, REVERB_DECAY_MIN_SECONDS, REVERB_DECAY_MAX_SECONDS),
    preDelayMs: clamp(source.preDelayMs as number, REVERB_PRE_DELAY_MIN_MS, REVERB_PRE_DELAY_MAX_MS),
    dampingHz: clamp(source.dampingHz as number, REVERB_DAMPING_MIN_HZ, REVERB_DAMPING_MAX_HZ)
  };
}

function normalizePitchOption<T extends number>(value: unknown, options: readonly T[], fallback: T): T {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  let best = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const option of options) {
    const distance = Math.abs(option - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

function normalizePitch(value: unknown): RafPitchSettings | null {
  const base = normalizeBase(value, 'pitch');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.semitones !== 'number' || !Number.isFinite(source.semitones)) return null;
  const engine: RafPitchEngine = isRafPitchEngine(source.engine) ? source.engine : 'phase-vocoder';
  return {
    ...base,
    type: 'pitch',
    semitones: clamp(source.semitones as number, PITCH_SEMITONES_MIN, PITCH_SEMITONES_MAX),
    engine,
    windowSize: normalizePitchOption(source.windowSize, PITCH_WINDOW_SIZES, PITCH_DEFAULT_WINDOW_SIZE),
    maxPeaks: normalizePitchOption(source.maxPeaks, PITCH_MAX_PEAKS_OPTIONS, PITCH_DEFAULT_MAX_PEAKS),
    peakFloorDb: normalizePitchOption(source.peakFloorDb, PITCH_PEAK_FLOOR_OPTIONS, PITCH_DEFAULT_PEAK_FLOOR_DB),
    grainSize: normalizePitchOption(source.grainSize, PITCH_GRAIN_SIZES, PITCH_DEFAULT_GRAIN_SIZE),
    alignmentWindow: normalizePitchOption(
      source.alignmentWindow,
      PITCH_ALIGNMENT_OPTIONS,
      PITCH_DEFAULT_ALIGNMENT_WINDOW
    )
  };
}

const autoAmpDefinition: RafEffectDefinition = {
  type: 'auto-amp',
  name: 'Auto Amp',
  icon: 'instant_mix',
  createDefault: (id) => ({
    id,
    type: 'auto-amp',
    enabled: true,
    gainDb: 0,
    mode: 'off',
    targetDb: -1,
    maximumReductionDb: 24,
    maximumBoostDb: 18,
    peakHoldSeconds: 2,
    recoveryDbPerSecond: 2,
    lookaheadMs: 150
  }),
  normalize: normalizeAutoAmp,
  createNode: (context, settings) => createAutoAmpNode(context, settings as RafAutoAmpSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateAutoAmpNode(
      node as ReturnType<typeof createAutoAmpNode>,
      settings as RafAutoAmpSettings,
      context,
      previousSettings as RafAutoAmpSettings | undefined
    ),
  disposeNode: (node) => disposeAutoAmpNode(node as ReturnType<typeof createAutoAmpNode>)
};

const graphicEqDefinition: RafEffectDefinition = {
  type: 'graphic-eq',
  name: 'Graphic EQ',
  icon: 'equalizer',
  createDefault: (id) => ({
    id,
    type: 'graphic-eq',
    enabled: true,
    preampDb: 0,
    bandGainsDb: GRAPHIC_EQ_FREQUENCIES.map(() => 0)
  }),
  normalize: normalizeGraphicEq,
  createNode: (context, settings) => createGraphicEqNode(context, settings as RafGraphicEqSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateGraphicEqNode(
      node as ReturnType<typeof createGraphicEqNode>,
      settings as RafGraphicEqSettings,
      context,
      previousSettings as RafGraphicEqSettings | undefined
    ),
  disposeNode: (node) => disposeGraphicEqNode(node as ReturnType<typeof createGraphicEqNode>)
};

const stereoWidthDefinition: RafEffectDefinition = {
  type: 'stereo-width',
  name: 'Stereo Width',
  icon: 'swap_horiz',
  createDefault: (id) => ({ id, type: 'stereo-width', enabled: true, widthDb: 0 }),
  normalize: normalizeStereoWidth,
  createNode: (context, settings) => createStereoWidthNode(context, settings as RafStereoWidthSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateStereoWidthNode(
      node as ReturnType<typeof createStereoWidthNode>,
      settings as RafStereoWidthSettings,
      context,
      previousSettings as RafStereoWidthSettings | undefined
    ),
  disposeNode: (node) => disposeStereoWidthNode(node as ReturnType<typeof createStereoWidthNode>)
};

const crystalizerDefinition: RafEffectDefinition = {
  type: 'crystalizer',
  name: 'Crystalizer',
  icon: 'diamond',
  createDefault: (id) => ({
    id,
    type: 'crystalizer',
    enabled: true,
    bandIntensities: CRYSTALIZER_FREQUENCIES.map(() => 0),
    bandMuted: CRYSTALIZER_FREQUENCIES.map(() => false),
    bandBypassed: CRYSTALIZER_FREQUENCIES.map(() => false)
  }),
  normalize: normalizeCrystalizer,
  createNode: (context, settings) => createCrystalizerNode(context, settings as RafCrystalizerSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateCrystalizerNode(
      node as ReturnType<typeof createCrystalizerNode>,
      settings as RafCrystalizerSettings,
      context,
      previousSettings as RafCrystalizerSettings | undefined
    ),
  disposeNode: (node) => disposeCrystalizerNode(node as ReturnType<typeof createCrystalizerNode>)
};

const sloptimizerDefinition: RafEffectDefinition = {
  type: 'sloptimizer',
  name: 'Sloptimizer',
  icon: 'compress',
  createDefault: (id) => ({
    id,
    type: 'sloptimizer',
    enabled: true,
    advanced: false,
    slop: 0,
    customized: false,
    lowCrossoverHz: SLOPTIMIZER_CROSSOVERS[0],
    highCrossoverHz: SLOPTIMIZER_CROSSOVERS[1],
    ...mapSlopToParameters(0)
  }),
  normalize: normalizeSloptimizer,
  createNode: (context, settings) => createSloptimizerNode(context, settings as RafSloptimizerSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateSloptimizerNode(
      node as ReturnType<typeof createSloptimizerNode>,
      settings as RafSloptimizerSettings,
      context,
      previousSettings as RafSloptimizerSettings | undefined
    ),
  disposeNode: (node) => disposeSloptimizerNode(node as ReturnType<typeof createSloptimizerNode>)
};

const reverbDefinition: RafEffectDefinition = {
  type: 'reverb',
  name: 'Reverb',
  icon: 'blur_on',
  createDefault: (id) => ({
    id,
    type: 'reverb',
    enabled: true,
    mix: 18,
    roomSize: 55,
    decaySeconds: 2.2,
    preDelayMs: 18,
    dampingHz: 9_000
  }),
  normalize: normalizeReverb,
  createNode: (context, settings) => createReverbNode(context, settings as RafReverbSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updateReverbNode(
      node as ReturnType<typeof createReverbNode>,
      settings as RafReverbSettings,
      context,
      previousSettings as RafReverbSettings | undefined
    ),
  disposeNode: (node) => disposeReverbNode(node as ReturnType<typeof createReverbNode>)
};

const pitchDefinition: RafEffectDefinition = {
  type: 'pitch',
  name: 'Pitch',
  icon: 'music_note',
  createDefault: (id) => ({
    id,
    type: 'pitch',
    enabled: true,
    semitones: 0,
    engine: 'phase-vocoder',
    windowSize: PITCH_DEFAULT_WINDOW_SIZE,
    maxPeaks: PITCH_DEFAULT_MAX_PEAKS,
    peakFloorDb: PITCH_DEFAULT_PEAK_FLOOR_DB,
    grainSize: PITCH_DEFAULT_GRAIN_SIZE,
    alignmentWindow: PITCH_DEFAULT_ALIGNMENT_WINDOW
  }),
  normalize: normalizePitch,
  createNode: (context, settings) => createPitchNode(context, settings as RafPitchSettings),
  updateNode: (node, settings, context, previousSettings) =>
    updatePitchNode(
      node as ReturnType<typeof createPitchNode>,
      settings as RafPitchSettings,
      context,
      previousSettings as RafPitchSettings | undefined
    ),
  disposeNode: (node) => disposePitchNode(node as ReturnType<typeof createPitchNode>)
};

export const RAF_EFFECT_DEFINITIONS = [autoAmpDefinition, graphicEqDefinition, stereoWidthDefinition, crystalizerDefinition, sloptimizerDefinition, reverbDefinition, pitchDefinition] as const;
export const RAF_EFFECT_REGISTRY = Object.fromEntries(
  RAF_EFFECT_DEFINITIONS.map((definition) => [definition.type, definition])
) as Record<RafEffectType, RafEffectDefinition>;

export function isRafEffectType(value: unknown): value is RafEffectType {
  return typeof value === 'string' && value in RAF_EFFECT_REGISTRY;
}

export function normalizeRafEffect(value: unknown): RafEffectSettings | null {
  if (!value || typeof value !== 'object') return null;
  const type = (value as { type?: unknown }).type;
  return isRafEffectType(type) ? RAF_EFFECT_REGISTRY[type].normalize(value) : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
