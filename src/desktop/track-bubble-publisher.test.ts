import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';
import { BUBBLE_READY_EVENT, BUBBLE_REQUEST_EVENT, BUBBLE_STATE_EVENT } from './tray-bubble-protocol';

const native = vi.hoisted(() => ({ emitTo: vi.fn(async () => undefined), callbacks: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: native.emitTo,
  listen: vi.fn(async (event, callback) => { native.callbacks.set(event, callback); return () => native.callbacks.delete(event); }),
}));
import { createTrackBubblePublisher } from './track-bubble-publisher';
import { desktopSettings } from './settings';

const item = (id: string, kind: TrackItem['kind'] = 'stream', extension = 'mp3'): TrackItem => ({ id, name: `${id}.${extension}`, extension, kind, size: 1, lastModified: 0, metadata: { title: id, artist: 'Artist' } });

describe('track bubble publishing', () => {
  let dispose: (() => void) | undefined;
  const track = writable<TrackItem | null>(null);
  const snapshot = writable<PlaybackSnapshot>({ state: 'idle', currentTime: 0, duration: 0, backend: null, volume: 1, muted: false });
  const updates = () => native.emitTo.mock.calls.filter((call) => (call as unknown[])[1] === BUBBLE_STATE_EVENT).map((call) => (call as unknown[])[2]);
  const flush = async () => { await vi.advanceTimersByTimeAsync(0); };

  beforeEach(() => {
    vi.useFakeTimers(); native.emitTo.mockClear(); native.callbacks.clear();
    desktopSettings.update({ showIn: 'both', trackInfoBubble: true });
    track.set(null); snapshot.update((value) => ({ ...value, state: 'idle', backend: null }));
    dispose = createTrackBubblePublisher({ track, snapshot }, () => Promise.resolve());
  });
  afterEach(() => { dispose?.(); desktopSettings.reset(); vi.useRealTimers(); });

  it.each([
    { kind: 'stream', extension: 'mp3' }, { kind: 'module', extension: 'mod' },
    { kind: 'module', extension: 'ahx' }, { kind: 'video', extension: 'mp4' },
  ] as const)('announces $extension once it plays; ignores progress and resume; updates metadata without restarting', async ({ kind, extension }) => {
    await flush();
    expect(native.emitTo).toHaveBeenCalledWith('tray-bubble', BUBBLE_REQUEST_EVENT);
    track.set(item('First', kind, extension));
    snapshot.update((value) => ({ ...value, state: 'loading', backend: kind }));
    native.callbacks.get(BUBBLE_READY_EVENT)!({ payload: null });
    await flush(); expect(updates()).toEqual([]);
    snapshot.update((value) => ({ ...value, state: 'playing' }));
    await flush();
    expect(updates()).toEqual([{ track: { id: 'First', title: 'First', artist: 'Artist' }, announce: true }]);
    snapshot.update((value) => ({ ...value, currentTime: 5, state: 'paused' })); await flush();
    snapshot.update((value) => ({ ...value, state: 'playing' })); await flush();
    expect(updates()).toHaveLength(1);
    track.update((value) => ({ ...value!, metadata: { title: 'Hydrated', artist: 'Artist' } })); await flush();
    expect(updates().at(-1)).toEqual({ track: { id: 'First', title: 'Hydrated', artist: 'Artist' }, announce: false });
    track.set(item('Next', kind, extension)); await flush();
    expect(updates().at(-1)).toEqual({ track: { id: 'Next', title: 'Next', artist: 'Artist' }, announce: true });
  });

  it('dismisses on disable and waits for the next track after re-enabling', async () => {
    await flush(); native.callbacks.get(BUBBLE_READY_EVENT)!({ payload: null });
    track.set(item('First')); snapshot.update((value) => ({ ...value, state: 'playing', backend: 'stream' })); await flush();
    desktopSettings.update({ trackInfoBubble: false }); await flush();
    expect(updates().at(-1)).toEqual({ track: null, announce: false });
    const count = updates().length;
    desktopSettings.update({ trackInfoBubble: true }); await flush();
    expect(updates()).toHaveLength(count);
    track.set(item('Next')); await flush();
    expect(updates().at(-1)).toMatchObject({ announce: true });
    desktopSettings.update({ showIn: 'taskbar' }); await flush();
    expect(updates().at(-1)).toEqual({ track: null, announce: false });
  });

  it('waits for native visibility configuration before sending a pending new track', async () => {
    dispose?.();
    let finish!: () => void;
    const settings = new Promise<void>((resolve) => { finish = resolve; });
    dispose = createTrackBubblePublisher({ track, snapshot }, () => settings);
    await flush(); native.callbacks.get(BUBBLE_READY_EVENT)!({ payload: null });
    track.set(item('First')); snapshot.update((value) => ({ ...value, state: 'playing', backend: 'stream' }));
    await flush(); expect(updates()).toEqual([]);
    finish(); await flush(); expect(updates()).toHaveLength(1);
  });
});
