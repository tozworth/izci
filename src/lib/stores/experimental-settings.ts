import { createPersistentStore } from './persistent-store';

export interface ExperimentalSettings {
  rafEffectsList: boolean;
}

export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = 'izci.experimental-settings';
export const EXPERIMENTAL_SETTINGS_CHANNEL = 'izci-experimental-settings';
export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  rafEffectsList: false
};

export function normalizeExperimentalSettings(value: unknown): ExperimentalSettings {
  if (!value || typeof value !== 'object') return DEFAULT_EXPERIMENTAL_SETTINGS;
  const source = value as Partial<ExperimentalSettings>;
  return {
    rafEffectsList: typeof source.rafEffectsList === 'boolean'
      ? source.rafEffectsList
      : DEFAULT_EXPERIMENTAL_SETTINGS.rafEffectsList
  };
}

const store = createPersistentStore({
  storageKey: EXPERIMENTAL_SETTINGS_STORAGE_KEY,
  channelName: EXPERIMENTAL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_EXPERIMENTAL_SETTINGS,
  normalize: normalizeExperimentalSettings
});

export const experimentalSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  update(changes: Partial<ExperimentalSettings>): ExperimentalSettings {
    return store.update((settings) => ({ ...settings, ...changes }));
  },
  reset: store.reset
};
