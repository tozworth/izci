import type {
  AppearanceSettings,
  BackdropZoneEffect,
  BackdropZoneId,
  BackdropZoneSettings,
  ColorTheme,
  LyricsFontSizeSettings,
  LyricsDisplayStyle,
  LyricsSettings
} from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const APPEARANCE_SETTINGS_STORAGE_KEY = 'izci.appearance-settings';
export const APPEARANCE_SETTINGS_CHANNEL = 'izci.appearance-settings';
export const DEFAULT_COLOR_THEME: ColorTheme = 'gruvbox';
export const BACKDROP_ZONE_IDS: BackdropZoneId[] = ['playlist', 'library', 'details', 'player', 'nowPlaying'];
export const BACKDROP_ZONE_LABELS: Record<BackdropZoneId, string> = {
  playlist: 'Playlist',
  library: 'Library',
  details: 'Track Details',
  player: 'Player Bar',
  nowPlaying: 'Now Playing'
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
  player: 'visualizer',
  nowPlaying: 'both'
};
export const LYRICS_STYLE_OPTIONS: Array<{ value: LyricsDisplayStyle; label: string }> = [
  { value: 'plain', label: 'Plain text' },
  { value: 'timestamped', label: 'Timestamped rows' },
  { value: 'theater', label: 'Theater' }
];
export const LYRICS_FONT_SIZE_LIMITS: Record<
  LyricsDisplayStyle,
  { min: number; max: number; step: number }
> = {
  plain: { min: 0.78, max: 1.35, step: 0.01 },
  timestamped: { min: 0.78, max: 1.35, step: 0.01 },
  theater: { min: 1.1, max: 2.6, step: 0.01 }
};
export const DEFAULT_LYRICS_FONT_SIZES: LyricsFontSizeSettings = {
  plain: 0.95,
  timestamped: 0.95,
  theater: 1.75
};
export const MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 5;
export const MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 30;
export const DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 10;
export const DEFAULT_LYRICS_SETTINGS: LyricsSettings = {
  displayStyle: 'timestamped',
  autoScroll: true,
  fontSizes: DEFAULT_LYRICS_FONT_SIZES,
  theaterDowntimeDots: true,
  theaterDowntimeThresholdSeconds: DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
  theaterSmoothScroll: true,
  openPanelForLyrics: false,
  closePanelWithoutLyrics: false,
  autoTheaterInNowPlaying: true,
  autoFocusInNowPlaying: true
};
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorTheme: DEFAULT_COLOR_THEME,
  useArtworkPlayerColors: false,
  keepLibraryColumnsVisibleInNarrowLayout: false,
  useSystemFont: false,
  backdropZones: DEFAULT_BACKDROP_ZONES,
  lyrics: DEFAULT_LYRICS_SETTINGS,
  nowPlayingViewActive: false,
  autoNowPlayingOnMaximized: false,
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

function normalizeLyricsDisplayStyle(value: unknown): LyricsDisplayStyle {
  return value === 'plain' || value === 'theater' ? value : DEFAULT_LYRICS_SETTINGS.displayStyle;
}

export function normalizeLyricsFontSize(style: LyricsDisplayStyle, value: unknown): number {
  const numericValue = Number(value);
  const limits = LYRICS_FONT_SIZE_LIMITS[style];

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_LYRICS_FONT_SIZES[style];
  }

  return Math.min(Math.max(numericValue, limits.min), limits.max);
}

function normalizeLyricsFontSizes(value: unknown): LyricsFontSizeSettings {
  const source = value && typeof value === 'object' ? (value as Partial<LyricsFontSizeSettings>) : {};

  return {
    plain: normalizeLyricsFontSize('plain', source.plain),
    timestamped: normalizeLyricsFontSize('timestamped', source.timestamped),
    theater: normalizeLyricsFontSize('theater', source.theater)
  };
}

export function normalizeLyricsDowntimeThresholdSeconds(value: unknown): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS;
  }

  return Math.min(
    Math.max(numericValue, MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS),
    MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS
  );
}

function normalizeLyricsSettings(value: unknown): LyricsSettings {
  const source = value && typeof value === 'object' ? (value as Partial<LyricsSettings>) : {};

  return {
    displayStyle: normalizeLyricsDisplayStyle(source.displayStyle),
    autoScroll: source.autoScroll !== false,
    fontSizes: normalizeLyricsFontSizes(source.fontSizes),
    theaterDowntimeDots: source.theaterDowntimeDots !== false,
    theaterDowntimeThresholdSeconds: normalizeLyricsDowntimeThresholdSeconds(
      source.theaterDowntimeThresholdSeconds
    ),
    theaterSmoothScroll: source.theaterSmoothScroll !== false,
    openPanelForLyrics: source.openPanelForLyrics === true,
    closePanelWithoutLyrics: source.closePanelWithoutLyrics === true,
    autoTheaterInNowPlaying: source.autoTheaterInNowPlaying !== false,
    autoFocusInNowPlaying: source.autoFocusInNowPlaying !== false
  };
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
      zones[zone] = Object.prototype.hasOwnProperty.call(zoneSource, zone)
        ? normalizeBackdropZoneEffect(zoneSource[zone])
        : DEFAULT_BACKDROP_ZONES[zone];
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
    lyrics: normalizeLyricsSettings(source.lyrics),
    nowPlayingViewActive: source.nowPlayingViewActive === true,
    autoNowPlayingOnMaximized: source.autoNowPlayingOnMaximized === true,
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
