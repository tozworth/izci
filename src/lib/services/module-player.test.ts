import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';

const harness = vi.hoisted(() => {
  const players: ReturnType<typeof createPlayer>[] = [];
  function createPlayer() {
    return {
      gain: { disconnect: vi.fn() },
      context: { resume: vi.fn() },
      onEnded: vi.fn(), onError: vi.fn(), onMetadata: vi.fn(), onProgress: vi.fn(),
      setVol: vi.fn(), setRepeatCount: vi.fn(), setTempo: vi.fn(), setPitch: vi.fn(),
      play: vi.fn(), pause: vi.fn(), unpause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
      selectSubsong: vi.fn(), setChannelMutes: vi.fn()
    };
  }
  return {
    players,
    create: vi.fn(async () => { const player = createPlayer(); players.push(player); return player; })
  };
});

vi.mock('$lib/services/chiptune-loader', () => ({ createChiptunePlayer: harness.create }));
vi.mock('$lib/services/audio-bus', () => ({
  audioBusService: {
    context: {}, connectAudioNode: vi.fn(), disconnect: vi.fn(), setSourceGain: vi.fn(), resume: vi.fn()
  }
}));
vi.mock('$lib/services/media-session', () => ({
  mediaSessionService: {
    activateTransportAnchor: vi.fn(), deactivateTransportAnchor: vi.fn(),
    playTransportAnchor: vi.fn(), pauseTransportAnchor: vi.fn()
  }
}));
vi.mock('$lib/services/logging', () => ({ logDebug: vi.fn(), logInfo: vi.fn(), logError: vi.fn() }));

import { DEFAULT_MODULE_PLAYBACK_SETTINGS } from '$lib/stores/module-playback-settings';
import { ModulePlayerService } from './module-player';

const track: TrackItem = {
  id: 'module', name: 'Test.mod', extension: 'mod', kind: 'module', size: 4, lastModified: 1,
  file: { arrayBuffer: async () => new ArrayBuffer(4) } as File
};

describe('module channel mask lifecycle', () => {
  let service: ModulePlayerService;
  beforeEach(() => {
    harness.players.length = 0;
    vi.clearAllMocks();
    service = new ModulePlayerService(vi.fn(), vi.fn(), vi.fn(), vi.fn());
  });
  afterEach(() => service.stop());

  it('restores the active mask during paused player recreation and clears it for a new track', async () => {
    await service.load(track);
    service.play();
    service.setChannelMutes([false, true, false, true]);
    expect(harness.players[0].setChannelMutes).toHaveBeenLastCalledWith([false, true, false, true]);
    service.seek(10);
    service.pause();
    await service.applySettings({ ...DEFAULT_MODULE_PLAYBACK_SETTINGS, interpolationFilter: 4 });
    expect(harness.players).toHaveLength(2);
    expect(harness.players[1].setChannelMutes).toHaveBeenLastCalledWith([false, true, false, true]);
    expect(harness.players[1].seek).toHaveBeenCalledWith(10);
    expect(harness.players[1].pause).toHaveBeenCalledOnce();
    service.play();
    expect(harness.players[1].unpause).toHaveBeenCalledOnce();
    await service.load({ ...track, id: 'next' });
    service.play();
    expect(harness.players[2].setChannelMutes).toHaveBeenLastCalledWith([]);
  });
});
