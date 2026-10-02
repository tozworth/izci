import type { Readable } from 'svelte/store';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export interface PlatformIntegrationOptions {
  snapshot: Readable<PlaybackSnapshot>;
  track: Readable<TrackItem | null>;
  playbackStarts?: Readable<number>;
  canControl: () => boolean;
  handlers: {
    togglePlayback: () => void; previousTrack: () => void; nextTrack: () => void;
    openOptions: () => void; enterOda: () => void; miniPlayer: () => void; exit: () => void;
  };
  importFiles: (files: File[]) => Promise<void>;
}
