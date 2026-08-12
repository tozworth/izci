import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistItem } from '$lib/types';

const playbackMocks = vi.hoisted(() => ({
  player: {
    resumeAudio: vi.fn(() => Promise.resolve()),
    reportError: vi.fn(),
    transitionTo: vi.fn((..._args: unknown[]) => Promise.resolve()),
    load: vi.fn(() => Promise.resolve()),
    seek: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    prepareNext: vi.fn(() => Promise.resolve(true)),
    hasPreparedTrack: vi.fn(() => false),
    commitPrepared: vi.fn(() => false),
    fadeOut: vi.fn(),
    unload: vi.fn()
  },
  playlist: {
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

vi.mock('$lib/stores/playlist', () => ({
  playlistStore: playbackMocks.playlist
}));

vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));

import {
  PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS,
  createPlaybackCommandsController,
  isAutomaticFadeWindow,
  resolveManualTransitionDurationSeconds,
  resolveEffectiveTransitionMode,
  shouldRestartForPrevious
} from './playback-commands';

function track(id: string): PlaylistItem {
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
  let playingTrack: PlaylistItem | null = null;
  const tracks = new Map(['a', 'b', 'c'].map((id) => [id, track(id)]));
  const controller = createPlaybackCommandsController({
    getPlayingTrack: () => playingTrack,
    getSelectedPlaylistTrack: () => null,
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
    setPlayingTrack(next: PlaylistItem | null) {
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
  playbackMocks.playlist.ensureLoaded.mockImplementation(async (id: string) => track(id));
});

describe('previous-track restart behavior', () => {
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
    const loads = new Map(['a', 'b', 'c'].map((id) => [id, deferred<PlaylistItem | null>()]));
    playbackMocks.playlist.ensureLoaded.mockImplementation((id: string) => loads.get(id)!.promise);

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
      resolveResumePosition: (candidate: PlaylistItem) => positions.get(candidate.id)!.promise,
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
      const candidate = args[0] as PlaylistItem;
      return transitions.get(candidate.id)!.promise;
    });
    playbackMocks.playlist.resolveTrackEnd.mockReturnValue(track('after-end'));
    const { controller, tracks } = createCommands({ getPlayingTrack: () => track('playing') });

    const requests: Array<Promise<void>> = [];
    for (const id of ['a', 'b', 'c']) {
      requests.push(controller.playTrack(tracks.get(id)!, { manualTransition: true }));
      for (let index = 0; index < 4; index += 1) await Promise.resolve();
    }
    expect(playbackMocks.player.transitionTo).toHaveBeenCalledTimes(3);

    await controller.handleTrackEnded();
    expect(playbackMocks.playlist.resolveTrackEnd).not.toHaveBeenCalled();

    for (const id of ['b', 'a', 'c']) transitions.get(id)!.resolve();
    await Promise.all(requests);
    await controller.handleTrackEnded();
    expect(playbackMocks.playlist.resolveTrackEnd).toHaveBeenCalledOnce();
  });
});
