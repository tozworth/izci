import type { ModuleInterpolationFilter, ModulePlaybackSettings, ModuleRamping } from '$lib/types';
import { createSettingsStore } from './persistent-store';

const MODULE_PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.module-playback-settings.v1';
const MODULE_PLAYBACK_SETTINGS_CHANNEL = 'izci-module-playback-settings';

export const DEFAULT_MODULE_PLAYBACK_SETTINGS: ModulePlaybackSettings = {
  repeatCount: 0,
  stereoSeparation: 50,
  panStrength: 100,
  interpolationFilter: 1,
  ramping: 'normal',
  hivelyRampingMs: 5,
  tempoFactor: 1,
  pitchFactor: 1
};

export const MODULE_RAMPING_OPTIONS: ModuleRamping[] = ['off', 'short', 'normal', 'long'];

export function getHivelyRampingMs(settings: ModulePlaybackSettings): number {
  const factor = { off: 0, short: 0.5, normal: 1, long: 2 }[settings.ramping];
  return settings.hivelyRampingMs * factor;
}

export function getOpenMptRampingStrength(ramping: ModuleRamping): number {
  // Explicit strengths keep Short < Normal < Long; libopenmpt's automatic
  // default is much shorter and is not a suitable middle preset.
  return { off: 0, short: 2, normal: 5, long: 10 }[ramping];
}

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
    ramping: MODULE_RAMPING_OPTIONS.includes(source.ramping as ModuleRamping)
      ? source.ramping! : DEFAULT_MODULE_PLAYBACK_SETTINGS.ramping,
    hivelyRampingMs: Math.round(clamp(
      toNumber(source.hivelyRampingMs, DEFAULT_MODULE_PLAYBACK_SETTINGS.hivelyRampingMs), 1, 20
    ) * 10) / 10,
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
