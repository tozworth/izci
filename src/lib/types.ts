export const STREAM_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
export const MODULE_EXTENSIONS = ['mod', 'xm', 's3m', 'it', 'mo3'] as const;

export type TrackKind = 'stream' | 'module';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type ModuleInterpolationFilter = 1 | 2 | 4 | 8;
export type PlaylistRepeatMode = 'off' | 'one' | 'all';
export type SortDirection = 'asc' | 'desc';
export type LibraryColumnId = 'title' | 'artist' | 'album' | 'format' | 'duration' | 'plays';
export type ColorTheme = 'gray' | 'coal' | 'lights-out' | 'nordic' | 'gruvbox' | 'dracula' | 'ember';
export type BackdropZoneId = 'playlist' | 'library' | 'details' | 'player' | 'nowPlaying';
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
export type WorkspaceTab = WorkspaceCollection | 'details' | 'lyrics';
export type WorkspacePanelId = 'playlist' | 'library' | 'details';
export const WORKSPACE_TABS: WorkspaceTab[] = ['playlist', 'library', 'details', 'lyrics'];
export const WORKSPACE_PANEL_IDS: WorkspacePanelId[] = ['playlist', 'library', 'details'];
export interface WorkspaceResizeHandle {
  before: WorkspacePanelId;
  after: WorkspacePanelId;
}
export type ReplayGainMode = 'off' | 'track' | 'album';

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
  useArtworkPlayerColors: boolean;
  useNowPlayingArtworkPlayerColors: boolean;
  keepLibraryColumnsVisibleInNarrowLayout: boolean;
  keepEmptyWorkspacePanelsOpen: boolean;
  useSystemFont: boolean;
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
  icon?: string;
  shortcut?: string;
  separatorBefore?: boolean;
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
  order: LibraryColumnId[];
  columns: Record<LibraryColumnId, LibraryViewColumnState>;
  sort: LibraryViewSortState;
  searchQuery: string;
}

export interface WorkspacePanelLayoutSettings {
  playlistFraction: number;
  libraryFraction: number;
  detailsFraction: number;
}

export type WorkspacePanelTabsSettings = Record<WorkspacePanelId, WorkspaceTab[]>;
export type WorkspacePanelActiveTabsSettings = Record<WorkspacePanelId, WorkspaceTab | null>;
export type WorkspaceTabPanelMemorySettings = Record<WorkspaceTab, WorkspacePanelId>;

export interface WorkspacePanelStateSettings {
  detailsVisible: boolean;
  lyricsVisible: boolean;
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
