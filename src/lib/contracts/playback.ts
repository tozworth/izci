import type { TrackKind } from './media-format';

export type PlaybackState =
  'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
export type PlaybackRestoreMode =
  'disabled' | 'position' | 'position-and-state';
export type PlaybackTransitionMode = 'none' | 'fadeout' | 'crossfade';
export type ReplayGainMode = 'off' | 'track' | 'album';

export interface PlaybackSnapshot {
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  backend: TrackKind | null;
  /** Zero-based active module subsong. Present only for module playback. */
  subsong?: number;
  subsongCount?: number;
  /** Buffered media ranges in seconds ([start, end]); download-ahead backends only. */
  buffered?: Array<[number, number]>;
  error?: string;
}
