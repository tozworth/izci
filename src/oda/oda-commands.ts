import type { TrackItem, VideoFitMode } from '$lib/types';
import type { VideoSeekFeedback } from '$lib/components/workspace/types';

/** The single player-owned visual media elements Oda theaters host. */
export interface OdaMediaHost {
  videoElement: HTMLVideoElement | null;
  imageElement: HTMLImageElement | null;
  parkingHost: HTMLDivElement | null;
  fitMode: VideoFitMode;
  imageZoom: number;
  pictureInPictureSupported: boolean;
  seekFeedback: VideoSeekFeedback | null;
}

/**
 * Presentation-neutral commands Oda consumes from the shared main runtime.
 * Activation resolves the effective track that was requested so Oda can route
 * to the kind-appropriate presentation without reimplementing the
 * local/client/Freeplay branching.
 */
export interface OdaCommands {
  activateLibraryTrack(id: string): TrackItem | null | Promise<TrackItem | null>;
  activateQueueTrack(id: string): TrackItem | null | Promise<TrackItem | null>;
  removeQueueTracks(ids: string[]): void;
  moveQueueTrack(id: string, direction: -1 | 1): void;
  togglePlayback(): void;
  stop(): void;
  stepTrack(direction: -1 | 1): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  setVideoFit(fitMode: VideoFitMode): void;
  togglePictureInPicture(): void;
  zoomStep(factor: number): void;
  resetZoom(): void;
  rotateImage(): void;
  exitOda(): void;
  dismissPlaybackError?(): void;
}
