import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import type { OpenMptInspection, OpenMptProgress } from './openmpt/protocol';

const harness = vi.hoisted(() => {
  function player() {
    return {
      gain: {}, duration: 1200,
      handlers: {} as { metadata?: (inspection: OpenMptInspection) => void; progress?: (progress: OpenMptProgress) => void; ended?: () => void; error?: (message: string) => void },
      load: vi.fn(async (_buffer: ArrayBuffer, subsong: number) => ({ subsong, metadata: { duration: 1200, subsongs: 3, channels: 4 } })),
      play: vi.fn(), pause: vi.fn(), dispose: vi.fn(), seek: vi.fn(),
      configure: vi.fn(), selectSubsong: vi.fn(), setChannelMutes: vi.fn()
    };
  }
  const players: ReturnType<typeof player>[] = [];
  return {
    player, players,
    create: vi.fn(async () => { const next = player(); players.push(next); return next; }),
    inspect: vi.fn(async (_buffer: ArrayBuffer, _options: { patterns: boolean; subsong: number; signal: AbortSignal }): Promise<OpenMptInspection> => ({ subsong: 0, metadata: {} }))
  };
});

vi.mock('./openmpt/player', () => ({ OpenMptPlayer: { create: harness.create } }));
vi.mock('./openmpt/decoder', () => ({ moduleDecoder: { inspect: harness.inspect } }));
vi.mock('$lib/services/audio-bus', () => ({
  audioBusService: { context: {}, connectAudioNode: vi.fn(), disconnect: vi.fn(), setSourceGain: vi.fn(), resume: vi.fn() }
}));
vi.mock('$lib/services/media-session', () => ({
  mediaSessionService: { activateTransportAnchor: vi.fn(), deactivateTransportAnchor: vi.fn(), playTransportAnchor: vi.fn(), pauseTransportAnchor: vi.fn() }
}));
vi.mock('$lib/services/logging', () => ({ logDebug: vi.fn(), logInfo: vi.fn(), logError: vi.fn(), logWarning: vi.fn() }));

import { DEFAULT_MODULE_PLAYBACK_SETTINGS } from '$lib/stores/module-playback-settings';
import { ModulePlayerService } from './module-player';

const track: TrackItem = {
  id: 'module', name: 'Test.mod', extension: 'mod', kind: 'module', size: 4, lastModified: 1,
  file: { arrayBuffer: async () => new ArrayBuffer(4) } as File
};

describe('module backend lifecycle', () => {
  let service: ModulePlayerService;
  const snapshot = vi.fn();
  const metadata = vi.fn();
  const pattern = vi.fn();
  beforeEach(() => {
    harness.players.length = 0;
    vi.clearAllMocks();
    service = new ModulePlayerService(snapshot, metadata, pattern, vi.fn());
  });
  afterEach(() => service.stop());

  it('republishes prepared pattern timing on activation and clears it on subsong changes', async () => {
    const song = { channels: [''], instruments: [], samples: [], orders: [], patterns: [], numSubsongs: 3, patternStartTimes: [0, 7.68] };
    harness.inspect.mockResolvedValueOnce({ subsong: 0, metadata: {}, song });
    await service.load(track);
    await Promise.resolve();
    pattern.mockClear();
    service.play();
    expect(pattern).toHaveBeenCalledWith({ song });
    service.stepSubsong(1);
    expect(pattern).toHaveBeenLastCalledWith({ song: null, order: 0, pattern: 0, row: 0 });
  });

  it('updates settings on the paused player, preserving channel masks and position', async () => {
    await service.load(track);
    const player = harness.players[0];
    service.play();
    service.seek(10);
    service.setChannelMutes([false, true, false, true]);
    service.pause();
    await service.applySettings({ ...DEFAULT_MODULE_PLAYBACK_SETTINGS, interpolationFilter: 4, stereoSeparation: 150 });
    expect(harness.players).toHaveLength(1);
    expect(player.configure).toHaveBeenLastCalledWith(expect.objectContaining({ interpolationFilter: 4, stereoSeparation: 150 }));
    expect(player.setChannelMutes).toHaveBeenLastCalledWith([false, true, false, true]);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(10);
    expect(player.pause).toHaveBeenCalledOnce();
    service.play();
    expect(player.play).toHaveBeenCalledTimes(2);
    await service.load({ ...track, id: 'next' });
    expect(player.dispose).toHaveBeenCalledOnce();
    expect(harness.players[1].setChannelMutes).toHaveBeenLastCalledWith([]);
  });

  it('loads the requested subsong atomically and keeps long durations in seconds', async () => {
    await service.load({ ...track, subsong: 2 });
    expect(harness.players[0].load).toHaveBeenCalledWith(expect.any(ArrayBuffer), 2, expect.any(Object));
    expect(metadata).toHaveBeenLastCalledWith(expect.objectContaining({ duration: 1200 }));
    expect(snapshot).toHaveBeenCalledWith(expect.objectContaining({ subsong: 2, subsongCount: 3, duration: 1200 }));
    service.setChannelMutes([true]);
    service.pause();
    expect(service.stepSubsong(1)).toBe(0);
    expect(harness.players[0].selectSubsong).toHaveBeenCalledWith(0);
    expect(harness.players[0].setChannelMutes).toHaveBeenLastCalledWith([true]);
    expect(harness.inspect).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), expect.objectContaining({ patterns: true, subsong: 0 }));
  });

  it('ignores events from replaced players and cancels old pattern jobs', async () => {
    await service.load(track);
    const old = harness.players[0];
    const oldJob = harness.inspect.mock.calls[0][1] as unknown as { signal: AbortSignal };
    await service.load({ ...track, id: 'new' });
    snapshot.mockClear();
    old.handlers.progress?.({ currentTime: 15, order: 1, row: 2, pattern: 1, subsong: 0 });
    old.handlers.error?.('old failure');
    expect(snapshot).not.toHaveBeenCalled();
    expect(oldJob.signal.aborted).toBe(true);
  });

  it('disposes a controller that finishes creating after stop', async () => {
    let resolve: (player: ReturnType<typeof harness.player>) => void = () => undefined;
    harness.create.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const loading = service.load(track);
    await Promise.resolve();
    service.stop();
    const detached = harness.player();
    resolve(detached);
    await loading;
    expect(detached.dispose).toHaveBeenCalledOnce();
    expect(detached.load).not.toHaveBeenCalled();
  });
});
