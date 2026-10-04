import type { Readable } from 'svelte/store';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export interface MiniPlayerState {
  supported: boolean;
  active: boolean;
  opening: boolean;
}

export interface MiniPlayerControllerOptions {
  patternSeekTimes?: Readable<readonly number[] | null>;
  snapshot: Readable<PlaybackSnapshot>;
  track: Readable<TrackItem | null>;
  selectedTrack: Readable<TrackItem | null>;
  artworkUrl: Readable<string | null>;
  handlers: {
    togglePlayback: () => void;
    previousTrack: () => void;
    nextTrack: () => void;
    seek: (seconds: number) => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
    enterNowPlaying: () => void;
  };
}

export interface MiniPlayerController extends Readable<MiniPlayerState> {
  getSnapshot: () => MiniPlayerState;
  open: () => Promise<void>;
  close: () => void;
  toggle: () => void;
  destroy: () => void;
}
