import type { Readable } from 'svelte/store';
import type { PlaybackSnapshot } from '$lib/types';

export interface PlatformIntegrationOptions {
  snapshot: Readable<PlaybackSnapshot>;
  canControl: () => boolean;
  handlers: {
    togglePlayback: () => void; previousTrack: () => void; nextTrack: () => void;
    openOptions: () => void; miniPlayer: () => void; exit: () => void;
  };
  importFiles: (files: File[]) => Promise<void>;
}
