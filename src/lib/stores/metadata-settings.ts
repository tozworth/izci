import { writable } from 'svelte/store';
import type { MetadataSettings } from '$lib/types';

export const METADATA_SETTINGS_STORAGE_KEY = 'izci.metadata-settings';
export const METADATA_SETTINGS_CHANNEL = 'izci.metadata-settings';

export const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  inferFromFilename: true
};

function normalizeSettings(value: unknown): MetadataSettings {
  const source = value && typeof value === 'object' ? (value as Partial<MetadataSettings>) : {};

  return {
    inferFromFilename:
      typeof source.inferFromFilename === 'boolean'
        ? source.inferFromFilename
        : DEFAULT_METADATA_SETTINGS.inferFromFilename
  };
}

function readStoredSettings(): MetadataSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_METADATA_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(METADATA_SETTINGS_STORAGE_KEY);
    return rawValue ? normalizeSettings(JSON.parse(rawValue)) : DEFAULT_METADATA_SETTINGS;
  } catch {
    return DEFAULT_METADATA_SETTINGS;
  }
}

function persistSettings(settings: MetadataSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(METADATA_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

const store = writable<MetadataSettings>(readStoredSettings());
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
    if (event.key !== METADATA_SETTINGS_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_METADATA_SETTINGS);
    }
  });

  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(METADATA_SETTINGS_CHANNEL);
    channel.addEventListener('message', (event) => {
      store.set(normalizeSettings(event.data));
    });
  }
}

function setSettings(nextValue: unknown): MetadataSettings {
  const normalized = normalizeSettings(nextValue);
  persistSettings(normalized);
  store.set(normalized);
  return normalized;
}

initializeSync();

export const metadataSettings = {
  subscribe: store.subscribe,
  getSnapshot(): MetadataSettings {
    return currentSettings;
  },
  update(patch: Partial<MetadataSettings>): MetadataSettings {
    return setSettings({ ...currentSettings, ...patch });
  },
  reset(): MetadataSettings {
    return setSettings(DEFAULT_METADATA_SETTINGS);
  }
};
