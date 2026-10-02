import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUBBLE_DISMISS_EVENT, BUBBLE_STATE_EVENT, type TrackBubbleUpdate } from './tray-bubble-protocol';

const native = vi.hoisted(() => ({ invoke: vi.fn(async (command: string): Promise<unknown> => command.startsWith('show_') ? true : undefined), callbacks: new Map<string, (event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async (event, callback) => { native.callbacks.set(event, callback); return () => native.callbacks.delete(event); }),
}));
import { createTrayBubblePresenter } from './tray-bubble-presenter';

describe('track bubble presentation', () => {
  let dispose: (() => void) | undefined;
  const render = vi.fn();
  const measure = vi.fn(async () => ({ width: 320, height: 36 }));
  const update = (id: string, announce = true) => native.callbacks.get(BUBBLE_STATE_EVENT)!({ payload: { track: { id, title: id, artist: 'Artist' }, announce } satisfies TrackBubbleUpdate });
  const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
  beforeEach(async () => {
    vi.useFakeTimers(); render.mockClear(); native.invoke.mockClear(); native.callbacks.clear(); measure.mockClear();
    native.invoke.mockImplementation(async (command) => command.startsWith('show_') ? true : undefined);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 0; });
    dispose = createTrayBubblePresenter(render, measure); await flush();
  });
  afterEach(async () => { dispose?.(); await flush(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('fades out and hides after five seconds even if metadata arrives late', async () => {
    update('First'); await flush();
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'First' }), true);
    await vi.advanceTimersByTimeAsync(3000);
    update('First', false); await flush();
    await vi.advanceTimersByTimeAsync(1860);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'First' }), false);
    native.invoke.mockClear();
    await vi.advanceTimersByTimeAsync(140);
    expect(native.invoke).toHaveBeenCalledWith('hide_desktop_track_bubble');
    expect(render).toHaveBeenLastCalledWith(null, false);
    update('First', false); await flush();
    expect(render).toHaveBeenLastCalledWith(null, false);
  });

  it('replaces the previous track and cancels its old expiry', async () => {
    update('First'); await flush(); await vi.advanceTimersByTimeAsync(4000);
    update('Next'); await flush(); native.invoke.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.invoke).not.toHaveBeenCalledWith('hide_desktop_track_bubble');
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'Next' }), true);
    await vi.advanceTimersByTimeAsync(4000);
    expect(render).toHaveBeenLastCalledWith(null, false);
  });

  it('stays invisible when Windows supplies no usable icon anchor', async () => {
    native.invoke.mockImplementation(async () => false);
    update('First'); await flush();
    expect(render.mock.calls.some(([, visible]) => visible === true)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['hide_desktop_track_bubble', 'show_desktop_track_bubble']);
  });

  it('does not replay a suppressed bubble after the player loses focus', async () => {
    native.invoke.mockImplementation(async () => false);
    update('First'); await flush();
    native.invoke.mockImplementation(async (command) => command.startsWith('show_') ? true : undefined);
    update('First', false); await flush();
    expect(render.mock.calls.some(([, visible]) => visible === true)).toBe(false);
    update('First'); await flush();
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'First' }), true);
  });

  it('dismisses an existing bubble when either player gains focus and cancels pending shows', async () => {
    update('First'); await flush();
    native.callbacks.get(BUBBLE_DISMISS_EVENT)!({ payload: null }); await flush();
    expect(render).toHaveBeenLastCalledWith(null, false);
    expect(native.invoke).toHaveBeenLastCalledWith('hide_desktop_track_bubble');
    let finish!: (size: { width: number; height: number }) => void;
    measure.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    update('Next'); await flush(); native.invoke.mockClear();
    native.callbacks.get(BUBBLE_DISMISS_EVENT)!({ payload: null });
    finish({ width: 320, height: 28 }); await flush();
    expect(render).toHaveBeenLastCalledWith(null, false);
    expect(native.invoke).not.toHaveBeenCalledWith('show_desktop_track_bubble', expect.anything());
  });

  it('skips a stale show when a newer track arrives during measurement', async () => {
    let finish!: (size: { width: number; height: number }) => void;
    measure.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    update('First'); await flush();
    update('Next'); finish({ width: 320, height: 36 }); await flush();
    expect(native.invoke.mock.calls.filter(([command]) => command === 'show_desktop_track_bubble')).toHaveLength(1);
    expect(render).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'Next' }), true);
  });
});
