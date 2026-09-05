import type { LoadoutCategory } from '$lib/types';
import { createSettingsStore } from './persistent-store';

const LOADOUT_UI_SETTINGS_STORAGE_KEY = 'izci.loadout-ui-settings';
const LOADOUT_UI_SETTINGS_CHANNEL = 'izci-loadout-ui-settings';
export const DEFAULT_LOADOUT_CAPTURE_CATEGORIES: LoadoutCategory[] = [
  'playback',
  'raf',
  'appearance'
];

interface LoadoutUiSettings {
  captureCategories: LoadoutCategory[];
}

function isLoadoutCategory(value: unknown): value is LoadoutCategory {
  return value === 'playback' || value === 'raf' || value === 'appearance';
}

export function normalizeLoadoutUiSettings(value: unknown): LoadoutUiSettings {
  const source = value && typeof value === 'object' ? (value as Partial<LoadoutUiSettings>) : {};
  const captureCategories = Array.isArray(source.captureCategories)
    ? [...new Set(source.captureCategories.filter(isLoadoutCategory))]
    : DEFAULT_LOADOUT_CAPTURE_CATEGORIES;

  return { captureCategories };
}

export const loadoutUiSettings = createSettingsStore({
  storageKey: LOADOUT_UI_SETTINGS_STORAGE_KEY,
  channelName: LOADOUT_UI_SETTINGS_CHANNEL,
  defaultValue: { captureCategories: DEFAULT_LOADOUT_CAPTURE_CATEGORIES },
  normalize: normalizeLoadoutUiSettings
});
