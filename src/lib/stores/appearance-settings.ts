import type {
  AppearanceSettings,
  BackdropZoneArtworkSettings,
  BackdropZoneArtworkSettingsMap,
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
export const DEFAULT_COLOR_THEME: ColorTheme = 'gray';
export const BACKDROP_ZONE_IDS: BackdropZoneId[] = ['left', 'center', 'right', 'player', 'nowPlaying'];
export const BACKDROP_ZONE_LABELS: Record<BackdropZoneId, string> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
  player: 'Player Bar',
  nowPlaying: 'Now Playing'
};
export const BACKDROP_EFFECT_OPTIONS: Array<{ value: BackdropZoneEffect; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'artwork', label: 'Artwork' },
  { value: 'visualizer', label: 'Visualizer' },
  { value: 'both', label: 'Both' }
];
export const DEFAULT_BACKDROP_ZONES: BackdropZoneSettings = {
  left: 'none',
  center: 'none',
  right: 'none',
  player: 'none',
  nowPlaying: 'artwork'
};
export const MIN_BACKDROP_ARTWORK_BLUR = 0;
export const MAX_BACKDROP_ARTWORK_BLUR = 64;
export const DEFAULT_BACKDROP_ARTWORK_BLUR = 36;
const MAX_BACKDROP_ARTWORK_SURFACE_BLUR = 28;
const BACKDROP_ARTWORK_HEADER_BLUR_OFFSET = 2;
const MAX_BACKDROP_VISUALIZER_SURFACE_BLUR = 2;
const MAX_BACKDROP_VISUALIZER_CHROME_BLUR = 4;
export const MIN_BACKDROP_ARTWORK_BRIGHTNESS = 0;
export const MAX_BACKDROP_ARTWORK_BRIGHTNESS = 100;
export const DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS = 42;
export const DEFAULT_BACKDROP_ZONE_ARTWORK: BackdropZoneArtworkSettingsMap = {
  left: {
    blur: DEFAULT_BACKDROP_ARTWORK_BLUR,
    brightness: DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
  },
  center: {
    blur: DEFAULT_BACKDROP_ARTWORK_BLUR,
    brightness: DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
  },
  right: {
    blur: DEFAULT_BACKDROP_ARTWORK_BLUR,
    brightness: DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
  },
  player: {
    blur: DEFAULT_BACKDROP_ARTWORK_BLUR,
    brightness: DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
  },
  nowPlaying: {
    blur: DEFAULT_BACKDROP_ARTWORK_BLUR,
    brightness: DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
  }
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
export const MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS = 2;
export const NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS = 16;
export const DEFAULT_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS = 5;
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
  useNowPlayingArtworkPlayerColors: true,
  compactPlayerBar: false,
  keepLibraryColumnsVisibleInNarrowLayout: false,
  keepEmptyWorkspacePanelsOpen: false,
  showIdlePlayerQuips: true,
  useSystemFont: false,
  backdropZones: DEFAULT_BACKDROP_ZONES,
  backdropZoneArtwork: DEFAULT_BACKDROP_ZONE_ARTWORK,
  lyrics: DEFAULT_LYRICS_SETTINGS,
  nowPlayingViewActive: false,
  autoNowPlayingOnMaximized: false,
  nowPlayingPanelAutoHideDelaySeconds: DEFAULT_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS,
  showTrackTitleInWindowTitle: true
};

export function hasArtworkBackdrop(effect: BackdropZoneEffect): boolean {
  return effect === 'artwork' || effect === 'both';
}

export function hasVisualizerBackdrop(effect: BackdropZoneEffect): boolean {
  return effect === 'visualizer' || effect === 'both';
}

function normalizeColorTheme(value: unknown): ColorTheme {
  switch (value) {
    case 'gray':
    case 'coal':
    case 'lights-out':
    case 'nordic':
    case 'gruvbox':
    case 'dracula':
    case 'ember':
      return value;
    default:
      return DEFAULT_COLOR_THEME;
  }
}

function normalizeBackdropZoneEffect(value: unknown): BackdropZoneEffect {
  return value === 'artwork' || value === 'visualizer' || value === 'both' ? value : 'none';
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(numericValue, min), max);
}

export function normalizeBackdropZoneArtworkBlur(value: unknown): number {
  return Math.round(
    normalizeNumber(
      value,
      MIN_BACKDROP_ARTWORK_BLUR,
      MAX_BACKDROP_ARTWORK_BLUR,
      DEFAULT_BACKDROP_ARTWORK_BLUR
    )
  );
}

export function normalizeBackdropZoneArtworkBrightness(value: unknown): number {
  return Math.round(
    normalizeNumber(
      value,
      MIN_BACKDROP_ARTWORK_BRIGHTNESS,
      MAX_BACKDROP_ARTWORK_BRIGHTNESS,
      DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
    )
  );
}

export function toBackdropZoneArtworkStyle(settings: BackdropZoneArtworkSettings): string {
  const surfaceBlur = Math.min(settings.blur, MAX_BACKDROP_ARTWORK_SURFACE_BLUR);
  const headerBlur = Math.max(surfaceBlur - BACKDROP_ARTWORK_HEADER_BLUR_OFFSET, 0);
  const visualizerSurfaceBlur = Math.min(surfaceBlur, MAX_BACKDROP_VISUALIZER_SURFACE_BLUR);
  const visualizerChromeBlur = Math.min(surfaceBlur, MAX_BACKDROP_VISUALIZER_CHROME_BLUR);
  const visualizerHeaderBlur = Math.max(
    visualizerChromeBlur - BACKDROP_ARTWORK_HEADER_BLUR_OFFSET,
    0
  );

  return [
    `--shared-zone-artwork-blur: ${settings.blur}px`,
    `--shared-zone-surface-blur: ${surfaceBlur}px`,
    `--shared-zone-header-blur: ${headerBlur}px`,
    `--shared-zone-visualizer-surface-blur: ${visualizerSurfaceBlur}px`,
    `--shared-zone-visualizer-chrome-blur: ${visualizerChromeBlur}px`,
    `--shared-zone-visualizer-header-blur: ${visualizerHeaderBlur}px`,
    `--shared-zone-artwork-brightness: ${settings.brightness / 100}`
  ].join('; ');
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

export function normalizeNowPlayingPanelAutoHideDelaySeconds(value: unknown): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS;
  }

  const roundedValue = Math.round(numericValue);

  if (roundedValue >= NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS) {
    return NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS;
  }

  return Math.min(
    Math.max(roundedValue, MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS),
    NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS
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
        ? ['player', 'right']
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

function normalizeBackdropZoneArtworkSettings(value: unknown): BackdropZoneArtworkSettings {
  const source =
    value && typeof value === 'object' ? (value as Partial<BackdropZoneArtworkSettings>) : {};

  return {
    blur: normalizeBackdropZoneArtworkBlur(source.blur),
    brightness: normalizeBackdropZoneArtworkBrightness(source.brightness)
  };
}

function normalizeBackdropZoneArtwork(
  source: Partial<AppearanceSettings> & Record<string, unknown>
): BackdropZoneArtworkSettingsMap {
  const settings: BackdropZoneArtworkSettingsMap = {
    left: { ...DEFAULT_BACKDROP_ZONE_ARTWORK.left },
    center: { ...DEFAULT_BACKDROP_ZONE_ARTWORK.center },
    right: { ...DEFAULT_BACKDROP_ZONE_ARTWORK.right },
    player: { ...DEFAULT_BACKDROP_ZONE_ARTWORK.player },
    nowPlaying: { ...DEFAULT_BACKDROP_ZONE_ARTWORK.nowPlaying }
  };
  const persistedSettings = source.backdropZoneArtwork;

  if (!persistedSettings || typeof persistedSettings !== 'object') {
    return settings;
  }

  const zoneSource = persistedSettings as Partial<Record<BackdropZoneId, unknown>>;

  for (const zone of BACKDROP_ZONE_IDS) {
    settings[zone] = Object.prototype.hasOwnProperty.call(zoneSource, zone)
      ? normalizeBackdropZoneArtworkSettings(zoneSource[zone])
      : { ...DEFAULT_BACKDROP_ZONE_ARTWORK[zone] };
  }

  return settings;
}

function normalizeSettings(value: unknown): AppearanceSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<AppearanceSettings> & Record<string, unknown>)
      : {};

  return {
    colorTheme: normalizeColorTheme(source.colorTheme),
    useArtworkPlayerColors: source.useArtworkPlayerColors === true,
    useNowPlayingArtworkPlayerColors: source.useNowPlayingArtworkPlayerColors !== false,
    compactPlayerBar: source.compactPlayerBar === true,
    keepLibraryColumnsVisibleInNarrowLayout: source.keepLibraryColumnsVisibleInNarrowLayout === true,
    keepEmptyWorkspacePanelsOpen: source.keepEmptyWorkspacePanelsOpen === true,
    showIdlePlayerQuips: source.showIdlePlayerQuips !== false,
    useSystemFont: source.useSystemFont === true,
    backdropZones: normalizeBackdropZones(source),
    backdropZoneArtwork: normalizeBackdropZoneArtwork(source),
    lyrics: normalizeLyricsSettings(source.lyrics),
    nowPlayingViewActive: source.nowPlayingViewActive === true,
    autoNowPlayingOnMaximized: source.autoNowPlayingOnMaximized === true,
    nowPlayingPanelAutoHideDelaySeconds: normalizeNowPlayingPanelAutoHideDelaySeconds(
      source.nowPlayingPanelAutoHideDelaySeconds
    ),
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
