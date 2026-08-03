import type { ExperimentalSettings } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = 'izci.experimental-settings';
export const EXPERIMENTAL_SETTINGS_CHANNEL = 'izci-experimental-settings';

export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  multiplayer: false
};

export function normalizeExperimentalSettings(value: unknown): ExperimentalSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<ExperimentalSettings>
    : {};

  return {
    multiplayer: typeof source.multiplayer === 'boolean'
      ? source.multiplayer
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayer
  };
}

export const experimentalSettings = createSettingsStore({
  storageKey: EXPERIMENTAL_SETTINGS_STORAGE_KEY,
  channelName: EXPERIMENTAL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_EXPERIMENTAL_SETTINGS,
  normalize: normalizeExperimentalSettings
});
