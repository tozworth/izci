import type {
  AppearanceSettings,
  BackdropZoneArtworkSettings,
  BackdropZoneArtworkSettingsMap,
  BackdropZoneEffect,
  BackdropZoneId,
  BackdropZoneSettings,
  ColorTheme,
  ColorThemeMode,
  ContextualTabAutomation,
  ContextualTabSettings,
  LyricsFontSizeSettings,
  LyricsDisplayStyle,
  LyricsSettings
} from '$lib/types';
import { hasColorThemeVariant } from '$lib/theme-definitions';
import { createSettingsStore } from './persistent-store';

const APPEARANCE_SETTINGS_STORAGE_KEY = 'izci.appearance-settings';
const APPEARANCE_SETTINGS_CHANNEL = 'izci.appearance-settings';
const DEFAULT_COLOR_THEME_MODE: ColorThemeMode = 'system';
export const DEFAULT_LIGHT_COLOR_THEME: ColorTheme = 'pale';
export const DEFAULT_DARK_COLOR_THEME: ColorTheme = 'pale';
export const MIN_CHAMELEON_HUE = 0;
export const MAX_CHAMELEON_HUE = 359;
export const DEFAULT_CHAMELEON_HUE = 210;
export const MIN_CHAMELEON_SATURATION = 0;
export const MAX_CHAMELEON_SATURATION = 100;
export const DEFAULT_CHAMELEON_SATURATION = 76;
export const MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS = 0;
export const MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS = 100;
export const DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS = 25;
export const SYSTEM_FONT_FAMILY = 'system';
export const BACKDROP_ZONE_IDS: BackdropZoneId[] = ['left', 'center', 'right', 'player', 'nowPlaying'];
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
const DEFAULT_BACKDROP_ARTWORK_BLUR = 36;
const MAX_BACKDROP_ARTWORK_SURFACE_BLUR = 28;
const BACKDROP_ARTWORK_HEADER_BLUR_OFFSET = 2;
const MAX_BACKDROP_VISUALIZER_SURFACE_BLUR = 2;
const MAX_BACKDROP_VISUALIZER_CHROME_BLUR = 4;
export const MIN_BACKDROP_ARTWORK_BRIGHTNESS = 0;
export const MAX_BACKDROP_ARTWORK_BRIGHTNESS = 100;
const DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS = 42;
const DEFAULT_BACKDROP_ZONE_ARTWORK: BackdropZoneArtworkSettingsMap = {
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
export const CONTEXTUAL_TAB_AUTOMATION_OPTIONS: Array<{
  value: ContextualTabAutomation;
  label: string;
}> = [
  { value: 'manual', label: 'Manual' },
  { value: 'open', label: 'Open when available' },
  { value: 'open-close', label: 'Open and close automatically' }
];
const DEFAULT_CONTEXTUAL_TAB_SETTINGS: ContextualTabSettings = {
  lyrics: 'manual',
  patterns: 'manual'
};
export const LYRICS_FONT_SIZE_LIMITS: Record<
  LyricsDisplayStyle,
  { min: number; max: number; step: number }
> = {
  plain: { min: 0.78, max: 1.35, step: 0.01 },
  timestamped: { min: 0.78, max: 1.35, step: 0.01 },
  theater: { min: 0.78, max: 2.6, step: 0.01 }
};
const DEFAULT_LYRICS_FONT_SIZES: LyricsFontSizeSettings = {
  plain: 0.95,
  timestamped: 0.95,
  theater: 1.75
};
export const MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 5;
export const MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 30;
const DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS = 10;
export const MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS = 2;
export const NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS = 16;
const DEFAULT_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS = 5;
const DEFAULT_LYRICS_SETTINGS: LyricsSettings = {
  displayStyle: 'timestamped',
  autoScroll: true,
  fontSizes: DEFAULT_LYRICS_FONT_SIZES,
  theaterDowntimeDots: true,
  theaterDowntimeThresholdSeconds: DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
  theaterSmoothScroll: true,
  autoTheaterInNowPlaying: true,
  autoFocusInNowPlaying: true
};
export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  colorThemeMode: DEFAULT_COLOR_THEME_MODE,
  lightColorTheme: DEFAULT_LIGHT_COLOR_THEME,
  darkColorTheme: DEFAULT_DARK_COLOR_THEME,
  chameleonHue: DEFAULT_CHAMELEON_HUE,
  chameleonSaturation: DEFAULT_CHAMELEON_SATURATION,
  synthwaveBackgroundBrightness: DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
  useArtworkPlayerColors: false,
  useNowPlayingArtworkPlayerColors: true,
  compactPlayerBar: false,
  keepLibraryColumnsVisibleInNarrowLayout: false,
  keepEmptyWorkspacePanelsOpen: false,
  alwaysShowUpNext: false,
  showLibraryAlbumArtworkBackdrop: true,
  showIdlePlayerQuips: true,
  fontFamily: SYSTEM_FONT_FAMILY,
  backdropZones: DEFAULT_BACKDROP_ZONES,
  backdropZoneArtwork: DEFAULT_BACKDROP_ZONE_ARTWORK,
  contextualTabs: DEFAULT_CONTEXTUAL_TAB_SETTINGS,
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

function normalizeColorThemeMode(value: unknown): ColorThemeMode {
  return value === 'light' || value === 'dark' ? value : DEFAULT_COLOR_THEME_MODE;
}

function normalizeLightColorTheme(value: unknown): ColorTheme {
  return hasColorThemeVariant(value, 'light') ? value : DEFAULT_LIGHT_COLOR_THEME;
}

function normalizeDarkColorTheme(value: unknown): ColorTheme {
  return hasColorThemeVariant(value, 'dark') ? value : DEFAULT_DARK_COLOR_THEME;
}

export function normalizeChameleonHue(value: unknown): number {
  return normalizeRoundedNumber(value, MIN_CHAMELEON_HUE, MAX_CHAMELEON_HUE, DEFAULT_CHAMELEON_HUE);
}

export function normalizeChameleonSaturation(value: unknown): number {
  return normalizeRoundedNumber(
    value,
    MIN_CHAMELEON_SATURATION,
    MAX_CHAMELEON_SATURATION,
    DEFAULT_CHAMELEON_SATURATION
  );
}

export function normalizeSynthwaveBackgroundBrightness(value: unknown): number {
  return normalizeRoundedNumber(
    value,
    MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
    MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
    DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS
  );
}

function normalizeFontFamily(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : SYSTEM_FONT_FAMILY;
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

function normalizeRoundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(normalizeNumber(value, min, max, fallback));
}

export function normalizeBackdropZoneArtworkBlur(value: unknown): number {
  return normalizeRoundedNumber(
    value,
    MIN_BACKDROP_ARTWORK_BLUR,
    MAX_BACKDROP_ARTWORK_BLUR,
    DEFAULT_BACKDROP_ARTWORK_BLUR
  );
}

export function normalizeBackdropZoneArtworkBrightness(value: unknown): number {
  return normalizeRoundedNumber(
    value,
    MIN_BACKDROP_ARTWORK_BRIGHTNESS,
    MAX_BACKDROP_ARTWORK_BRIGHTNESS,
    DEFAULT_BACKDROP_ARTWORK_BRIGHTNESS
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
  const limits = LYRICS_FONT_SIZE_LIMITS[style];
  return normalizeNumber(value, limits.min, limits.max, DEFAULT_LYRICS_FONT_SIZES[style]);
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
  return normalizeNumber(
    value,
    MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
    MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
    DEFAULT_LYRICS_DOWNTIME_THRESHOLD_SECONDS
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
    autoTheaterInNowPlaying: source.autoTheaterInNowPlaying !== false,
    autoFocusInNowPlaying: source.autoFocusInNowPlaying !== false
  };
}

export function normalizeContextualTabAutomation(value: unknown): ContextualTabAutomation {
  return value === 'open' || value === 'open-close' ? value : 'manual';
}

function normalizeContextualTabs(value: unknown): ContextualTabSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof ContextualTabSettings, unknown>>)
      : {};

  return {
    lyrics: normalizeContextualTabAutomation(source.lyrics),
    patterns: normalizeContextualTabAutomation(source.patterns)
  };
}

function normalizeBackdropZones(source: Partial<AppearanceSettings>): BackdropZoneSettings {
  const zones: BackdropZoneSettings = { ...DEFAULT_BACKDROP_ZONES };
  const persistedZones = source.backdropZones;

  if (!persistedZones || typeof persistedZones !== 'object') {
    return zones;
  }

  const zoneSource = persistedZones as Partial<Record<BackdropZoneId, unknown>>;
  for (const zone of BACKDROP_ZONE_IDS) {
    if (Object.prototype.hasOwnProperty.call(zoneSource, zone)) {
      zones[zone] = normalizeBackdropZoneEffect(zoneSource[zone]);
    }
  }

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

export function normalizeAppearanceSettings(value: unknown): AppearanceSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<AppearanceSettings> & Record<string, unknown>)
      : {};

  return {
    colorThemeMode: normalizeColorThemeMode(source.colorThemeMode),
    lightColorTheme: normalizeLightColorTheme(source.lightColorTheme),
    darkColorTheme: normalizeDarkColorTheme(source.darkColorTheme),
    chameleonHue: normalizeChameleonHue(source.chameleonHue),
    chameleonSaturation: normalizeChameleonSaturation(source.chameleonSaturation),
    synthwaveBackgroundBrightness: normalizeSynthwaveBackgroundBrightness(
      source.synthwaveBackgroundBrightness
    ),
    useArtworkPlayerColors: source.useArtworkPlayerColors === true,
    useNowPlayingArtworkPlayerColors: source.useNowPlayingArtworkPlayerColors !== false,
    compactPlayerBar: source.compactPlayerBar === true,
    keepLibraryColumnsVisibleInNarrowLayout: source.keepLibraryColumnsVisibleInNarrowLayout === true,
    keepEmptyWorkspacePanelsOpen: source.keepEmptyWorkspacePanelsOpen === true,
    alwaysShowUpNext: source.alwaysShowUpNext === true,
    showLibraryAlbumArtworkBackdrop: source.showLibraryAlbumArtworkBackdrop !== false,
    showIdlePlayerQuips: source.showIdlePlayerQuips !== false,
    fontFamily: normalizeFontFamily(source.fontFamily),
    backdropZones: normalizeBackdropZones(source),
    backdropZoneArtwork: normalizeBackdropZoneArtwork(source),
    contextualTabs: normalizeContextualTabs(source.contextualTabs),
    lyrics: normalizeLyricsSettings(source.lyrics),
    nowPlayingViewActive: source.nowPlayingViewActive === true,
    autoNowPlayingOnMaximized: source.autoNowPlayingOnMaximized === true,
    nowPlayingPanelAutoHideDelaySeconds: normalizeNowPlayingPanelAutoHideDelaySeconds(
      source.nowPlayingPanelAutoHideDelaySeconds
    ),
    showTrackTitleInWindowTitle: source.showTrackTitleInWindowTitle !== false
  };
}

export const appearanceSettings = createSettingsStore({
  storageKey: APPEARANCE_SETTINGS_STORAGE_KEY,
  channelName: APPEARANCE_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_APPEARANCE_SETTINGS,
  normalize: normalizeAppearanceSettings
});
