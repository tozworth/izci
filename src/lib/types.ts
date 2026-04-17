export const STREAM_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
export const MODULE_EXTENSIONS = ['mod', 'xm', 's3m', 'it', 'mo3'] as const;

export type StreamExtension = (typeof STREAM_EXTENSIONS)[number];
export type ModuleExtension = (typeof MODULE_EXTENSIONS)[number];
export type TrackKind = 'stream' | 'module';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type ModuleInterpolationFilter = 1 | 2 | 4 | 8;
export type PlaylistRepeatMode = 'off' | 'one' | 'all';
export type SortDirection = 'asc' | 'desc';
export type LibraryColumnId = 'title' | 'artist' | 'album' | 'format' | 'duration';
export type ColorTheme = 'gruvbox' | 'dracula';
export type ArtworkBackgroundMode = 'off' | 'player' | 'workspace';
export type WorkspaceCollection = 'playlist' | 'library';
export type WorkspaceTab = WorkspaceCollection | 'details';
export type WorkspacePanelId = 'playlist' | 'library' | 'details';
export type WorkspaceResizeHandle = 'playlist-library' | 'library-details';

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
}

export interface AppearanceSettings {
  colorTheme: ColorTheme;
  keepLibraryColumnsVisibleInNarrowLayout: boolean;
  compactShell: boolean;
  useSystemFont: boolean;
  artworkBackgroundMode: ArtworkBackgroundMode;
}

export interface PlaybackSettings {
  logarithmicVolume: boolean;
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

export interface WorkspaceJumpRequest {
  id: string;
  token: number;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  backend: TrackKind | null;
  error?: string;
}
