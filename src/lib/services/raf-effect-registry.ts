import type {
  RafEffectSettings,
  RafEffectType,
  RafGraphicEqSettings,
  RafStereoWidthSettings
} from '$lib/types';
import {
  GRAPHIC_EQ_FREQUENCIES,
  RAF_GAIN_MAX_DB,
  RAF_GAIN_MIN_DB,
  createGraphicEqNode,
  disposeGraphicEqNode,
  updateGraphicEqNode
} from './raf-effects/graphic-eq';
import { STEREO_WIDTH_MAX_DB, STEREO_WIDTH_MIN_DB, createStereoWidthNode, disposeStereoWidthNode, updateStereoWidthNode } from './raf-effects/mid-side';
import type { RafEffectNode } from './raf-effects/shared';

export interface RafEffectDefinition {
  type: RafEffectType;
  name: string;
  icon: string;
  createDefault: (id: string) => RafEffectSettings;
  normalize: (value: unknown) => RafEffectSettings | null;
  createNode: (context: BaseAudioContext, settings: RafEffectSettings) => RafEffectNode;
  updateNode: (node: RafEffectNode, settings: RafEffectSettings, context: BaseAudioContext) => void;
  disposeNode: (node: RafEffectNode) => void;
}

function normalizeGain(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(RAF_GAIN_MAX_DB, Math.max(RAF_GAIN_MIN_DB, value))
    : null;
}

function normalizeBase(value: unknown, type: RafEffectType): { id: string; enabled: boolean } | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (source.type !== type || typeof source.enabled !== 'boolean') return null;
  if (typeof source.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source.id)) return null;
  return { id: source.id, enabled: source.enabled };
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
  updateNode: (node, settings, context) =>
    updateGraphicEqNode(node as ReturnType<typeof createGraphicEqNode>, settings as RafGraphicEqSettings, context),
  disposeNode: (node) => disposeGraphicEqNode(node as ReturnType<typeof createGraphicEqNode>)
};

const stereoWidthDefinition: RafEffectDefinition = {
  type: 'stereo-width',
  name: 'Stereo Width',
  icon: 'swap_horiz',
  createDefault: (id) => ({ id, type: 'stereo-width', enabled: true, widthDb: 0 }),
  normalize: normalizeStereoWidth,
  createNode: (context, settings) => createStereoWidthNode(context, settings as RafStereoWidthSettings),
  updateNode: (node, settings, context) =>
    updateStereoWidthNode(node as ReturnType<typeof createStereoWidthNode>, settings as RafStereoWidthSettings, context),
  disposeNode: (node) => disposeStereoWidthNode(node as ReturnType<typeof createStereoWidthNode>)
};

export const RAF_EFFECT_DEFINITIONS = [graphicEqDefinition, stereoWidthDefinition] as const;
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
