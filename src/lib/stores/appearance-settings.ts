import { writable } from 'svelte/store';
import type { AppearanceSettings, ColorTheme } from '$lib/types';

export const APPEARANCE_SETTINGS_STORAGE_KEY = 'izci.appearance-settings';
export const APPEARANCE_SETTINGS_CHANNEL = 'izci.appearance-settings';
export const DEFAULT_COLOR_THEME: ColorTheme = 'gruvbox';
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorTheme: DEFAULT_COLOR_THEME,
  keepLibraryColumnsVisibleInNarrowLayout: false
};

let broadcastChannel: BroadcastChannel | null = null;
let syncInitialized = false;

function normalizeColorTheme(value: unknown): ColorTheme {
  return value === 'dracula' ? 'dracula' : DEFAULT_COLOR_THEME;
}

function normalizeSettings(value: unknown): AppearanceSettings {
  const source = value && typeof value === 'object' ? (value as Partial<AppearanceSettings>) : {};

  return {
    colorTheme: normalizeColorTheme(source.colorTheme),
    keepLibraryColumnsVisibleInNarrowLayout: source.keepLibraryColumnsVisibleInNarrowLayout === true
  };
}

function readStoredSettings(): AppearanceSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_APPEARANCE_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(APPEARANCE_SETTINGS_STORAGE_KEY);
    return rawValue ? normalizeSettings(JSON.parse(rawValue)) : DEFAULT_APPEARANCE_SETTINGS;
  } catch {
    return DEFAULT_APPEARANCE_SETTINGS;
  }
}

function persistSettings(settings: AppearanceSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(APPEARANCE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  broadcastChannel?.postMessage(settings);
}

const store = writable<AppearanceSettings>(readStoredSettings());
let currentSettings = readStoredSettings();

store.subscribe((value) => {
  currentSettings = value;
});

function initializeSync(): void {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== APPEARANCE_SETTINGS_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_APPEARANCE_SETTINGS);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(APPEARANCE_SETTINGS_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeSettings(event.data));
    });
  }
}

function setSettings(nextValue: unknown): AppearanceSettings {
  const normalized = normalizeSettings(nextValue);
  store.set(normalized);
  persistSettings(normalized);
  return normalized;
}

initializeSync();

export const appearanceSettings = {
  subscribe: store.subscribe,
  getSnapshot(): AppearanceSettings {
    return currentSettings;
  },
  update(patch: Partial<AppearanceSettings>): AppearanceSettings {
    return setSettings({ ...currentSettings, ...patch });
  },
  reset(): AppearanceSettings {
    return setSettings(DEFAULT_APPEARANCE_SETTINGS);
  }
};
