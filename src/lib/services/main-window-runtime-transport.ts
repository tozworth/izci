/**
 * Main-window transport bundle: fabricates the transport actions controller.
 * Pure move from `main-window-runtime.ts` — construction order and behavior
 * are unchanged.
 */

import { createTransportActions } from '$lib/services/transport-actions';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';
import type { MainWindowRuntimeState } from '$lib/services/main-window-runtime-state';
import type { TrackItem } from '$lib/types';
import type { VideoSeekFeedback } from '$lib/components/workspace/types';

export interface MainWindowRuntimeTransportDeps {
  getState(): MainWindowRuntimeState;
  getPlaybackCommands(): {
    pause(): void;
    play(): void | Promise<void>;
    stop(): void;
    stepTrack(direction: -1 | 1): void | Promise<void>;
    seek(seconds: number): void;
    togglePlayback(): void | Promise<void>;
  };
  getMultiplayerSession(): MultiplayerSessionController;
  setVideoSeekFeedback(feedback: VideoSeekFeedback | null): void;
  resumeLyricsAutoScroll(): void;
  getPlaybackProgress(): { clearProgress(track: TrackItem): Promise<void> | void };
  getResumeNotice(): { trackId: string } | null;
}

export interface MainWindowRuntimeTransportBundle {
  transport: ReturnType<typeof createTransportActions>;
}

/** Fabricates the transport actions controller cluster. */
export function createMainWindowRuntimeTransportBundle(
  deps: MainWindowRuntimeTransportDeps
): MainWindowRuntimeTransportBundle {
  const state = deps.getState();
  const transport = createTransportActions({
    getPlaybackCommands: () => deps.getPlaybackCommands(),
    getMultiplayerSession: () => deps.getMultiplayerSession(),
    getPlaybackSnapshot: () => state.playbackSnapshot,
    getPlayingTrack: () => state.playingTrack,
    getIsMultiplayerClient: () => state.isMultiplayerClient,
    getIsSourceFileFreeplayClient: () => state.isSourceFileFreeplayClient,
    getVideoTrackActive: () => state.videoTrackActive,
    setVideoSeekFeedback: deps.setVideoSeekFeedback,
    resumeLyricsAutoScroll: deps.resumeLyricsAutoScroll,
    getPlaybackProgress: deps.getPlaybackProgress,
    getResumeNotice: () => state.playbackProgressState.notice
  });

  return { transport };
}
