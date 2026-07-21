import { createSettingsStore } from './persistent-store';

export interface ExperimentalSettings {
  stemSeparation: boolean;
}

export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = 'izci.experimental-settings';
export const EXPERIMENTAL_SETTINGS_CHANNEL = 'izci.experimental-settings';

export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  stemSeparation: false
};

export function normalizeExperimentalSettings(value: unknown): ExperimentalSettings {
  const source = value && typeof value === 'object' ? (value as Partial<ExperimentalSettings>) : {};

  return {
    stemSeparation: source.stemSeparation === true
  };
}

export const experimentalSettings = createSettingsStore({
  storageKey: EXPERIMENTAL_SETTINGS_STORAGE_KEY,
  channelName: EXPERIMENTAL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_EXPERIMENTAL_SETTINGS,
  normalize: normalizeExperimentalSettings
});
