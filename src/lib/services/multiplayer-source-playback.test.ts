import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultiplayerPlayback } from '$lib/services/multiplayer-protocol';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

const controllerHarness = vi.hoisted(() => ({
  snapshot: {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.5,
    muted: false,
    backend: null
  } as PlaybackSnapshot,
  track: null as TrackItem | null,
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  unload: vi.fn(),
  prepareNext: vi.fn(),
  commitPrepared: vi.fn()
}));

vi.mock('$lib/services/player-controller', () => ({
  playerController: {
    snapshot: {
      subscribe(run: (value: PlaybackSnapshot) => void) {
        run(controllerHarness.snapshot);
        return () => undefined;
      }
    },
    currentTrack: {
      subscribe(run: (value: TrackItem | null) => void) {
        run(controllerHarness.track);
        return () => undefined;
      }
    },
    load: controllerHarness.load,
    play: controllerHarness.play,
    pause: controllerHarness.pause,
    seek: controllerHarness.seek,
    unload: controllerHarness.unload,
    prepareNext: controllerHarness.prepareNext,
    commitPrepared: controllerHarness.commitPrepared
  }
}));

import { MultiplayerSourcePlaybackService } from './multiplayer-source-playback';

const track: TrackItem = {
  id: 'track-1',
  name: 'Transferred track',
  extension: 'opus',
  kind: 'stream',
  size: 1_024,
  lastModified: 1
};

function playback(state: PlaybackSnapshot['state']): MultiplayerPlayback {
  return {
    generationId: 'generation',
    track,
    sentAt: Date.now(),
    snapshot: {
      state,
      currentTime: 30,
      duration: 180,
      volume: 0.5,
      muted: false,
      backend: 'stream'
    }
  };
}

describe('MultiplayerSourcePlaybackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    controllerHarness.snapshot = {
      state: 'idle',
      currentTime: 0,
      duration: 0,
      volume: 0.5,
      muted: false,
      backend: null
    };
    controllerHarness.track = null;
    controllerHarness.load.mockImplementation(async (
      loadedTrack: TrackItem,
      options: { autoPlay: boolean; initialPosition: number }
    ) => {
      controllerHarness.track = loadedTrack;
      controllerHarness.snapshot = {
        ...controllerHarness.snapshot,
        state: options.autoPlay ? 'playing' : 'paused',
        currentTime: options.initialPosition,
        duration: 180,
        backend: loadedTrack.kind
      };
    });
    controllerHarness.play.mockImplementation(() => {
      controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'playing' };
    });
    controllerHarness.pause.mockImplementation(() => {
      controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'paused' };
    });
    controllerHarness.prepareNext.mockResolvedValue(true);
    controllerHarness.commitPrepared.mockReturnValue(true);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:transferred-track'),
      revokeObjectURL: vi.fn()
    });
  });

  it('plays once when repeated host snapshots remain in the playing state', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.syncPlayback(playback('paused'));
    await service.loadFile(track, {} as File);

    const playing = playback('playing');
    for (let index = 0; index < 20; index += 1) service.syncPlayback(playing);

    expect(controllerHarness.play).toHaveBeenCalledTimes(1);
  });

  it('prepares a loading replacement before releasing the active transferred file', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:replacement-track');
    const replacement = { ...track, id: 'track-2', name: 'Replacement track' };
    service.syncPlayback({ ...playback('loading'), track: replacement });

    await service.loadFile(replacement, {} as File);

    expect(controllerHarness.prepareNext).toHaveBeenCalledWith(expect.objectContaining({
      id: 'track-2',
      objectUrl: 'blob:replacement-track'
    }));
    expect(controllerHarness.commitPrepared).toHaveBeenCalledWith('track-2');
    expect(controllerHarness.unload).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:transferred-track');
  });

  it('does not chase timer-stale progress while the client is hidden', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'playing', currentTime: 1 };
    vi.stubGlobal('document', { visibilityState: 'hidden' });

    service.syncPlayback(playback('playing'));

    expect(controllerHarness.seek).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not mirror host transport or progress on a Freeplay local timeline', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'playing', currentTime: 1 };

    service.syncPlayback(playback('paused'));

    expect(controllerHarness.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-1' }),
      { autoPlay: true, initialPosition: 0 }
    );
    expect(controllerHarness.pause).not.toHaveBeenCalled();
    expect(controllerHarness.seek).not.toHaveBeenCalled();
  });

  it('replays repeat-one locally without asking the host to rebuild the timeline', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'ended', currentTime: 180 };

    expect(service.replay()).toBe(true);
    expect(controllerHarness.seek).toHaveBeenCalledWith(0);
    expect(controllerHarness.play).toHaveBeenCalled();
  });

  it('arms a transferred file and compensates when the shared start arrives late', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const service = new MultiplayerSourcePlaybackService();
    service.syncPlayback(playback('paused'));
    await service.loadFile(track, {} as File);

    expect(service.scheduleSynchronizedStart('generation', 'track-1', 30, 9_950)).toBe(true);
    await vi.runOnlyPendingTimersAsync();

    expect(controllerHarness.seek).toHaveBeenLastCalledWith(30.05);
    expect(controllerHarness.play).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
