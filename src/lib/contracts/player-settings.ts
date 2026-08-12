import type {
  PlaybackRestoreMode,
  PlaybackTransitionMode,
  ReplayGainMode,
} from './playback';

export type PatternRowNumberBase = 'hex' | 'decimal';
export type PatternColorScheme = 'conventional' | 'theme' | 'monochrome';

export interface PatternViewerSettings {
  fontSize: number;
  rowHeight: number;
  channelWidth: number;
  rowNumberBase: PatternRowNumberBase;
  colorScheme: PatternColorScheme;
  followPlayback: boolean;
  alwaysCenterActiveRow: boolean;
  smoothScroll: boolean;
  showChannelNames: boolean;
  highlightBeatRows: boolean;
}

export interface MetadataSettings {
  inferFromFilename: boolean;
  playCountThresholdSeconds: number;
}

export interface TrackSettings {
  folderNestingLimit: number;
  verifyAddedFiles: boolean;
  deduplicatePlaylist: boolean;
  associatedFileAction: 'add' | 'replace';
  showFavoriteToggleInPlayerBar: boolean;
  enableRatings: boolean;
}

export interface PlaybackSettings {
  playbackRate: number;
  trueSpeed: boolean;
  restartCurrentTrackOnPrevious: boolean;
  transitionMode: PlaybackTransitionMode;
  gaplessPlayback: boolean;
  fadeDurationSeconds: number;
  manualTrackChangeFadePercent: number;
  logarithmicVolume: boolean;
  replayGainMode: ReplayGainMode;
  restoreMode: PlaybackRestoreMode;
  rememberProgressDurationIndex: number;
  enableRaf: boolean;
  showRafToggleInPlayerBar: boolean;
}

export type VideoFitMode = 'contain' | 'cover';

export interface VideoSettings {
  autoResizeWindow: boolean;
  autoEnterTheater: boolean;
  fitMode: VideoFitMode;
}
