import type {
  RafEffectSettings,
  RafEffectType,
  RafGraphicEqSettings,
  RafMidSideSettings
} from '$lib/types';
import {
  GRAPHIC_EQ_FREQUENCIES,
  RAF_GAIN_MAX_DB,
  RAF_GAIN_MIN_DB,
  createGraphicEqNode,
  disposeGraphicEqNode,
  updateGraphicEqNode
} from './raf-effects/graphic-eq';
import { createMidSideNode, disposeMidSideNode, updateMidSideNode } from './raf-effects/mid-side';
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

function normalizeMidSide(value: unknown): RafMidSideSettings | null {
  const base = normalizeBase(value, 'mid-side');
  if (!base) return null;
  const source = value as Record<string, unknown>;
  const midGainDb = normalizeGain(source.midGainDb);
  const sideGainDb = normalizeGain(source.sideGainDb);
  return midGainDb === null || sideGainDb === null
    ? null
    : { ...base, type: 'mid-side', midGainDb, sideGainDb };
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

const midSideDefinition: RafEffectDefinition = {
  type: 'mid-side',
  name: 'Mid/Side',
  icon: 'swap_horiz',
  createDefault: (id) => ({ id, type: 'mid-side', enabled: true, midGainDb: 0, sideGainDb: 0 }),
  normalize: normalizeMidSide,
  createNode: (context, settings) => createMidSideNode(context, settings as RafMidSideSettings),
  updateNode: (node, settings, context) =>
    updateMidSideNode(node as ReturnType<typeof createMidSideNode>, settings as RafMidSideSettings, context),
  disposeNode: (node) => disposeMidSideNode(node as ReturnType<typeof createMidSideNode>)
};

export const RAF_EFFECT_DEFINITIONS = [graphicEqDefinition, midSideDefinition] as const;
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
