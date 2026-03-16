import { writable } from 'svelte/store';
import type { ModuleInterpolationFilter, ModulePlaybackSettings } from '$lib/types';

export const MODULE_PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.module-playback-settings.v1';
export const MODULE_PLAYBACK_SETTINGS_CHANNEL = 'izci-module-playback-settings';

export const DEFAULT_MODULE_PLAYBACK_SETTINGS: ModulePlaybackSettings = {
  repeatCount: 0,
  stereoSeparation: 100,
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

let broadcastChannel: BroadcastChannel | null = null;

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

function normalizeSettings(value: unknown): ModulePlaybackSettings {
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
    interpolationFilter: toInterpolationFilter(source.interpolationFilter),
    tempoFactor: clamp(toNumber(source.tempoFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.tempoFactor), 0.25, 4),
    pitchFactor: clamp(toNumber(source.pitchFactor, DEFAULT_MODULE_PLAYBACK_SETTINGS.pitchFactor), 0.25, 4)
  };
}

function readStoredSettings(): ModulePlaybackSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_MODULE_PLAYBACK_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(MODULE_PLAYBACK_SETTINGS_STORAGE_KEY);
    return rawValue ? normalizeSettings(JSON.parse(rawValue)) : DEFAULT_MODULE_PLAYBACK_SETTINGS;
  } catch {
    return DEFAULT_MODULE_PLAYBACK_SETTINGS;
  }
}

function persistSettings(settings: ModulePlaybackSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(MODULE_PLAYBACK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  broadcastChannel?.postMessage(settings);
}

const store = writable<ModulePlaybackSettings>(readStoredSettings());
let currentSettings = readStoredSettings();
let syncInitialized = false;

store.subscribe((value) => {
  currentSettings = value;
});

function initializeSync(): void {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== MODULE_PLAYBACK_SETTINGS_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_MODULE_PLAYBACK_SETTINGS);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(MODULE_PLAYBACK_SETTINGS_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeSettings(event.data));
    });
  }
}

initializeSync();

function setSettings(nextValue: unknown): ModulePlaybackSettings {
  const normalized = normalizeSettings(nextValue);
  store.set(normalized);
  persistSettings(normalized);
  return normalized;
}

export const modulePlaybackSettings = {
  subscribe: store.subscribe,
  getSnapshot(): ModulePlaybackSettings {
    return currentSettings;
  },
  update(patch: Partial<ModulePlaybackSettings>): ModulePlaybackSettings {
    return setSettings({ ...currentSettings, ...patch });
  },
  reset(): ModulePlaybackSettings {
    return setSettings(DEFAULT_MODULE_PLAYBACK_SETTINGS);
  }
};
