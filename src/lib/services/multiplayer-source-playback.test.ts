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
  unload: vi.fn()
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
    unload: controllerHarness.unload
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
});
