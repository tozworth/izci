import type { ContextualTabSettings } from './workspace';

export type ColorTheme =
  | 'pale'
  | 'lights-out'
  | 'solarized'
  | 'nordic'
  | 'gruvbox'
  | 'dracula'
  | 'ember'
  | 'chameleon';
export type ColorScheme = 'light' | 'dark';
export type ColorThemeMode = 'system' | ColorScheme;
export type BackdropZoneId =
  'left' | 'center' | 'right' | 'player' | 'nowPlaying';
export type BackdropZoneEffect = 'none' | 'artwork' | 'visualizer' | 'both';
export type BackdropZoneSettings = Record<BackdropZoneId, BackdropZoneEffect>;

export interface BackdropZoneArtworkSettings {
  blur: number;
  brightness: number;
}

export type BackdropZoneArtworkSettingsMap = Record<
  BackdropZoneId,
  BackdropZoneArtworkSettings
>;
export type VisualizerStyle =
  'wave' | 'bars' | 'mirror' | 'blocks' | 'triangles';
export type VisualizerColorSource = 'theme' | 'artwork';
export type LyricsDisplayStyle = 'plain' | 'timestamped' | 'theater';
export type LyricsFontSizeSettings = Record<LyricsDisplayStyle, number>;

export interface LyricsSettings {
  displayStyle: LyricsDisplayStyle;
  autoScroll: boolean;
  fontSizes: LyricsFontSizeSettings;
  theaterDowntimeDots: boolean;
  theaterDowntimeThresholdSeconds: number;
  theaterSmoothScroll: boolean;
  autoTheaterInNowPlaying: boolean;
  autoFocusInNowPlaying: boolean;
}

export interface AppearanceSettings {
  colorThemeMode: ColorThemeMode;
  lightColorTheme: ColorTheme;
  darkColorTheme: ColorTheme;
  chameleonHue: number;
  chameleonSaturation: number;
  useArtworkPlayerColors: boolean;
  useNowPlayingArtworkPlayerColors: boolean;
  compactPlayerBar: boolean;
  keepLibraryColumnsVisibleInNarrowLayout: boolean;
  keepEmptyWorkspacePanelsOpen: boolean;
  showLibraryAlbumArtworkBackdrop: boolean;
  showIdlePlayerQuips: boolean;
  fontFamily: string;
  backdropZones: BackdropZoneSettings;
  backdropZoneArtwork: BackdropZoneArtworkSettingsMap;
  contextualTabs: ContextualTabSettings;
  lyrics: LyricsSettings;
  nowPlayingViewActive: boolean;
  autoNowPlayingOnMaximized: boolean;
  nowPlayingPanelAutoHideDelaySeconds: number;
  showTrackTitleInWindowTitle: boolean;
}

export interface VisualizerSettings {
  style: VisualizerStyle;
  colorSource: VisualizerColorSource;
  height: number;
  transparency: number;
  frameRateLimit: number;
  normalizationStrength: number;
  triangleCount: number;
  triangleMinSize: number;
  triangleMaxSize: number;
  triangleBaseSpeed: number;
  triangleReactiveSpeed: number;
  triangleBorderWidth: number;
}
