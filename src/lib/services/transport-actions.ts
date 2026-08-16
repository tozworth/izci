import { playerController } from '$lib/services/player-controller';
import { shouldRestartForPrevious } from '$lib/services/playback-commands';
import { queueStore } from '$lib/stores/queue';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';
import type { VideoSeekFeedback } from '$lib/components/workspace/types';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export type Translate = (
  id: string,
  options?: { default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }
) => string;

export interface TransportActionsDeps {
  getPlaybackCommands(): {
    togglePlayback(): void | Promise<void>;
    play(): void | Promise<void>;
    pause(): void;
    stop(): void;
    stepTrack(direction: -1 | 1): void | Promise<void>;
    seek(seconds: number): void;
  };
  getMultiplayerSession(): MultiplayerSessionController;
  getPlaybackSnapshot(): PlaybackSnapshot;
  getPlayingTrack(): TrackItem | null;
  getIsMultiplayerClient(): boolean;
  getIsSourceFileFreeplayClient(): boolean;
  getVideoTrackActive(): boolean;
  setVideoSeekFeedback(feedback: VideoSeekFeedback | null): void;
  resumeLyricsAutoScroll(): void;
  getPlaybackProgress(): { clearProgress(track: TrackItem): Promise<void> | void };
  getResumeNotice(): { trackId: string } | null;
}

/**
 * Transport actions for the main window: the single set of play/pause/stop/
 * step/seek/volume/shuffle handlers used by the player bar, workspace panels,
 * media session, mini player and keyboard shortcuts. Each handler routes
 * between local playback (playerController/playback-commands) and the
 * multiplayer session depending on the current connection mode.
 */
export function createTransportActions(deps: TransportActionsDeps) {
  let videoSeekFeedbackId = 0;

  function togglePlayback(): void {
    if (deps.getIsMultiplayerClient()) {
      if (deps.getIsSourceFileFreeplayClient()) {
        if (deps.getPlaybackSnapshot().state === 'playing') {
          playerController.pause();
        } else {
          void playerController.resumeAudio();
          playerController.play();
        }
        return;
      }
      deps.getMultiplayerSession().sendCommand({ type: 'transport.toggle' });
      return;
    }
    const session = deps.getMultiplayerSession();
    if (session.getSnapshot().mode === 'hosting' && session.cancelPendingPlayback()) return;
    void deps.getPlaybackCommands().togglePlayback();
  }

  function play(): void {
    if (deps.getIsMultiplayerClient()) {
      if (deps.getIsSourceFileFreeplayClient()) {
        void playerController.resumeAudio();
        playerController.play();
        return;
      }
      deps.getMultiplayerSession().sendCommand({ type: 'transport.play' });
      return;
    }
    void deps.getPlaybackCommands().play();
  }

  function pause(): void {
    if (deps.getIsMultiplayerClient()) {
      if (deps.getIsSourceFileFreeplayClient()) {
        playerController.pause();
        return;
      }
      deps.getMultiplayerSession().sendCommand({ type: 'transport.pause' });
      return;
    }
    deps.getMultiplayerSession().cancelPendingPlayback();
    deps.getPlaybackCommands().pause();
  }

  function stop(): void {
    if (deps.getIsMultiplayerClient()) {
      if (deps.getIsSourceFileFreeplayClient()) {
        playerController.seek(0);
        playerController.pause();
        return;
      }
      deps.getMultiplayerSession().sendCommand({ type: 'transport.stop' });
      return;
    }
    deps.getMultiplayerSession().cancelPendingPlayback();
    deps.getPlaybackCommands().stop();
  }

  function stepTrack(direction: -1 | 1): void {
    if (deps.getIsMultiplayerClient()) {
      if (shouldRestartForPrevious(
        direction,
        playbackSettings.getSnapshot().restartCurrentTrackOnPrevious,
        deps.getPlayingTrack() !== null,
        deps.getPlaybackSnapshot().currentTime
      )) {
        if (deps.getIsSourceFileFreeplayClient()) playerController.seek(0);
        else deps.getMultiplayerSession().sendCommand({ type: 'transport.seek', seconds: 0 });
        return;
      }
      deps.getMultiplayerSession().sendCommand({
        type: direction < 0 ? 'transport.previous' : 'transport.next'
      });
      return;
    }
    void deps.getPlaybackCommands().stepTrack(direction);
  }

  function seek(seconds: number): void {
    if (deps.getIsMultiplayerClient()) {
      if (deps.getIsSourceFileFreeplayClient()) {
        playerController.seek(seconds);
        return;
      }
      deps.getMultiplayerSession().sendCommand({ type: 'transport.seek', seconds });
      return;
    }
    const seekDelta = seconds - deps.getPlaybackSnapshot().currentTime;
    if (deps.getVideoTrackActive() && Math.abs(seekDelta) >= 0.5) {
      deps.setVideoSeekFeedback({
        id: ++videoSeekFeedbackId,
        deltaSeconds: seekDelta
      });
    }
    deps.resumeLyricsAutoScroll();
    deps.getPlaybackCommands().seek(seconds);
  }

  function setVolume(volume: number): void {
    playerController.setVolume(volume);
  }

  function toggleMute(): void {
    playerController.toggleMute();
  }

  function toggleQueueShuffle(): void {
    if (deps.getIsMultiplayerClient()) {
      deps.getMultiplayerSession().sendCommand({ type: 'queue.shuffle' });
      return;
    }
    queueStore.toggleShuffle();
  }

  function cycleQueueRepeat(): void {
    if (deps.getIsMultiplayerClient()) {
      deps.getMultiplayerSession().sendCommand({ type: 'queue.repeat' });
      return;
    }
    queueStore.cycleRepeatMode();
  }

  function startOver(): void {
    const notice = deps.getResumeNotice();
    const playingTrack = deps.getPlayingTrack();
    if (!playingTrack || !notice || playingTrack.id !== notice.trackId) return;

    void deps.getPlaybackProgress().clearProgress(playingTrack);
    seek(0);
  }

  return {
    togglePlayback,
    play,
    pause,
    stop,
    stepTrack,
    seek,
    setVolume,
    toggleMute,
    toggleQueueShuffle,
    cycleQueueRepeat,
    startOver
  };
}

export function localizePlaybackError(message: string, translate: Translate): string {
  if (message === 'Could not access this file. Re-add it or grant file access.') {
    return translate('main.playbackErrors.fileAccess', {
      default: 'Could not access this file. Re-add it or grant file access.'
    });
  }
  if (message === 'libopenmpt failed to decode this module.') {
    return translate('main.playbackErrors.moduleDecode', {
      default: 'libopenmpt failed to decode this module.'
    });
  }
  if (message === 'Module playback failed.') {
    return translate('main.playbackErrors.modulePlayback', { default: 'Module playback failed.' });
  }
  if (message === 'Chromium could not decode this video.') {
    return translate('main.playbackErrors.videoDecode', { default: 'Chromium could not decode this video.' });
  }
  return translate('main.playbackErrors.generic', { default: 'Playback failed.' });
}
