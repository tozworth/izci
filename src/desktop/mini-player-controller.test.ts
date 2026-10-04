import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';
import { MINI_PLAYER_CLOSED_EVENT, MINI_PLAYER_COMMAND_EVENT, MINI_PLAYER_REQUEST_EVENT, MINI_PLAYER_STATE_EVENT } from './mini-player-protocol';

const native = vi.hoisted(() => ({
  invoke: vi.fn(async () => undefined),
  emitTo: vi.fn(async () => undefined),
  callbacks: new Map<string, (event: { payload: unknown }) => void>(),
  releases: [] as ReturnType<typeof vi.fn>[],
  listen: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: native.emitTo, listen: native.listen }));

import { createDesktopMiniPlayerController } from './mini-player-controller';

function setup() {
  const patternSeekTimes = writable<readonly number[] | null>(null);
  const snapshot = writable<PlaybackSnapshot>({ state: 'playing', currentTime: 3, duration: 30, volume: 0.5, muted: false, backend: 'stream' });
  const handlers = {
    togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
    seek: vi.fn(), setVolume: vi.fn(), toggleMute: vi.fn(), enterNowPlaying: vi.fn()
  };
  const controller = createDesktopMiniPlayerController({
    patternSeekTimes,
    snapshot, handlers, track: writable<TrackItem | null>(null),
    selectedTrack: writable<TrackItem | null>(null), artworkUrl: writable<string | null>(null)
  });
  return { controller, snapshot, handlers, patternSeekTimes };
}

describe('desktop miniplayer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    native.callbacks.clear();
    native.releases.length = 0;
    native.listen.mockImplementation(async (event, callback) => {
      native.callbacks.set(event, callback);
      const release = vi.fn(() => native.callbacks.delete(event));
      native.releases.push(release);
      return release;
    });
  });
  afterEach(() => vi.useRealTimers());

  it('publishes pattern timing and setting changes while playback is paused', async () => {
    const { controller, snapshot, patternSeekTimes } = setup();
    snapshot.update((value) => ({ ...value, state: 'paused', backend: 'module' }));
    await controller.open();
    patternSeekTimes.set([0, 7.68, 11.52]);
    await vi.advanceTimersByTimeAsync(100);
    expect(native.emitTo).toHaveBeenLastCalledWith('mini-player', MINI_PLAYER_STATE_EVENT,
      expect.objectContaining({ patternSeekTimes: [0, 7.68, 11.52] }));
    patternSeekTimes.set(null);
    await vi.advanceTimersByTimeAsync(100);
    expect(native.emitTo).toHaveBeenLastCalledWith('mini-player', MINI_PLAYER_STATE_EVENT,
      expect.objectContaining({ patternSeekTimes: null }));
    controller.destroy();
  });

  it('publishes current state and routes commands to the existing playback owner', async () => {
    const { controller, snapshot, handlers } = setup();
    await controller.open();
    expect(native.invoke).toHaveBeenCalledWith('open_mini_player');
    expect(native.emitTo).toHaveBeenCalledWith('mini-player', MINI_PLAYER_STATE_EVENT, expect.objectContaining({ snapshot: expect.objectContaining({ currentTime: 3 }) }));
    native.callbacks.get(MINI_PLAYER_COMMAND_EVENT)?.({ payload: { action: 'seek', value: 90 } });
    expect(handlers.seek).toHaveBeenCalledWith(30);
    native.callbacks.get(MINI_PLAYER_COMMAND_EVENT)?.({ payload: { action: 'setVolume', value: -2 } });
    expect(handlers.setVolume).not.toHaveBeenCalled();
    snapshot.update((value) => ({ ...value, currentTime: 5 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(native.emitTo).toHaveBeenLastCalledWith('mini-player', MINI_PLAYER_STATE_EVENT, expect.objectContaining({ snapshot: expect.objectContaining({ currentTime: 5 }) }));
    native.callbacks.get(MINI_PLAYER_REQUEST_EVENT)?.({ payload: null });
    controller.close();
    native.callbacks.get(MINI_PLAYER_COMMAND_EVENT)?.({ payload: { action: 'togglePlayback' } });
    expect(handlers.togglePlayback).not.toHaveBeenCalled();
    controller.destroy();
    expect(native.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it('cancels an opening operation without reopening the native window', async () => {
    const { controller } = setup();
    const pending = controller.open();
    controller.close();
    await pending;
    expect(controller.getSnapshot().active).toBe(false);
    expect(native.invoke).not.toHaveBeenCalledWith('open_mini_player');
    controller.destroy();
  });

  it('ends mini mode after a native return to main and can open it again', async () => {
    const { controller, handlers } = setup();
    await controller.open();
    native.callbacks.get(MINI_PLAYER_CLOSED_EVENT)!({ payload: null });
    expect(controller.getSnapshot()).toMatchObject({ active: false, opening: false });
    native.callbacks.get(MINI_PLAYER_COMMAND_EVENT)!({ payload: { action: 'togglePlayback' } });
    expect(handlers.togglePlayback).not.toHaveBeenCalled();
    native.invoke.mockClear();
    controller.toggle();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('open_mini_player');
    expect(controller.getSnapshot().active).toBe(true);
    controller.destroy();
  });

  it('releases late listeners and cancels timers when the playback owner is destroyed', async () => {
    const { controller, snapshot } = setup();
    controller.destroy();
    await Promise.resolve();
    await Promise.resolve();
    snapshot.update((value) => ({ ...value, currentTime: 10 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(native.emitTo).not.toHaveBeenCalled();
    expect(native.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    await controller.open();
    expect(native.invoke).not.toHaveBeenCalledWith('open_mini_player');
  });
});
