export const STREAM_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
export const MODULE_EXTENSIONS = ['mod', 'xm', 's3m', 'it'] as const;

export type StreamExtension = (typeof STREAM_EXTENSIONS)[number];
export type ModuleExtension = (typeof MODULE_EXTENSIONS)[number];
export type TrackKind = 'stream' | 'module';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type ModuleInterpolationFilter = 1 | 2 | 4 | 8;
export type PlaylistRepeatMode = 'off' | 'one' | 'all';

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackerType?: string;
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
  interpolationFilter: ModuleInterpolationFilter;
  tempoFactor: number;
  pitchFactor: number;
}

export interface MetadataSettings {
  inferFromFilename: boolean;
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
  objectUrl?: string;
  metadata?: TrackMetadata;
}

export interface PlaylistPlaybackOptions {
  shuffle: boolean;
  repeatMode: PlaylistRepeatMode;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  backend: TrackKind | null;
  error?: string;
}
