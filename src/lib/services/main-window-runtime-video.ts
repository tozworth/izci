/**
 * Main-window video/theater bundle: fabricates the video window actions
 * controller. Pure move from `main-window-runtime.ts` — construction order and
 * behavior are unchanged.
 */

import { get } from 'svelte/store';
import { createVideoWindowActions } from '$lib/services/video-window-actions';
import { windowDisplayState } from '$lib/services/window-display-state';
import type { MainWindowRuntimeState } from '$lib/services/main-window-runtime-state';

export interface MainWindowRuntimeVideoDeps {
  getState(): MainWindowRuntimeState;
  publish(updates: Partial<MainWindowRuntimeState>): void;
  mobileMode: boolean;
  showVideoTab(): void;
  closeVideoTab(): void;
}

export interface MainWindowRuntimeVideoBundle {
  videoActions: ReturnType<typeof createVideoWindowActions>;
}

/** Fabricates the video/theater controller cluster. */
export function createMainWindowRuntimeVideoBundle(
  deps: MainWindowRuntimeVideoDeps
): MainWindowRuntimeVideoBundle {
  const state = deps.getState();
  const videoActions = createVideoWindowActions({
    getVideoTrackActive: () => state.videoTrackActive,
    getTheaterActive: () => state.videoTheaterActive,
    setTheaterActive: (active) => deps.publish({ videoTheaterActive: active }),
    setTheaterControlsHidden: (hidden) => deps.publish({ videoTheaterControlsHidden: hidden }),
    getIsNowPlayingLayoutActive: () => state.isNowPlayingLayoutActive,
    getIsAutomaticNowPlayingEligible: () => state.isAutomaticNowPlayingEligible,
    getAutoNowPlayingSuppressed: () => state.autoNowPlayingSuppressed,
    setAutoNowPlayingSuppressed: (value) => deps.publish({ autoNowPlayingSuppressed: value }),
    getWindowDisplayState: () => {
      const display = get(windowDisplayState);
      return {
        maximized: display.maximized,
        fullscreen: display.fullscreen
      };
    },
    mobileMode: deps.mobileMode,
    showVideoTab: () => deps.showVideoTab(),
    closeVideoTab: () => deps.closeVideoTab()
  });

  return { videoActions };
}
