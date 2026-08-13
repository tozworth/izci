import {
  DEFAULT_CONVERTER_SETTINGS,
  normalizeConverterSettings,
  type ConverterSettings
} from './converter-options';
import { createPersistentStore } from '$lib/settings/store';

export const CONVERTER_SETTINGS_STORAGE_KEY = 'izci:converter-settings';
export const CONVERTER_SETTINGS_CHANNEL = 'izci-converter-settings';

export const converterSettings = createPersistentStore({
  storageKey: CONVERTER_SETTINGS_STORAGE_KEY,
  channelName: CONVERTER_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_CONVERTER_SETTINGS,
  normalize: normalizeConverterSettings
});

export function loadConverterSettings(): ConverterSettings {
  return converterSettings.getSnapshot();
}

export function saveConverterSettings(settings: ConverterSettings): void {
  converterSettings.set(settings);
}
