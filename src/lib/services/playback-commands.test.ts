import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const playbackMocks = vi.hoisted(() => ({
  player: {
    resumeAudio: vi.fn(() => Promise.resolve()),
    reportError: vi.fn(),
    transitionTo: vi.fn((..._args: unknown[]) => Promise.resolve()),
    load: vi.fn(() => Promise.resolve()),
    seek: vi.fn(),
    restart: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    prepareNext: vi.fn(() => Promise.resolve(true)),
    hasPreparedTrack: vi.fn(() => false),
    commitPrepared: vi.fn(() => false),
    fadeOut: vi.fn(),
    unload: vi.fn()
  },
  queue: {
    ensureLoaded: vi.fn(),
    resolveTrackEnd: vi.fn(),
    resolveStepTrack: vi.fn(),
    resolveStartTrack: vi.fn(),
    add: vi.fn(),
    findEquivalent: vi.fn(),
    ready: vi.fn(() => Promise.resolve()),
    replaceAll: vi.fn()
  }
}));

vi.mock('$lib/services/player-controller', () => ({
  playerController: playbackMocks.player
}));

vi.mock('$lib/stores/queue', () => ({
  queueStore: playbackMocks.queue
}));

vi.mock('$lib/stores/up-next', () => ({
  upNext: {
    peek: vi.fn(() => null),
    removeFirstById: vi.fn(),
    removeByIdentity: vi.fn()
  }
}));

vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

vi.mock('$lib/services/file-verification', () => ({
  prepareImportedFiles: vi.fn(async (files: File[]) => files)
}));

import {
  PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS,
  createPlaybackCommandsController,
  isAutomaticFadeWindow,
  resolveManualTransitionDurationSeconds,
  resolveEffectiveTransitionMode,
  shouldRestartForPrevious,
  shouldSkipAutomaticCrossfade
} from './playback-commands';

function track(id: string): TrackItem {
  return {
    id,
    name: `${id}.mp3`,
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createCommands(overrides: Record<string, unknown> = {}) {
  let playingTrack: TrackItem | null = null;
  const tracks = new Map(['a', 'b', 'c'].map((id) => [id, track(id)]));
  const controller = createPlaybackCommandsController({
    getPlayingTrack: () => playingTrack,
    getSelectedQueueTrack: () => null,
    getPlaybackState: () => 'paused',
    getPlaybackCurrentTime: () => 0,
    getPlaybackDuration: () => 60,
    shouldRestartCurrentTrackOnPrevious: () => false,
    getTransitionMode: () => 'crossfade',
    getGaplessPlaybackEnabled: () => true,
    getFadeDurationSeconds: () => 4,
    getManualTrackChangeFadePercent: () => 100,
    getShuffleEnabled: () => false,
    getRepeatMode: () => 'off',
    getTrackById: (_collection, id) => tracks.get(id) ?? null,
    selectTrack: vi.fn(),
    setActiveWorkspaceTab: vi.fn(),
    cleanupRemovedItems: vi.fn(),
    ...overrides
  });
  return {
    controller,
    tracks,
    setPlayingTrack(next: TrackItem | null) {
      playingTrack = next;
      controller.notifyCurrentTrackChanged(next);
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  playbackMocks.player.resumeAudio.mockResolvedValue();
  playbackMocks.player.load.mockResolvedValue();
  playbackMocks.player.transitionTo.mockResolvedValue();
  playbackMocks.player.prepareNext.mockResolvedValue(true);
  playbackMocks.player.hasPreparedTrack.mockReturnValue(false);
  playbackMocks.player.commitPrepared.mockReturnValue(false);
  playbackMocks.queue.ensureLoaded.mockImplementation(async (id: string) => track(id));
});

describe('previous-track restart behavior', () => {
  it('restarts every Next press in a single-item repeating queue without pausing playback', async () => {
    const { controller, tracks, setPlayingTrack } = createCommands({ getPlaybackState: () => 'playing', getRepeatMode: () => 'all' });
    setPlayingTrack(tracks.get('a')!);
    playbackMocks.queue.resolveStepTrack.mockReturnValue(tracks.get('a'));
    for (let index = 0; index < 3; index += 1) await controller.stepTrack(1);
    expect(playbackMocks.player.restart).toHaveBeenCalledTimes(3);
    expect(playbackMocks.player.pause).not.toHaveBeenCalled();
    expect(playbackMocks.player.load).not.toHaveBeenCalled();
    expect(playbackMocks.player.play).not.toHaveBeenCalled();
  });

  it('restarts Previous at the threshold when the setting and a current track are present', () => {
    expect(shouldRestartForPrevious(
      -1,
      true,
      true,
      PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS
    )).toBe(true);
  });

  it('navigates before the threshold or when the setting is disabled', () => {
    expect(shouldRestartForPrevious(-1, true, true, 2.99)).toBe(false);
    expect(shouldRestartForPrevious(-1, false, true, 30)).toBe(false);
  });

  it('never intercepts Next or a missing current track', () => {
    expect(shouldRestartForPrevious(1, true, true, 30)).toBe(false);
    expect(shouldRestartForPrevious(-1, true, false, 30)).toBe(false);
  });
});

describe('track transition behavior', () => {
  it('falls back to fade out when crossfade is selected without gapless playback', () => {
    expect(resolveEffectiveTransitionMode('crossfade', false)).toBe('fadeout');
    expect(resolveEffectiveTransitionMode('crossfade', true)).toBe('crossfade');
    expect(resolveEffectiveTransitionMode('none', false)).toBe('none');
  });

  it('opens the fade window at the configured distance from the end', () => {
    expect(isAutomaticFadeWindow(54.99, 60, 5)).toBe(false);
    expect(isAutomaticFadeWindow(55, 60, 5)).toBe(true);
    expect(isAutomaticFadeWindow(2, 3, 10)).toBe(true);
    expect(isAutomaticFadeWindow(0, 0, 5)).toBe(false);
  });

  it('scales manual transitions from off through the full standard duration', () => {
    expect(resolveManualTransitionDurationSeconds(8, 0)).toBe(0);
    expect(resolveManualTransitionDurationSeconds(8, 25)).toBe(2);
    expect(resolveManualTransitionDurationSeconds(8, 100)).toBe(8);
    expect(resolveManualTransitionDurationSeconds(8, 150)).toBe(8);
  });
});

describe('playback command storm characterization', () => {
  it('lets only the newest file-materialization request reach the player', async () => {
    const { controller, tracks, setPlayingTrack } = createCommands();
    const loads = new Map(['a', 'b', 'c'].map((id) => [id, deferred<TrackItem | null>()]));
    playbackMocks.queue.ensureLoaded.mockImplementation((id: string) => loads.get(id)!.promise);

    const requests = ['a', 'b', 'c'].map((id) => controller.playTrack(tracks.get(id)!));
    expect(controller.getSnapshot().pendingPlaybackTrackId).toBe('c');

    loads.get('b')!.resolve(tracks.get('b')!);
    loads.get('a')!.resolve(tracks.get('a')!);
    await Promise.all([requests[0], requests[1]]);

    expect(playbackMocks.player.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pendingPlaybackTrackId).toBe('c');

    loads.get('c')!.resolve(tracks.get('c')!);
    await requests[2];
    expect(playbackMocks.player.load).toHaveBeenCalledTimes(1);
    expect(playbackMocks.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c' }),
      { autoPlay: true, initialPosition: 0 }
    );

    // Pending state is cleared by the controller's current-track notification,
    // not merely by the load promise settling.
    expect(controller.getSnapshot().pendingPlaybackTrackId).toBe('c');
    setPlayingTrack(tracks.get('c')!);
    expect(controller.getSnapshot().pendingPlaybackTrackId).toBeNull();
  });

  it('does not let stale resume-position work dispatch an older track', async () => {
    const positions = new Map(['a', 'b', 'c'].map((id) => [id, deferred<number>()]));
    const notifyTrackResumed = vi.fn();
    const { controller, tracks } = createCommands({
      resolveResumePosition: (candidate: TrackItem) => positions.get(candidate.id)!.promise,
      notifyTrackResumed
    });

    const requests = ['a', 'b', 'c'].map((id) => controller.playTrack(tracks.get(id)!));
    await Promise.resolve();
    positions.get('b')!.resolve(22);
    positions.get('a')!.resolve(11);
    await Promise.all([requests[0], requests[1]]);
    expect(playbackMocks.player.load).not.toHaveBeenCalled();
    expect(notifyTrackResumed).not.toHaveBeenCalled();

    positions.get('c')!.resolve(33);
    await requests[2];
    expect(playbackMocks.player.load).toHaveBeenCalledOnce();
    expect(playbackMocks.player.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c' }),
      { autoPlay: true, initialPosition: 33 }
    );
    expect(notifyTrackResumed).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }), 33);
  });

  it('suppresses end navigation while overlapping manual transitions are unsettled', async () => {
    const transitions = new Map(['a', 'b', 'c'].map((id) => [id, deferred<void>()]));
    playbackMocks.player.transitionTo.mockImplementation((...args: unknown[]) => {
      const candidate = args[0] as TrackItem;
      return transitions.get(candidate.id)!.promise;
    });
    playbackMocks.queue.resolveTrackEnd.mockReturnValue(track('after-end'));
    const { controller, tracks } = createCommands({ getPlayingTrack: () => track('playing') });

    const requests: Array<Promise<void>> = [];
    for (const id of ['a', 'b', 'c']) {
      requests.push(controller.playTrack(tracks.get(id)!, { manualTransition: true }));
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
    }
    expect(playbackMocks.player.transitionTo).toHaveBeenCalledTimes(3);

    await controller.handleTrackEnded();
    expect(playbackMocks.queue.resolveTrackEnd).not.toHaveBeenCalled();

    for (const id of ['b', 'a', 'c']) transitions.get(id)!.resolve();
    await Promise.all(requests);
    await controller.handleTrackEnded();
    expect(playbackMocks.queue.resolveTrackEnd).toHaveBeenCalledOnce();
  });
});

describe('automatic crossfade skip behavior', () => {
  it('skips when the current track is shorter than twice the fade', () => {
    // 3s track, 5s configured fade: the fade window covers the whole track.
    expect(shouldSkipAutomaticCrossfade(3, 180, 5)).toBe(true);
    // Fade clamps to the track duration, so even a short configured fade is unsafe.
    expect(shouldSkipAutomaticCrossfade(3, 180, 2)).toBe(true);
    expect(shouldSkipAutomaticCrossfade(9, 180, 5)).toBe(true);
  });

  it('skips when the prepared next track is too short for its own tail fade', () => {
    // Long current track but the incoming one can't reach its own fade window
    // before the previous crossfade completes.
    expect(shouldSkipAutomaticCrossfade(180, 3, 5)).toBe(true);
    expect(shouldSkipAutomaticCrossfade(180, 9, 5)).toBe(true);
  });

  it('keeps crossfading when both sides have room', () => {
    expect(shouldSkipAutomaticCrossfade(180, 180, 5)).toBe(false);
    expect(shouldSkipAutomaticCrossfade(60, 30, 5)).toBe(false);
    expect(shouldSkipAutomaticCrossfade(30, 60, 5)).toBe(false);
  });

  it('keeps crossfading when the next duration is unknown', () => {
    expect(shouldSkipAutomaticCrossfade(180, undefined, 5)).toBe(false);
  });
});

describe('launched-file theater pre-arm', () => {
  it('activates the media tab for visual launches when auto-enter is enabled', async () => {
    const { videoSettings, DEFAULT_VIDEO_SETTINGS } = await import('$lib/stores/video-settings');
    videoSettings.set({ ...DEFAULT_VIDEO_SETTINGS, autoEnterTheater: true });
    try {
      const setActiveWorkspaceTab = vi.fn();
      const { controller } = createCommands({ setActiveWorkspaceTab });
      playbackMocks.queue.replaceAll.mockReturnValue({ addedItems: [track('v')], removedItems: [] });

      await controller.importLaunchedFiles(
        [new File(['video'], 'Clip.mp4', { type: 'video/mp4' })],
        'replace'
      );

      expect(setActiveWorkspaceTab).toHaveBeenCalledWith('media');
    } finally {
      videoSettings.reset();
    }
  });

  it('marks the incoming visual track pending before its load resolves', async () => {
    const { videoSettings, DEFAULT_VIDEO_SETTINGS } = await import('$lib/stores/video-settings');
    videoSettings.set({ ...DEFAULT_VIDEO_SETTINGS, autoEnterTheater: true });
    try {
      const { controller } = createCommands({});
      playbackMocks.queue.replaceAll.mockImplementation((items: TrackItem[]) => ({
        addedItems: [items[0]],
        removedItems: []
      }));
      playbackMocks.queue.ensureLoaded.mockImplementation(() => new Promise(() => {}));

      const pending = controller.importLaunchedFiles(
        [new File(['video'], 'Clip.mp4', { type: 'video/mp4' })],
        'replace'
      );
      await vi.waitFor(() => {
        const id = controller.getSnapshot().pendingPlaybackTrackId;
        expect(id).not.toBeNull();
      });
      await Promise.resolve();
      expect(controller.getSnapshot().pendingPlaybackTrackId).not.toBeNull();
      expect(playbackMocks.player.load).not.toHaveBeenCalled();
      void pending.catch(() => {});
    } finally {
      videoSettings.reset();
    }
  });

  it('keeps the queue tab for audio launches', async () => {
    const { videoSettings, DEFAULT_VIDEO_SETTINGS } = await import('$lib/stores/video-settings');
    videoSettings.set({ ...DEFAULT_VIDEO_SETTINGS, autoEnterTheater: true });
    try {
      const setActiveWorkspaceTab = vi.fn();
      const { controller } = createCommands({ setActiveWorkspaceTab });
      playbackMocks.queue.replaceAll.mockReturnValue({ addedItems: [track('a')], removedItems: [] });

      await controller.importLaunchedFiles(
        [new File(['audio'], 'Song.flac', { type: 'audio/flac' })],
        'replace'
      );

      expect(setActiveWorkspaceTab).toHaveBeenCalledWith('queue');
    } finally {
      videoSettings.reset();
    }
  });
});
