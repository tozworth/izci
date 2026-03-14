export const STREAM_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'opus'] as const;
export const MODULE_EXTENSIONS = ['mod', 'xm', 's3m', 'it'] as const;

export type StreamExtension = (typeof STREAM_EXTENSIONS)[number];
export type ModuleExtension = (typeof MODULE_EXTENSIONS)[number];
export type TrackKind = 'stream' | 'module';
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  trackerType?: string;
  message?: string;
  duration?: number;
  channels?: number;
  patterns?: number;
  instruments?: number;
  orders?: number;
  subsongs?: number;
  rows?: number;
  sampleRate?: number;
}

export interface PlaylistItem {
  id: string;
  file: File;
  name: string;
  extension: string;
  kind: TrackKind;
  size: number;
  objectUrl?: string;
  metadata?: TrackMetadata;
}

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  backend: TrackKind | null;
  error?: string;
}
