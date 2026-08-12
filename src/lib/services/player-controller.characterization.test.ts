import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

const harness = vi.hoisted(() => {
  interface PendingLoad {
    instance: MockBackend;
    track: PlaylistItem;
    resolve: () => void;
    reject: (error: Error) => void;
  }

  const instances: MockBackend[] = [];
  const pendingLoads: PendingLoad[] = [];

  class MockBackend {
    role: 'stream' | 'module' | 'hively' | 'video';
    snapshotCallback: ((partial: Partial<PlaybackSnapshot>) => void) | undefined;
    metadataCallback: ((metadata: TrackMetadata) => void) | undefined;
    endedCallback: (() => void) | undefined;
    load = vi.fn((track: PlaylistItem) => new Promise<void>((resolve, reject) => {
      pendingLoads.push({ instance: this, track, resolve, reject });
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
      this.role = (['stream', 'module', 'hively', 'video'] as const)[instances.length % 4];
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

type BackendRole = 'stream' | 'module' | 'hively' | 'video';

function backendTrack(id: string, backend: BackendRole): PlaylistItem {
  const facts = {
    stream: { name: `${id}.mp3`, extension: 'mp3', kind: 'stream' as const },
    module: { name: `${id}.mod`, extension: 'mod', kind: 'module' as const },
    hively: { name: `${id}.ahx`, extension: 'ahx', kind: 'module' as const },
    video: { name: `${id}.mp4`, extension: 'mp4', kind: 'video' as const }
  }[backend];
  return {
    id,
    ...facts,
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

async function loadInitial(
  id = 'origin',
  backend: BackendRole = 'stream'
): Promise<ReturnType<typeof resolvePending>> {
  const loading = playerController.load(backendTrack(id, backend), { autoPlay: true });
  await flushUntilPending(id);
  const pending = resolvePending(id);
  await loading;
  return pending;
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
  harness.playbackStore.getSnapshot().replayGainMode = 'off';
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

  const backendSwitches = (['stream', 'module', 'hively', 'video'] as const).flatMap(
    (from) => (['stream', 'module', 'hively', 'video'] as const).map((to) => [from, to] as const)
  );

  it.each(backendSwitches)(
    'commits a prepared crossfade from %s to %s through the intended backend',
    async (from, to) => {
      await loadInitial(`from-${from}`, from);
      const target = backendTrack(`to-${to}`, to);
      const transition = playerController.transitionTo(target, 'crossfade', 0.25);
      await flushUntilPending(target.id);
      const incoming = resolvePending(target.id);
      await transition;

      expect(incoming.instance.role).toBe(to);
      expect(incoming.instance.play).toHaveBeenCalledOnce();
      expect(get(playerController.currentTrack)?.id).toBe(target.id);
    }
  );

  it('keeps the active backend when prepared crossfade loading fails', async () => {
    await loadInitial('origin');
    const transition = playerController.transitionTo(track('failed'), 'crossfade', 1);
    await flushUntilPending('failed');
    const failed = harness.pendingLoads.splice(
      harness.pendingLoads.findIndex((pending) => pending.track.id === 'failed'),
      1
    )[0];
    failed.reject(new Error('fixture load failed'));
    await transition;

    expect(get(playerController.currentTrack)?.id).toBe('origin');
    expect(failed.instance.play).not.toHaveBeenCalled();
  });

  it('routes play, pause, and seek to the active backend during load and preparation', async () => {
    const loading = playerController.load(backendTrack('loading-module', 'module'), { autoPlay: false });
    await flushUntilPending('loading-module');
    const loadingBackend = harness.pendingLoads.find(
      (pending) => pending.track.id === 'loading-module'
    )!;
    playerController.play();
    playerController.pause();
    playerController.seek(12);
    expect(loadingBackend.instance.play).toHaveBeenCalled();
    expect(loadingBackend.instance.pause).toHaveBeenCalled();
    expect(loadingBackend.instance.seek).toHaveBeenCalledWith(12);
    resolvePending('loading-module');
    await loading;

    const transition = playerController.transitionTo(backendTrack('preparing-video', 'video'), 'crossfade', 1);
    await flushUntilPending('preparing-video');
    playerController.play();
    playerController.pause();
    playerController.seek(24);
    expect(loadingBackend.instance.play).toHaveBeenCalledTimes(2);
    expect(loadingBackend.instance.pause).toHaveBeenCalledTimes(2);
    expect(loadingBackend.instance.seek).toHaveBeenLastCalledWith(24);
    resolvePending('preparing-video');
    await transition;
  });

  it('preserves stream ReplayGain/master volume and video Auto Amp bypass decisions', async () => {
    harness.playbackStore.getSnapshot().replayGainMode = 'track';
    const replayGain = { trackGainDb: -6, trackPeak: 0.9 };
    const streamTrack = {
      ...backendTrack('gain-stream', 'stream'),
      metadata: { embeddedMetadataLoaded: true, replayGain }
    };
    const loading = playerController.load(streamTrack, { autoPlay: true });
    await flushUntilPending(streamTrack.id);
    const stream = resolvePending(streamTrack.id);
    await loading;
    playerController.setVolume(0.5);
    expect(stream.instance.setVolume).toHaveBeenLastCalledWith(0.5, false, replayGain, 'track');
    expect(harness.audioBus.setOutputGain).toHaveBeenLastCalledWith(0.5);
    playerController.toggleMute();
    expect(harness.audioBus.setOutputGain).toHaveBeenLastCalledWith(0);

    const videoTrack = backendTrack('auto-amp-video', 'video');
    const videoLoad = playerController.load(videoTrack, { autoPlay: true });
    await flushUntilPending(videoTrack.id);
    resolvePending(videoTrack.id);
    await videoLoad;
    expect(harness.audioBus.setRafEffectBypass).toHaveBeenLastCalledWith('auto-amp', true);
  });
});
