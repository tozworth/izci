import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

import { createPlaybackRestorationController, normalizePlaybackRestorationCheckpoint } from './playback-restoration';

describe('playback restoration helpers', () => {
  it('normalizes a valid checkpoint and clamps negative positions', () => {
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: 'track-1',
        currentTime: -4,
        wasPlaying: true
      })
    ).toEqual({
      trackId: 'track-1',
      currentTime: 0,
      wasPlaying: true
    });
  });

  it('rejects incomplete and non-finite checkpoints', () => {
    expect(normalizePlaybackRestorationCheckpoint(null)).toBeNull();
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: '',
        currentTime: 10,
        wasPlaying: false
      })
    ).toBeNull();
    expect(
      normalizePlaybackRestorationCheckpoint({
        trackId: 'track-1',
        currentTime: Number.NaN,
        wasPlaying: false
      })
    ).toBeNull();
  });
});

describe('playback restoration lifecycle', () => {
  const key = 'izci.playback-restoration';
  const saved = { trackId: 'track-1', currentTime: 42, wasPlaying: true };
  const item = { id: 'track-1', name: 'song.xm', kind: 'module' } as TrackItem;
  let storage: Map<string, string>;
  let controllers: ReturnType<typeof createPlaybackRestorationController>[];

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map([[key, JSON.stringify(saved)]]);
    controllers = [];
    const events = new EventTarget();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key)
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events)
    });
    playbackSettings.update({ restoreMode: 'position-and-state' });
  });

  afterEach(() => {
    controllers.forEach((controller) => controller.destroy());
    playbackSettings.reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function setup() {
    const track = writable<TrackItem | null>(null);
    const snapshot = writable({ state: 'idle', currentTime: 0 } as PlaybackSnapshot);
    const getQueueTrack = vi.fn(() => item);
    const ensureLoaded = vi.fn(async (): Promise<TrackItem | null> => item);
    const prepareFileAccess = vi.fn(async () => undefined);
    const selectTrack = vi.fn();
    const loadTrack = vi.fn(async (item: TrackItem, options: { autoPlay: boolean; initialPosition: number }) => {
      track.set(item);
      snapshot.set({ state: options.autoPlay ? 'playing' : 'paused', currentTime: options.initialPosition } as PlaybackSnapshot);
    });
    const controller = createPlaybackRestorationController({ track, snapshot, getQueueTrack, ensureLoaded, prepareFileAccess, selectTrack, loadTrack });
    controllers.push(controller);
    return { controller, track, snapshot, ensureLoaded, prepareFileAccess, selectTrack, loadTrack };
  }

  it('retains the checkpoint while collections hydrate and prepares access before materializing', async () => {
    const runtime = setup();
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(storage.get(key)!)).toEqual(saved);
    runtime.ensureLoaded.mockImplementation(async () => {
      expect(runtime.prepareFileAccess).toHaveBeenCalledOnce();
      return item;
    });
    await expect(runtime.controller.restore()).resolves.toBe(true);
    expect(runtime.selectTrack).toHaveBeenCalledWith(item.id);
    expect(runtime.loadTrack).toHaveBeenCalledWith(item, { autoPlay: true, initialPosition: 42 });
  });

  it('restores position without autoplay in position-only mode', async () => {
    playbackSettings.update({ restoreMode: 'position' });
    const runtime = setup();
    await runtime.controller.restore();
    expect(runtime.loadTrack).toHaveBeenCalledWith(item, { autoPlay: false, initialPosition: 42 });
  });

  it('preserves inaccessible checkpoints through idle updates and shutdown so reopening can retry', async () => {
    const runtime = setup();
    runtime.ensureLoaded.mockResolvedValue(null);
    await expect(runtime.controller.restore()).resolves.toBe(false);
    runtime.snapshot.set({ state: 'idle', currentTime: 0 } as PlaybackSnapshot);
    await vi.advanceTimersByTimeAsync(2000);
    runtime.controller.destroy();
    expect(JSON.parse(storage.get(key)!)).toEqual(saved);
    const reopened = setup();
    await expect(reopened.controller.restore()).resolves.toBe(true);
    expect(reopened.loadTrack).toHaveBeenCalledWith(item, { autoPlay: true, initialPosition: 42 });
  });

  it('keeps the checkpoint when native permission setup fails and can record later manual playback', async () => {
    const runtime = setup();
    runtime.prepareFileAccess.mockRejectedValue(new Error('Access unavailable'));
    await expect(runtime.controller.restore()).resolves.toBe(false);
    expect(runtime.ensureLoaded).not.toHaveBeenCalled();
    expect(JSON.parse(storage.get(key)!)).toEqual(saved);
    runtime.track.set(item);
    runtime.snapshot.set({ state: 'playing', currentTime: 67 } as PlaybackSnapshot);
    await vi.advanceTimersByTimeAsync(500);
    expect(JSON.parse(storage.get(key)!)).toEqual({ ...saved, currentTime: 67 });
  });

  it('does not let decoder failures abort the launch or replace the saved position', async () => {
    const runtime = setup();
    runtime.loadTrack.mockImplementation(async () => {
      runtime.track.set(item);
      runtime.snapshot.set({ state: 'error', currentTime: 0 } as PlaybackSnapshot);
      throw new Error('Decode failed');
    });
    await expect(runtime.controller.restore()).resolves.toBe(false);
    runtime.controller.destroy();
    expect(JSON.parse(storage.get(key)!)).toEqual(saved);
  });
});
