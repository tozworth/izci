/** Presentation-neutral commands Oda consumes from the shared main runtime. */
export interface OdaCommands {
  activateLibraryTrack(id: string): void | Promise<void>;
  activateQueueTrack(id: string): void | Promise<void>;
  removeQueueTracks(ids: string[]): void;
  moveQueueTrack?(id: string, direction: -1 | 1): void;
  togglePlayback(): void;
  stop(): void;
  stepTrack(direction: -1 | 1): void;
  seek(seconds: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  exitOda(): void;
  dismissPlaybackError?(): void;
}
