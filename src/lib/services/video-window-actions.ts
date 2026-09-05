import { appearanceSettings } from '$lib/stores/appearance-settings';
import { videoSettings } from '$lib/stores/video-settings';
import { playerController } from '$lib/services/player-controller';
import { windowFullscreen } from '$lib/services/window-fullscreen';
import {
  ensureComfortableNowPlayingWindowSize,
  restoreNowPlayingWindowSize
} from '$lib/services/window-now-playing';
import {
  ensureComfortableVideoWindowSize,
  restoreVideoWindowSize
} from '$lib/services/window-video';
import type { TrackItem, VideoFitMode } from '$lib/types';

interface VideoWindowActionsDeps {
  getVideoTrackActive(): boolean;
  getTheaterActive(): boolean;
  setTheaterActive(active: boolean): void;
  setTheaterControlsHidden(hidden: boolean): void;
  getIsNowPlayingLayoutActive(): boolean;
  getIsAutomaticNowPlayingEligible(): boolean;
  setAutoNowPlayingSuppressed(value: boolean): void;
  getWindowDisplayState(): { maximized: boolean; fullscreen: boolean };
  mobileMode: boolean;
  showVideoTab(): void;
  closeVideoTab(): void;
}

/**
 * Video + Now Playing presentation actions for the main window: window sizing,
 * theater/fit/PiP/fullscreen toggles, and the Now Playing view toggles that
 * fullscreen presentation bridges between. Component-owned reactive state
 * (theater active flags, auto-now-playing suppression) flows through getters
 * and setters so reads happen at call time.
 */
export function createVideoWindowActions(deps: VideoWindowActionsDeps) {
  let presentationSignature = '';

  function syncWindowSize(active: boolean, autoResizeWindow: boolean): void {
    if (active && autoResizeWindow) {
      ensureComfortableVideoWindowSize();
      return;
    }
    restoreVideoWindowSize();
  }

  function syncPresentation(track: TrackItem | null, autoEnterTheater: boolean): void {
    const videoActive = track?.kind === 'video';
    const signature = videoActive
      ? `${track.id}:${autoEnterTheater ? 'auto' : 'manual'}`
      : 'inactive';

    if (signature === presentationSignature) {
      return;
    }

    presentationSignature = signature;

    if (videoActive) {
      deps.showVideoTab();
      if (autoEnterTheater) {
        deps.setTheaterActive(true);
      }
      return;
    }

    deps.setTheaterActive(false);
    deps.setTheaterControlsHidden(false);
    if (windowFullscreen.isControllerFullscreenActive()) {
      void windowFullscreen.exit();
    }
    deps.closeVideoTab();
  }

  function toggleTheater(): void {
    if (!deps.getVideoTrackActive()) {
      return;
    }

    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void windowFullscreen.exit();
      return;
    }

    const nextTheaterActive = !deps.getTheaterActive();
    deps.setTheaterActive(nextTheaterActive);
    if (!nextTheaterActive) {
      deps.setTheaterControlsHidden(false);
    }
  }

  function setFit(fitMode: VideoFitMode): void {
    videoSettings.update({ fitMode });
  }

  async function togglePictureInPicture(): Promise<void> {
    await playerController.toggleVideoPictureInPicture();
  }

  async function toggleFullscreen(): Promise<void> {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      await windowFullscreen.exit();
      return;
    }

    deps.setTheaterActive(true);
    deps.setTheaterControlsHidden(false);
    await windowFullscreen.enter();
  }

  function toggleFullscreenPresentation(): void | Promise<void> {
    return deps.getVideoTrackActive() ? toggleFullscreen() : toggleFullscreenNowPlaying();
  }

  function toggleNowPlayingView(): void {
    if (deps.getIsNowPlayingLayoutActive()) {
      closeNowPlayingView();
      return;
    }

    if (!deps.mobileMode) {
      ensureComfortableNowPlayingWindowSize();
    }

    deps.setAutoNowPlayingSuppressed(false);
    appearanceSettings.update({
      nowPlayingViewActive: true
    });
  }

  function closeNowPlayingView(): void {
    if (deps.getIsAutomaticNowPlayingEligible()) {
      deps.setAutoNowPlayingSuppressed(true);
    }

    if (!deps.mobileMode) {
      restoreNowPlayingWindowSize();
    }
    appearanceSettings.update({
      nowPlayingViewActive: false
    });
  }

  function enableNowPlayingView(): void {
    deps.setAutoNowPlayingSuppressed(false);
    appearanceSettings.update({
      nowPlayingViewActive: true
    });
  }

  async function toggleFullscreenNowPlaying(): Promise<void> {
    if (windowFullscreen.isControllerFullscreenActive()) {
      closeNowPlayingView();
      await windowFullscreen.exit();
      return;
    }

    const { maximized, fullscreen } = deps.getWindowDisplayState();
    if (maximized || fullscreen) {
      toggleNowPlayingView();
      return;
    }

    enableNowPlayingView();
    await windowFullscreen.enter();
  }

  return {
    syncWindowSize,
    syncPresentation,
    toggleTheater,
    setFit,
    togglePictureInPicture,
    toggleFullscreen,
    toggleFullscreenPresentation,
    toggleNowPlayingView,
    closeNowPlayingView
  };
}
