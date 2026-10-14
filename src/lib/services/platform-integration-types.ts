import type { Readable } from 'svelte/store';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';
import type { OptionsViewName } from '../../options/views';

export interface PlatformIntegrationOptions {
  snapshot: Readable<PlaybackSnapshot>;
  track: Readable<TrackItem | null>;
  playbackStarts?: Readable<number>;
  canControl: () => boolean;
  handlers: {
    stepVolume: (delta: number) => number;
    togglePlayback: () => void; previousTrack: () => void; nextTrack: () => void;
    openOptions: (view?: OptionsViewName) => void; enterOda: () => void; miniPlayer: () => void; exit: () => void;
  };
  importFiles: (files: File[]) => Promise<void>;
}
