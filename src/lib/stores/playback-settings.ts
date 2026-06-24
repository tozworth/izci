import type { PlaybackSettings } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const PLAYBACK_SETTINGS_STORAGE_KEY = 'izci.playback-settings';
export const PLAYBACK_SETTINGS_CHANNEL = 'izci-playback-settings';

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  logarithmicVolume: true
};

function normalizeSettings(value: unknown): PlaybackSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PlaybackSettings>) : {};

  return {
    logarithmicVolume:
      typeof source.logarithmicVolume === 'boolean'
        ? source.logarithmicVolume
        : DEFAULT_PLAYBACK_SETTINGS.logarithmicVolume
  };
}

const store = createPersistentStore({
  storageKey: PLAYBACK_SETTINGS_STORAGE_KEY,
  channelName: PLAYBACK_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_PLAYBACK_SETTINGS,
  normalize: normalizeSettings
});

export const playbackSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  update(patch: Partial<PlaybackSettings>): PlaybackSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
