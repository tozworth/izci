import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultiplayerPlayback } from '$lib/services/multiplayer-protocol';
import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

const controllerHarness = vi.hoisted(() => ({
  snapshot: {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.5,
    muted: false,
    backend: null
  } as PlaybackSnapshot,
  track: null as PlaylistItem | null,
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
      subscribe(run: (value: PlaylistItem | null) => void) {
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

const track: PlaylistItem = {
  id: 'track-1',
  name: 'Transferred track',
  extension: 'opus',
  kind: 'stream',
  size: 1_024,
  lastModified: 1
};

function playback(state: PlaybackSnapshot['state']): MultiplayerPlayback {
  return {
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
      loadedTrack: PlaylistItem,
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

  it('stops drift-correcting and mirroring the host clock on the local timeline', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'playing', currentTime: 1 };

    service.syncPlayback(playback('playing'));

    expect(controllerHarness.seek).not.toHaveBeenCalled();
    expect(controllerHarness.pause).not.toHaveBeenCalled();
  });

  it('starts a transferred file on the local timeline without the host position', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));

    await service.loadFile(track, {} as File);

    expect(controllerHarness.load).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'track-1' }),
      { autoPlay: true, initialPosition: 0 }
    );
  });

  it('restarts the current file for freeplay repeat-one', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'ended', currentTime: 180 };

    expect(service.replay()).toBe(true);
    expect(controllerHarness.seek).toHaveBeenCalledWith(0);
    expect(controllerHarness.play).toHaveBeenCalled();
  });

  it('leaves local-timeline mode when the host clock is authoritative again', async () => {
    const service = new MultiplayerSourcePlaybackService();
    service.setLocalTimeline(true);
    service.syncPlayback(playback('playing'));
    await service.loadFile(track, {} as File);
    controllerHarness.snapshot = { ...controllerHarness.snapshot, state: 'paused', currentTime: 1 };

    service.setLocalTimeline(false);
    service.syncPlayback(playback('playing'));

    expect(controllerHarness.play).toHaveBeenCalled();
  });
});
