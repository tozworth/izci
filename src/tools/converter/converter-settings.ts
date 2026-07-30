import {
  DEFAULT_CONVERTER_SETTINGS,
  normalizeConverterSettings,
  type ConverterSettings
} from './converter-options';

const STORAGE_KEY = 'izci:converter-settings';

export function loadConverterSettings(): ConverterSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CONVERTER_SETTINGS };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return normalizeConverterSettings(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_CONVERTER_SETTINGS };
  }
}

export function saveConverterSettings(settings: ConverterSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeConverterSettings(settings)));
  } catch {
    // Conversion remains usable when storage is unavailable or full.
  }
}
