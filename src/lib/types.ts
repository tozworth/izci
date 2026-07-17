export const STREAM_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
export const MODULE_EXTENSIONS = [
  'mptm',
  'mod',
  's3m',
  'xm',
  'it',
  '667',
  '669',
  'amf',
  'ams',
  'c67',
  'cba',
  'dbm',
  'digi',
  'dmf',
  'dsm',
  'dsym',
  'dtm',
  'etx',
  'far',
  'fc',
  'fc13',
  'fc14',
  'fmt',
  'fst',
  'ftm',
  'imf',
  'ims',
  'ice',
  'j2b',
  'm15',
  'mdl',
  'med',
  'mms',
  'mt2',
  'mtm',
  'mus',
  'nst',
  'okt',
  'plm',
  'psm',
  'pt36',
  'ptm',
  'puma',
  'rtm',
  'sfx',
  'sfx2',
  'smod',
  'st26',
  'stk',
  'stm',
  'stx',
  'stp',
  'symmod',
  'tcb',
  'gmc',
  'gtk',
  'gt2',
  'ult',
  'unic',
  'wow',
  'xmf',
  'gdm',
  'mo3',
  'oxm',
  'umx',
  'xpk',
  'ppm',
  'mmcmp'
] as const;

export type TrackKind = 'stream' | 'module';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type ModuleInterpolationFilter = 1 | 2 | 4 | 8;
export type PlaylistRepeatMode = 'off' | 'one' | 'all';
export type PlaybackRestoreMode = 'disabled' | 'position' | 'position-and-state';
export type SortDirection = 'asc' | 'desc';
export type LibraryColumnId = 'title' | 'artist' | 'album' | 'folder' | 'format' | 'duration' | 'plays';
export type LibraryViewId = 'songs' | 'artists' | 'albums' | 'genres' | 'years' | 'formats' | 'folders';
export type ColorTheme =
  | 'gray'
  | 'coal'
  | 'lights-out'
  | 'nordic'
  | 'gruvbox'
  | 'dracula'
  | 'ember'
  | 'chameleon';
export type BackdropZoneId = 'left' | 'center' | 'right' | 'player' | 'nowPlaying';
export type BackdropZoneEffect = 'none' | 'artwork' | 'visualizer' | 'both';
export type BackdropZoneSettings = Record<BackdropZoneId, BackdropZoneEffect>;
export interface BackdropZoneArtworkSettings {
  blur: number;
  brightness: number;
}
export type BackdropZoneArtworkSettingsMap = Record<BackdropZoneId, BackdropZoneArtworkSettings>;
export type VisualizerStyle = 'wave' | 'bars' | 'mirror' | 'blocks' | 'triangles';
export type VisualizerColorSource = 'theme' | 'artwork';
export type LyricsDisplayStyle = 'plain' | 'timestamped' | 'theater';
export type LyricsFontSizeSettings = Record<LyricsDisplayStyle, number>;
export type WorkspaceCollection = 'playlist' | 'library';
export type WorkspaceTab = WorkspaceCollection | 'details' | 'lyrics' | 'patterns';
export type WorkspacePanelId = 'left' | 'center' | 'right';
export const WORKSPACE_TABS: WorkspaceTab[] = ['playlist', 'library', 'details', 'lyrics', 'patterns'];
export const WORKSPACE_PANEL_IDS: WorkspacePanelId[] = ['left', 'center', 'right'];
export interface WorkspaceResizeHandle {
  before: WorkspacePanelId;
  after: WorkspacePanelId;
}
export type ReplayGainMode = 'off' | 'track' | 'album';
export type RafEffectType = 'graphic-eq' | 'stereo-width' | 'crystalizer' | 'sloptimizer' | 'reverb';
export type PatternRowNumberBase = 'hex' | 'decimal';
export type PatternColorScheme = 'conventional' | 'theme' | 'monochrome';

export interface PatternViewerSettings {
  fontSize: number;
  rowHeight: number;
  channelWidth: number;
  rowNumberBase: PatternRowNumberBase;
  colorScheme: PatternColorScheme;
  followPlayback: boolean;
  smoothScroll: boolean;
  showChannelNames: boolean;
  highlightBeatRows: boolean;
}

export interface ModulePatternOrder {
  name: string;
  pat: number;
}

export interface ModulePattern {
  name: string;
  rows: string[][];
}

export interface ModulePatternSong {
  channels: string[];
  instruments: string[];
  samples: string[];
  orders: ModulePatternOrder[];
  patterns: ModulePattern[];
  numSubsongs: number;
}

export interface ModulePatternSnapshot {
  trackId: string | null;
  song: ModulePatternSong | null;
  order: number;
  pattern: number;
  row: number;
}

export interface RafEffectBase {
  id: string;
  enabled: boolean;
  displayName?: string;
}

export interface RafGraphicEqSettings extends RafEffectBase {
  type: 'graphic-eq';
  preampDb: number;
  bandGainsDb: number[];
}

export interface RafStereoWidthSettings extends RafEffectBase {
  type: 'stereo-width';
  widthDb: number;
}

export interface RafCrystalizerSettings extends RafEffectBase {
  type: 'crystalizer';
  bandIntensities: number[];
  bandMuted: boolean[];
  bandBypassed: boolean[];
}

export interface RafSloptimizerSettings extends RafEffectBase {
  type: 'sloptimizer';
  advanced: boolean;
  slop: number;
  customized: boolean;
  lowLiftDb: number;
  midLiftDb: number;
  highLiftDb: number;
  lowCrossoverHz: number;
  highCrossoverHz: number;
  density: number;
  speed: number;
  ceilingDb: number;
}

export interface RafReverbSettings extends RafEffectBase {
  type: 'reverb';
  mix: number;
  roomSize: number;
  decaySeconds: number;
  preDelayMs: number;
  dampingHz: number;
}

export type RafEffectSettings =
  | RafGraphicEqSettings
  | RafStereoWidthSettings
  | RafCrystalizerSettings
  | RafSloptimizerSettings
  | RafReverbSettings;

export interface RafRackSettings {
  enabled: boolean;
  effects: RafEffectSettings[];
}

export interface RafPresetSettings {
  effects: RafEffectSettings[];
}

export interface RafPreset {
  id: string;
  name: string;
  settings: RafPresetSettings;
}

export interface RafPresetState {
  presets: RafPreset[];
  selectedPresetId: string | null;
}

export interface ReplayGainMetadata {
  trackGainDb?: number;
  trackPeak?: number;
  albumGainDb?: number;
  albumPeak?: number;
}

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: string;
  trackNumber?: string;
  discNumber?: string;
  composer?: string;
  embeddedMetadataLoaded?: boolean;
  trackerType?: string;
  originalType?: string;
  message?: string;
  duration?: number;
  bitrate?: number;
  channels?: number;
  patterns?: number;
  instruments?: number;
  orders?: number;
  subsongs?: number;
  subsongNames?: string[];
  rows?: number;
  sampleRate?: number;
  playCount?: number;
  replayGain?: ReplayGainMetadata;
}

export interface ModulePlaybackSettings {
  repeatCount: number;
  stereoSeparation: number;
  panStrength: number;
  interpolationFilter: ModuleInterpolationFilter;
  tempoFactor: number;
  pitchFactor: number;
}

export interface MetadataSettings {
  inferFromFilename: boolean;
  playCountThresholdSeconds: number;
}

export interface TrackSettings {
  folderNestingLimit: number;
  verifyAddedFiles: boolean;
  associatedFileAction: 'add' | 'replace';
}

export interface LyricsSettings {
  displayStyle: LyricsDisplayStyle;
  autoScroll: boolean;
  fontSizes: LyricsFontSizeSettings;
  theaterDowntimeDots: boolean;
  theaterDowntimeThresholdSeconds: number;
  theaterSmoothScroll: boolean;
  openPanelForLyrics: boolean;
  closePanelWithoutLyrics: boolean;
  autoTheaterInNowPlaying: boolean;
  autoFocusInNowPlaying: boolean;
}

export interface AppearanceSettings {
  colorTheme: ColorTheme;
  chameleonHue: number;
  chameleonSaturation: number;
  useArtworkPlayerColors: boolean;
  useNowPlayingArtworkPlayerColors: boolean;
  compactPlayerBar: boolean;
  keepLibraryColumnsVisibleInNarrowLayout: boolean;
  keepEmptyWorkspacePanelsOpen: boolean;
  showIdlePlayerQuips: boolean;
  fontFamily: string;
  backdropZones: BackdropZoneSettings;
  backdropZoneArtwork: BackdropZoneArtworkSettingsMap;
  lyrics: LyricsSettings;
  nowPlayingViewActive: boolean;
  autoNowPlayingOnMaximized: boolean;
  nowPlayingPanelAutoHideDelaySeconds: number;
  showTrackTitleInWindowTitle: boolean;
}

export interface PlaybackSettings {
  logarithmicVolume: boolean;
  replayGainMode: ReplayGainMode;
  restoreMode: PlaybackRestoreMode;
  enableRaf: boolean;
  showRafToggleInPlayerBar: boolean;
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

export interface PlaylistItem {
  id: string;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  name: string;
  extension: string;
  kind: TrackKind;
  size: number;
  lastModified: number;
  objectUrl?: string;
  metadata?: TrackMetadata;
}

export interface PlaylistSelection {
  ids: string[];
  anchorId: string | null;
  focusId: string | null;
}

export interface PlaylistPlaybackOptions {
  shuffle: boolean;
  repeatMode: PlaylistRepeatMode;
}

export interface MenuActionItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: string;
  separatorBefore?: boolean;
  attention?: boolean;
  children?: MenuActionItem[];
}

export interface LibraryViewColumnState {
  width: number;
  visible: boolean;
}

export interface LibraryViewSortState {
  columnId: LibraryColumnId;
  direction: SortDirection;
}

export interface LibraryViewSettings {
  activeView: LibraryViewId;
  order: LibraryColumnId[];
  columns: Record<LibraryColumnId, LibraryViewColumnState>;
  sort: LibraryViewSortState;
  searchQuery: string;
}

export interface WorkspacePanelLayoutSettings {
  leftFraction: number;
  centerFraction: number;
  rightFraction: number;
}

export type WorkspacePanelTabsSettings = Record<WorkspacePanelId, WorkspaceTab[]>;
export type WorkspacePanelActiveTabsSettings = Record<WorkspacePanelId, WorkspaceTab | null>;
export type WorkspaceTabPanelMemorySettings = Record<WorkspaceTab, WorkspacePanelId>;

export interface WorkspacePanelStateSettings {
  activeWorkspaceTab: WorkspaceTab;
  activeCollection: WorkspaceCollection;
  panels: WorkspacePanelTabsSettings;
  openPanels: WorkspacePanelId[];
  activeTabsByPanel: WorkspacePanelActiveTabsSettings;
  lastPanelByTab: WorkspaceTabPanelMemorySettings;
  tabbedTabOrder: WorkspaceTab[];
}

export interface WorkspaceJumpRequest {
  id: string;
  token: number;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  backend: TrackKind | null;
  error?: string;
}
