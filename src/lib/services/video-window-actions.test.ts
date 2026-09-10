import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import { createVideoWindowActions } from './video-window-actions';

function videoTrack(id: string): TrackItem {
  return {
    id,
    name: `${id}.mp4`,
    extension: 'mp4',
    kind: 'video',
    size: 1,
    lastModified: 1
  };
}

function createActions(overrides: Record<string, unknown> = {}) {
  const deps = {
    getVisualMediaActive: () => false,
    getTheaterActive: () => false,
    setTheaterActive: vi.fn(),
    setTheaterControlsHidden: vi.fn(),
    getPendingVisualTrack: () => false,
    getIsNowPlayingLayoutActive: () => false,
    getIsAutomaticNowPlayingEligible: () => false,
    setAutoNowPlayingSuppressed: vi.fn(),
    getWindowDisplayState: () => ({ maximized: false, fullscreen: false }),
    mobileMode: false,
    showMediaTab: vi.fn(),
    closeMediaTab: vi.fn(),
    ...overrides
  };
  return { actions: createVideoWindowActions(deps), deps };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('theater hold across launched replace', () => {
  it('holds theater when the old track unloads while a visual track is pending', () => {
    const { actions, deps } = createActions({
      getPendingVisualTrack: () => true
    });

    actions.syncPresentation(videoTrack('old'), true);
    expect(deps.setTheaterActive).toHaveBeenCalledWith(true);

    deps.setTheaterActive.mockClear();
    (deps.closeMediaTab as ReturnType<typeof vi.fn>).mockClear();
    actions.syncPresentation(null, true);

    expect(deps.setTheaterActive).not.toHaveBeenCalled();
    expect(deps.closeMediaTab).not.toHaveBeenCalled();
  });

  it('survives repeated inactive syncs while the visual track loads', () => {
    const { actions, deps } = createActions({
      getPendingVisualTrack: () => true
    });

    actions.syncPresentation(videoTrack('old'), true);
    actions.syncPresentation(null, true);
    actions.syncPresentation(null, true);
    expect(deps.setTheaterActive).toHaveBeenCalledTimes(1);
    expect(deps.closeMediaTab).not.toHaveBeenCalled();

    actions.syncPresentation(videoTrack('new'), true);
    expect(deps.setTheaterActive).toHaveBeenCalledWith(true);
    expect(deps.showMediaTab).toHaveBeenCalled();
  });

  it('tears down when nothing visual is incoming', () => {
    const { actions, deps } = createActions();

    actions.syncPresentation(videoTrack('old'), true);
    actions.syncPresentation(null, true);

    expect(deps.setTheaterActive).toHaveBeenLastCalledWith(false);
    expect(deps.closeMediaTab).toHaveBeenCalledOnce();
  });

  it('honors a pre-armed theater on the first sync instead of tearing it down', () => {
    const { actions, deps } = createActions({
      getTheaterActive: () => true
    });

    actions.syncPresentation(null, true);

    expect(deps.setTheaterActive).not.toHaveBeenCalled();
    expect(deps.closeMediaTab).not.toHaveBeenCalled();

    actions.syncPresentation(videoTrack('new'), true);
    expect(deps.setTheaterActive).toHaveBeenCalledWith(true);
  });

  it('still tears down on the first sync without a pre-arm', () => {
    const { actions, deps } = createActions();

    actions.syncPresentation(null, true);

    expect(deps.setTheaterActive).toHaveBeenCalledWith(false);
    expect(deps.closeMediaTab).toHaveBeenCalledOnce();
  });

  it('releases a stale hold once the pending track clears with no track', () => {
    let pending = true;
    const { actions, deps } = createActions({
      getPendingVisualTrack: () => pending
    });

    actions.syncPresentation(videoTrack('old'), true);
    actions.syncPresentation(null, true);
    expect(deps.closeMediaTab).not.toHaveBeenCalled();

    pending = false;
    actions.syncPresentation(null, true);
    expect(deps.setTheaterActive).toHaveBeenLastCalledWith(false);
    expect(deps.closeMediaTab).toHaveBeenCalledOnce();
  });
});

describe('theater re-entry on repeated syncs', () => {
  function createLiveTheaterActions() {
    let theaterActive = false;
    const { actions, deps } = createActions({
      getTheaterActive: () => theaterActive,
      setTheaterActive: vi.fn((active: boolean) => {
        theaterActive = active;
      })
    });

    return {
      actions,
      deps,
      exitTheater: () => {
        theaterActive = false;
      },
      isTheaterActive: () => theaterActive
    };
  }

  it('does not re-enter theater when the same visual track syncs again', () => {
    const { actions, deps, exitTheater, isTheaterActive } = createLiveTheaterActions();

    actions.syncPresentation(videoTrack('clip'), true);
    expect(isTheaterActive()).toBe(true);

    // The user leaves theater; unrelated publishes (panel resize, selection)
    // re-run the sync and must not drag them back in.
    exitTheater();
    (deps.setTheaterActive as ReturnType<typeof vi.fn>).mockClear();

    actions.syncPresentation(videoTrack('clip'), true);

    expect(deps.setTheaterActive).not.toHaveBeenCalled();
    expect(deps.closeMediaTab).not.toHaveBeenCalled();
    expect(deps.showMediaTab).toHaveBeenCalled();
    expect(isTheaterActive()).toBe(false);
  });

  it('re-enters theater when the next visual track starts', () => {
    const { actions, deps, exitTheater, isTheaterActive } = createLiveTheaterActions();

    actions.syncPresentation(videoTrack('first'), true);
    exitTheater();
    (deps.setTheaterActive as ReturnType<typeof vi.fn>).mockClear();

    actions.syncPresentation(videoTrack('second'), true);

    expect(deps.setTheaterActive).toHaveBeenCalledWith(true);
    expect(isTheaterActive()).toBe(true);
  });
});
