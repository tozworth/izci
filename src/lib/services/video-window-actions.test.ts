import { describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const player = vi.hoisted(() => ({ videoPictureInPictureActive: false }));
vi.mock('$lib/services/player-controller', () => ({ playerController: player }));

import { createVideoWindowActions } from './video-window-actions';

describe('video presentation during picture-in-picture', () => {
  it('keeps the current workspace and theater state when switching videos', () => {
    const showMediaTab = vi.fn();
    const setTheaterActive = vi.fn();
    const actions = createVideoWindowActions({
      getVisualMediaActive: () => true,
      getTheaterActive: () => false,
      setTheaterActive,
      setTheaterControlsHidden: vi.fn(),
      getPendingVisualTrack: () => false,
      getIsNowPlayingLayoutActive: () => false,
      getIsAutomaticNowPlayingEligible: () => false,
      setAutoNowPlayingSuppressed: vi.fn(),
      getWindowDisplayState: () => ({ maximized: false, fullscreen: false }),
      mobileMode: false,
      showMediaTab,
      closeMediaTab: vi.fn()
    });
    const video: TrackItem = {
      id: 'first', name: 'first.mp4', extension: 'mp4', kind: 'video', size: 1, lastModified: 1
    };
    player.videoPictureInPictureActive = false;
    actions.syncPresentation(video, true);
    showMediaTab.mockClear();
    setTheaterActive.mockClear();

    player.videoPictureInPictureActive = true;
    actions.syncPresentation({ ...video, id: 'second' }, true);
    expect(showMediaTab).not.toHaveBeenCalled();
    expect(setTheaterActive).not.toHaveBeenCalled();

    player.videoPictureInPictureActive = false;
    actions.syncPresentation({ ...video, id: 'third' }, true);
    expect(showMediaTab).toHaveBeenCalledOnce();
    expect(setTheaterActive).toHaveBeenCalledWith(true);
  });
});
