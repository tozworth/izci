import { writable } from 'svelte/store';
import type { PlaybackSettings } from '$lib/types';

export const PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.playback-settings';
export const PLAYBACK_SETTINGS_CHANNEL = 'izci-playback-settings';

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  logarithmicVolume: true
};

let broadcastChannel: BroadcastChannel | null = null;
let syncInitialized = false;

function normalizeSettings(value: unknown): PlaybackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PlaybackSettings>) : {};

  return {
    logarithmicVolume:
      typeof source.logarithmicVolume === 'boolean'
        ? source.logarithmicVolume
        : DEFAULT_PLAYBACK_SETTINGS.logarithmicVolume
  };
}

function readStoredSettings(): PlaybackSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYBACK_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(PLAYBACK_SETTINGS_STORAGE_KEY);
    return rawValue ? normalizeSettings(JSON.parse(rawValue)) : DEFAULT_PLAYBACK_SETTINGS;
  } catch {
    return DEFAULT_PLAYBACK_SETTINGS;
  }
}

function persistSettings(settings: PlaybackSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PLAYBACK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  broadcastChannel?.postMessage(settings);
}

const store = writable<PlaybackSettings>(readStoredSettings());
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
    if (event.key !== PLAYBACK_SETTINGS_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_PLAYBACK_SETTINGS);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(PLAYBACK_SETTINGS_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeSettings(event.data));
    });
  }
}

function setSettings(nextValue: unknown): PlaybackSettings {
  const normalized = normalizeSettings(nextValue);
  persistSettings(normalized);
  store.set(normalized);
  return normalized;
}

initializeSync();

export const playbackSettings = {
  subscribe: store.subscribe,
  getSnapshot(): PlaybackSettings {
    return currentSettings;
  },
  update(patch: Partial<PlaybackSettings>): PlaybackSettings {
    return setSettings({ ...currentSettings, ...patch });
  },
  reset(): PlaybackSettings {
    return setSettings(DEFAULT_PLAYBACK_SETTINGS);
  }
};
