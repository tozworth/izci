import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

const harness = vi.hoisted(() => {
  interface PendingLoad {
    instance: MockBackend;
    track: PlaylistItem;
    resolve: () => void;
  }

  const instances: MockBackend[] = [];
  const pendingLoads: PendingLoad[] = [];

  class MockBackend {
    snapshotCallback: ((partial: Partial<PlaybackSnapshot>) => void) | undefined;
    metadataCallback: ((metadata: TrackMetadata) => void) | undefined;
    endedCallback: (() => void) | undefined;
    load = vi.fn((track: PlaylistItem) => new Promise<void>((resolve) => {
      pendingLoads.push({ instance: this, track, resolve });
    }));
    destroy = vi.fn();
    stop = vi.fn();
    unload = vi.fn();
    play = vi.fn();
    pause = vi.fn();
    seek = vi.fn();
    setPlaybackRate = vi.fn();
    setTransitionGain = vi.fn();
    setVolume = vi.fn();
    setFallbackVolume = vi.fn();
    applySettings = vi.fn(() => Promise.resolve());
    stepSubsong = vi.fn(() => null);
    togglePictureInPicture = vi.fn(() => Promise.resolve(false));
    element = null;
    pictureInPictureSupported = false;

    constructor(...callbacks: unknown[]) {
      this.snapshotCallback = callbacks[0] as ((partial: Partial<PlaybackSnapshot>) => void);
      this.metadataCallback = callbacks[1] as ((metadata: TrackMetadata) => void);
      this.endedCallback = callbacks.at(-1) as (() => void);
      instances.push(this);
    }

    emitSnapshot(partial: Partial<PlaybackSnapshot>): void {
      this.snapshotCallback?.(partial);
    }
  }

  const playbackSettings = {
    playbackRate: 1,
    trueSpeed: false,
    logarithmicVolume: false,
    replayGainMode: 'off',
    gaplessPlayback: true
  };

  return {
    MockBackend,
    instances,
    pendingLoads,
    audioBus: {
      resume: vi.fn(() => Promise.resolve()),
      setInputGain: vi.fn(),
      setOutputGain: vi.fn(),
      setRafEffectBypass: vi.fn(),
      destroy: vi.fn()
    },
    mediaSession: {
      activateTransportAnchor: vi.fn(),
      deactivateTransportAnchor: vi.fn(),
      playTransportAnchor: vi.fn(),
      pauseTransportAnchor: vi.fn()
    },
    playbackStore: {
      getSnapshot: () => playbackSettings,
      subscribe: (listener: (value: typeof playbackSettings) => void) => {
        listener(playbackSettings);
        return vi.fn();
      }
    },
    metadataStore: {
      getSnapshot: () => ({ inferFromFilename: false }),
      subscribe: (listener: (value: { inferFromFilename: boolean }) => void) => {
        listener({ inferFromFilename: false });
        return vi.fn();
      }
    },
    moduleStore: {
      subscribe: (listener: (value: Record<string, never>) => void) => {
        listener({});
        return vi.fn();
      }
    },
    volumeStore: {
      getSnapshot: () => 0.8,
      set: vi.fn()
    }
  };
});

vi.mock('$lib/services/howler-player', () => ({ HowlerPlayerService: harness.MockBackend }));
vi.mock('$lib/services/module-player', () => ({ ModulePlayerService: harness.MockBackend }));
vi.mock('$lib/services/ahx-player', () => ({ HivelyPlayerService: harness.MockBackend }));
vi.mock('$lib/services/video-player', () => ({ VideoPlayerService: harness.MockBackend }));
vi.mock('$lib/services/audio-bus', () => ({ audioBusService: harness.audioBus }));
vi.mock('$lib/services/media-session', () => ({ mediaSessionService: harness.mediaSession }));
vi.mock('$lib/services/stream-artwork', () => ({ loadTrackMetadata: vi.fn(() => Promise.resolve(null)) }));
vi.mock('$lib/stores/playback-settings', () => ({ playbackSettings: harness.playbackStore }));
vi.mock('$lib/stores/metadata-settings', () => ({ metadataSettings: harness.metadataStore }));
vi.mock('$lib/stores/module-playback-settings', () => ({ modulePlaybackSettings: harness.moduleStore }));
vi.mock('$lib/stores/player-volume', () => ({
  DEFAULT_PLAYER_VOLUME: 0.85,
  playerVolume: harness.volumeStore
}));
vi.mock('$lib/services/volume', () => ({ sliderVolumeToGain: (value: number) => value }));
vi.mock('$lib/services/logging', () => ({
  logDebug: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarning: vi.fn()
}));
vi.mock('$lib/utils/files', () => ({
  mergeInferredArtistTitle: (metadata: TrackMetadata) => metadata
}));

import { playerController } from './player-controller';

function track(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.mp3`,
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    metadata: { embeddedMetadataLoaded: true }
  };
}

async function flushUntilPending(id: string): Promise<void> {
  for (let pass = 0; pass < 10; pass += 1) {
    if (harness.pendingLoads.some((pending) => pending.track.id === id)) return;
    await Promise.resolve();
  }
  throw new Error(`Backend load for ${id} was not started`);
}

function resolvePending(id: string) {
  const index = harness.pendingLoads.findIndex((pending) => pending.track.id === id);
  if (index < 0) throw new Error(`No pending backend load for ${id}`);
  const [pending] = harness.pendingLoads.splice(index, 1);
  pending.resolve();
  return pending;
}

async function loadInitial(id = 'origin'): Promise<void> {
  const loading = playerController.load(track(id), { autoPlay: true });
  await flushUntilPending(id);
  resolvePending(id);
  await loading;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: (callback: TimerHandler, delay?: number) => globalThis.setTimeout(callback, delay),
    clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  harness.pendingLoads.length = 0;
  vi.clearAllMocks();
  playerController.unload();
});

afterEach(() => {
  playerController.unload();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

afterAll(() => {
  playerController.destroy();
});

describe('player controller supersession characterization', () => {
  it('commits only C when crossfade preparation A then B then C resolves out of order', async () => {
    await loadInitial();
    const transitions = [] as Array<Promise<void>>;

    for (const id of ['a', 'b', 'c']) {
      transitions.push(playerController.transitionTo(track(id), 'crossfade', 1));
      await flushUntilPending(id);
    }

    const staleB = resolvePending('b');
    const staleA = resolvePending('a');
    const currentC = resolvePending('c');
    await Promise.all(transitions);

    expect(get(playerController.currentTrack)?.id).toBe('c');
    expect(currentC.instance.play).toHaveBeenCalledOnce();
    expect(staleA.instance.play).not.toHaveBeenCalled();
    expect(staleB.instance.play).not.toHaveBeenCalled();

    const snapshotBeforeStaleEvent = get(playerController.snapshot);
    staleA.instance.emitSnapshot({ state: 'ended', currentTime: 999 });
    expect(get(playerController.snapshot)).toEqual(snapshotBeforeStaleEvent);
  });

  it('lets only the newest fadeout timer start a replacement backend load', async () => {
    await loadInitial();
    const transitions = ['a', 'b', 'c'].map((id) =>
      playerController.transitionTo(track(id), 'fadeout', 1)
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await flushUntilPending('c');
    expect(harness.pendingLoads.map(({ track: pendingTrack }) => pendingTrack.id)).toEqual(['c']);

    resolvePending('c');
    await Promise.all(transitions);
    expect(get(playerController.currentTrack)?.id).toBe('c');
  });

  it('keeps C authoritative when same-backend A, B, and C loads finish C, A, B', async () => {
    const loads: Array<Promise<void>> = [];
    for (const id of ['a', 'b', 'c']) {
      loads.push(playerController.load(track(id), { autoPlay: true }));
      await flushUntilPending(id);
    }

    resolvePending('c');
    resolvePending('a');
    resolvePending('b');
    await Promise.all(loads);

    expect(get(playerController.currentTrack)?.id).toBe('c');
    expect(get(playerController.snapshot)).toMatchObject({ state: 'playing', backend: 'stream' });
  });
});
