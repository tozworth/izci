import type { ModuleInterpolationFilter, ModulePlaybackSettings } from '$lib/contracts/module-playback';
import { createSettingsStore } from './persistent-store';

export const MODULE_PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.module-playback-settings.v1';
export const MODULE_PLAYBACK_SETTINGS_CHANNEL = 'izci-module-playback-settings';

export const DEFAULT_MODULE_PLAYBACK_SETTINGS: ModulePlaybackSettings = {
  repeatCount: 0,
  stereoSeparation: 50,
  panStrength: 100,
  interpolationFilter: 1,
  tempoFactor: 1,
  pitchFactor: 1
};

export const MODULE_INTERPOLATION_OPTIONS: Array<{
  value: ModuleInterpolationFilter;
  label: string;
  hint: string;
}> = [
  { value: 1, label: '1-tap (minimal)', hint: 'Minimal smoothing (sharper, more artifacts)' },
  { value: 2, label: '2-tap (soft)', hint: 'Soft smoothing.' },
  { value: 4, label: '4-tap (medium)', hint: 'Medium smoothing.' },
  { value: 8, label: '8-tap (high)', hint: 'High smoothing (blurry, less artifacts)' }
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function toInterpolationFilter(value: unknown): ModuleInterpolationFilter {
  const normalized = toNumber(value, DEFAULT_MODULE_PLAYBACK_SETTINGS.interpolationFilter);

  if (normalized === 1 || normalized === 2 || normalized === 4 || normalized === 8) {
    return normalized;
  }

  return DEFAULT_MODULE_PLAYBACK_SETTINGS.interpolationFilter;
}

export function normalizeModulePlaybackSettings(value: unknown): ModulePlaybackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<ModulePlaybackSettings>) : {};

  return {
    repeatCount: Math.round(clamp(toNumber(source.repeatCount, DEFAULT_MODULE_PLAYBACK_SETTINGS.repeatCount), -1, 32)),
    stereoSeparation: Math.round(
      clamp(
        toNumber(source.stereoSeparation, DEFAULT_MODULE_PLAYBACK_SETTINGS.stereoSeparation),
        0,
        200
      )
    ),
    panStrength: Math.round(
      clamp(
        toNumber(source.panStrength, DEFAULT_MODULE_PLAYBACK_SETTINGS.panStrength),
        0,
        200
      )
    ),
    interpolationFilter: toInterpolationFilter(source.interpolationFilter),
    tempoFactor: clamp(toNumber(source.tempoFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.tempoFactor), 0.25, 4),
    pitchFactor: clamp(toNumber(source.pitchFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.pitchFactor), 0.25, 4)
  };
}

export const modulePlaybackSettings = createSettingsStore({
  storageKey: MODULE_PLAYBACK_SETTINGS_STORAGE_KEY,
  channelName: MODULE_PLAYBACK_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_MODULE_PLAYBACK_SETTINGS,
  normalize: normalizeModulePlaybackSettings
});
