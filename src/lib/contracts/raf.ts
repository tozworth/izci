export type RafAutoAmpMode = 'off' | 'reduce' | 'increase' | 'dynamic';
export type RafEffectType =
  | 'auto-amp'
  | 'graphic-eq'
  | 'stereo-width'
  | 'crystalizer'
  | 'sloptimizer'
  | 'reverb';

export interface RafEffectBase {
  id: string;
  enabled: boolean;
  displayName?: string;
}

export interface RafAutoAmpSettings extends RafEffectBase {
  type: 'auto-amp';
  gainDb: number;
  mode: RafAutoAmpMode;
  targetDb: number;
  maximumReductionDb: number;
  maximumBoostDb: number;
  peakHoldSeconds: number;
  recoveryDbPerSecond: number;
  lookaheadMs: number;
}

export interface RafGraphicEqSettings extends RafEffectBase {
  type: 'graphic-eq';
  preampDb: number;
  bandGainsDb: number[];
}

export interface RafStereoWidthSettings extends RafEffectBase {
  type: 'stereo-width';
  widthDb: number;
}

export interface RafCrystalizerSettings extends RafEffectBase {
  type: 'crystalizer';
  bandIntensities: number[];
  bandMuted: boolean[];
  bandBypassed: boolean[];
}

export interface RafSloptimizerSettings extends RafEffectBase {
  type: 'sloptimizer';
  advanced: boolean;
  slop: number;
  customized: boolean;
  lowLiftDb: number;
  midLiftDb: number;
  highLiftDb: number;
  lowCrossoverHz: number;
  highCrossoverHz: number;
  density: number;
  speed: number;
  upwardRatio: number;
  upwardThresholdDb: number;
  upwardMaximumBoostDb: number;
  ceilingDb: number;
}

export interface RafReverbSettings extends RafEffectBase {
  type: 'reverb';
  mix: number;
  roomSize: number;
  decaySeconds: number;
  preDelayMs: number;
  dampingHz: number;
}

export type RafEffectSettings =
  | RafAutoAmpSettings
  | RafGraphicEqSettings
  | RafStereoWidthSettings
  | RafCrystalizerSettings
  | RafSloptimizerSettings
  | RafReverbSettings;

export interface RafRackSettings {
  enabled: boolean;
  effects: RafEffectSettings[];
}

export interface RafPresetSettings {
  effects: RafEffectSettings[];
}

export interface RafPreset {
  id: string;
  name: string;
  settings: RafPresetSettings;
}

export interface RafPresetState {
  presets: RafPreset[];
  selectedPresetId: string | null;
}
