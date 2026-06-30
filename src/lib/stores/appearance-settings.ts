import type { AppearanceSettings, ArtworkBackgroundMode, ColorTheme } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const APPEARANCE_SETTINGS_STORAGE_KEY = 'izci.appearance-settings';
export const APPEARANCE_SETTINGS_CHANNEL = 'izci.appearance-settings';
export const DEFAULT_COLOR_THEME: ColorTheme = 'gruvbox';
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorTheme: DEFAULT_COLOR_THEME,
  useArtworkPlayerColors: false,
  keepLibraryColumnsVisibleInNarrowLayout: false,
  useSystemFont: false,
  artworkBackgroundMode: 'off',
  artworkBackgroundFadeEnabled: true,
  showTrackTitleInWindowTitle: true
};

function normalizeColorTheme(value: unknown): ColorTheme {
  return value === 'dracula' ? 'dracula' : DEFAULT_COLOR_THEME;
}

function normalizeArtworkBackgroundMode(value: unknown): ArtworkBackgroundMode {
  return value === 'player' || value === 'player-details' || value === 'workspace' ? value : 'off';
}

function normalizeSettings(value: unknown): AppearanceSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<AppearanceSettings> & { useArtworkBackgroundColors?: boolean })
      : {};
  const legacyArtworkBackgroundEnabled =
    'useArtworkBackgroundColors' in source && source.useArtworkBackgroundColors === true;

  return {
    colorTheme: normalizeColorTheme(source.colorTheme),
    useArtworkPlayerColors: source.useArtworkPlayerColors === true,
    keepLibraryColumnsVisibleInNarrowLayout: source.keepLibraryColumnsVisibleInNarrowLayout === true,
    useSystemFont: source.useSystemFont === true,
    artworkBackgroundMode: legacyArtworkBackgroundEnabled
      ? 'workspace'
      : normalizeArtworkBackgroundMode(source.artworkBackgroundMode),
    artworkBackgroundFadeEnabled: source.artworkBackgroundFadeEnabled !== false,
    showTrackTitleInWindowTitle: source.showTrackTitleInWindowTitle !== false
  };
}

const store = createPersistentStore({
  storageKey: APPEARANCE_SETTINGS_STORAGE_KEY,
  channelName: APPEARANCE_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_APPEARANCE_SETTINGS,
  normalize: normalizeSettings
});

export const appearanceSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  update(patch: Partial<AppearanceSettings>): AppearanceSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
