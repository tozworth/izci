import type {
  AppearanceSettings,
  BackdropZoneEffect,
  BackdropZoneId,
  BackdropZoneSettings,
  ColorTheme
} from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const APPEARANCE_SETTINGS_STORAGE_KEY = 'izci.appearance-settings';
export const APPEARANCE_SETTINGS_CHANNEL = 'izci.appearance-settings';
export const DEFAULT_COLOR_THEME: ColorTheme = 'gruvbox';
export const BACKDROP_ZONE_IDS: BackdropZoneId[] = ['playlist', 'library', 'details', 'player'];
export const BACKDROP_ZONE_LABELS: Record<BackdropZoneId, string> = {
  playlist: 'Playlist',
  library: 'Library',
  details: 'Track Details',
  player: 'Player Bar'
};
export const BACKDROP_EFFECT_OPTIONS: Array<{ value: BackdropZoneEffect; label: string }> = [
  { value: 'none', label: 'Neither' },
  { value: 'artwork', label: 'Artwork' },
  { value: 'visualizer', label: 'Visualizer' },
  { value: 'both', label: 'Both' }
];
export const DEFAULT_BACKDROP_ZONES: BackdropZoneSettings = {
  playlist: 'none',
  library: 'none',
  details: 'none',
  player: 'visualizer'
};
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorTheme: DEFAULT_COLOR_THEME,
  useArtworkPlayerColors: false,
  keepLibraryColumnsVisibleInNarrowLayout: false,
  useSystemFont: false,
  backdropZones: DEFAULT_BACKDROP_ZONES,
  showTrackTitleInWindowTitle: true
};

export function hasArtworkBackdrop(effect: BackdropZoneEffect): boolean {
  return effect === 'artwork' || effect === 'both';
}

export function hasVisualizerBackdrop(effect: BackdropZoneEffect): boolean {
  return effect === 'visualizer' || effect === 'both';
}

function normalizeColorTheme(value: unknown): ColorTheme {
  return value === 'dracula' ? 'dracula' : DEFAULT_COLOR_THEME;
}

function normalizeBackdropZoneEffect(value: unknown): BackdropZoneEffect {
  return value === 'artwork' || value === 'visualizer' || value === 'both' ? value : 'none';
}

function addBackdropEffect(
  current: BackdropZoneEffect,
  effect: 'artwork' | 'visualizer'
): BackdropZoneEffect {
  if (current === 'both' || current === effect) {
    return current;
  }

  if (current === 'none') {
    return effect;
  }

  return 'both';
}

function applyLegacyMode(
  zones: BackdropZoneSettings,
  mode: unknown,
  effect: 'artwork' | 'visualizer'
): void {
  const targetZones: BackdropZoneId[] =
    mode === 'workspace'
      ? BACKDROP_ZONE_IDS
      : mode === 'player-details'
        ? ['player', 'details']
        : mode === 'player'
          ? ['player']
          : [];

  for (const zone of targetZones) {
    zones[zone] = addBackdropEffect(zones[zone], effect);
  }
}

function normalizeBackdropZones(source: Partial<AppearanceSettings> & Record<string, unknown>): BackdropZoneSettings {
  const zones: BackdropZoneSettings = { ...DEFAULT_BACKDROP_ZONES };
  const persistedZones = source.backdropZones;

  if (persistedZones && typeof persistedZones === 'object') {
    const zoneSource = persistedZones as Partial<Record<BackdropZoneId, unknown>>;

    for (const zone of BACKDROP_ZONE_IDS) {
      zones[zone] = normalizeBackdropZoneEffect(zoneSource[zone]);
    }

    return zones;
  }

  for (const zone of BACKDROP_ZONE_IDS) {
    zones[zone] = 'none';
  }

  const legacyArtworkBackgroundEnabled =
    source.useArtworkBackgroundColors === true && source.artworkBackgroundMode === undefined;

  applyLegacyMode(
    zones,
    legacyArtworkBackgroundEnabled ? 'workspace' : source.artworkBackgroundMode,
    'artwork'
  );
  applyLegacyMode(zones, source.visualizerBackdropMode ?? 'player', 'visualizer');

  return zones;
}

function normalizeSettings(value: unknown): AppearanceSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<AppearanceSettings> & Record<string, unknown>)
      : {};

  return {
    colorTheme: normalizeColorTheme(source.colorTheme),
    useArtworkPlayerColors: source.useArtworkPlayerColors === true,
    keepLibraryColumnsVisibleInNarrowLayout: source.keepLibraryColumnsVisibleInNarrowLayout === true,
    useSystemFont: source.useSystemFont === true,
    backdropZones: normalizeBackdropZones(source),
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
