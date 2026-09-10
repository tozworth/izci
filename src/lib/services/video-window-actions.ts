import { appearanceSettings } from '$lib/stores/appearance-settings';
import { IMAGE_ZOOM_MIN, stepImageZoom, videoSettings } from '$lib/stores/video-settings';
import { resetImagePan } from '$lib/stores/image-pan';
import { resetImageRotation, rotateImageClockwise } from '$lib/stores/image-rotation';
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
  getVisualMediaActive(): boolean;
  getTheaterActive(): boolean;
  setTheaterActive(active: boolean): void;
  setTheaterControlsHidden(hidden: boolean): void;
  getPendingVisualTrack(): boolean;
  getIsNowPlayingLayoutActive(): boolean;
  getIsAutomaticNowPlayingEligible(): boolean;
  setAutoNowPlayingSuppressed(value: boolean): void;
  getWindowDisplayState(): { maximized: boolean; fullscreen: boolean };
  mobileMode: boolean;
  showMediaTab(): void;
  closeMediaTab(): void;
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
  let lastImageTrackId: string | null = null;

  function syncWindowSize(active: boolean, autoResizeWindow: boolean): void {
    if (active && autoResizeWindow) {
      ensureComfortableVideoWindowSize();
      return;
    }
    restoreVideoWindowSize();
  }

  // One-shot hold across the unload gap of a launched replace: the old track
  // unloads (inactive) before the incoming visual track loads, and tearing
  // down theater in between flashes the workspace.
  let theaterHeldForIncoming = false;

  function syncPresentation(track: TrackItem | null, autoEnterTheater: boolean): void {
    const visualMediaActive = track?.kind === 'video' || track?.kind === 'image';
    const imageTrackId = track?.kind === 'image' ? track.id : null;
    if (imageTrackId !== lastImageTrackId) {
      lastImageTrackId = imageTrackId;
      resetZoom();
      resetImageRotation();
    }
    const signature = visualMediaActive
      ? `${track.id}:${autoEnterTheater ? 'auto' : 'manual'}`
      : 'inactive';

    if (visualMediaActive) {
      presentationSignature = signature;
      theaterHeldForIncoming = false;
      deps.showMediaTab();
      if (autoEnterTheater) {
        deps.setTheaterActive(true);
      }
      return;
    }

    if (deps.getPendingVisualTrack()) {
      presentationSignature = 'inactive';
      theaterHeldForIncoming = true;
      return;
    }

    if (presentationSignature === '' && deps.getTheaterActive()) {
      // A file launch delivered synchronously inside setConsumer during
      // startup and pre-armed theater before this first sync ran. Honor the
      // pre-arm instead of tearing it down; the track path drives from here.
      presentationSignature = 'inactive';
      return;
    }

    if (signature === presentationSignature && !theaterHeldForIncoming) {
      return;
    }
    presentationSignature = signature;
    theaterHeldForIncoming = false;

    deps.setTheaterActive(false);
    deps.setTheaterControlsHidden(false);
    if (windowFullscreen.isControllerFullscreenActive()) {
      void windowFullscreen.exit();
    }
    deps.closeMediaTab();
  }

  function toggleTheater(): void {
    if (!deps.getVisualMediaActive()) {
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

  function zoomStep(factor: number): void {
    const nextZoom = stepImageZoom(videoSettings.getSnapshot().imageZoom, factor);
    videoSettings.update({ imageZoom: nextZoom });
    if (nextZoom <= IMAGE_ZOOM_MIN) {
      resetImagePan();
    }
  }

  function resetZoom(): void {
    if (videoSettings.getSnapshot().imageZoom !== IMAGE_ZOOM_MIN) {
      videoSettings.update({ imageZoom: IMAGE_ZOOM_MIN });
    }
    resetImagePan();
  }

  function rotateImage(): void {
    rotateImageClockwise();
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
    return deps.getVisualMediaActive() ? toggleFullscreen() : toggleFullscreenNowPlaying();
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
    zoomStep,
    resetZoom,
    rotateImage,
    togglePictureInPicture,
    toggleFullscreen,
    toggleFullscreenPresentation,
    toggleNowPlayingView,
    closeNowPlayingView
  };
}
