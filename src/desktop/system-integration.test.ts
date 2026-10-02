import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { PlaybackSnapshot } from '$lib/types';
import { TRAY_ACTION_EVENT } from './tray-protocol';

const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string): Promise<unknown> => undefined),
  emitTo: vi.fn(async () => undefined),
  callbacks: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn()
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: native.emitTo, listen: native.listen }));
vi.mock('./files', () => ({ readDesktopFiles: vi.fn() }));

import { createPlatformIntegration } from './system-integration';
import { desktopSettings } from './settings';
import { readDesktopFiles } from './files';

describe('desktop tray window activation', () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    native.callbacks.clear();
    native.invoke.mockResolvedValue(undefined);
    native.listen.mockImplementation(async (event, callback) => {
      native.callbacks.set(event, callback);
      return () => native.callbacks.delete(event);
    });
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    desktopSettings.reset();
    vi.useRealTimers();
  });

  it('applies the saved tray color and updates it without unrelated native changes', async () => {
    desktopSettings.update({ showIn: 'both', trayIcon: 'dark' });
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 30, volume: 1, muted: false, backend: 'stream' }),
      canControl: () => true,
      handlers: {
        togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_visibility', { showIn: 'both', trayIcon: 'dark' });
    native.invoke.mockClear();
    desktopSettings.update({ trayIcon: 'light' });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls).toEqual([['configure_desktop_visibility', { showIn: 'both', trayIcon: 'light' }]]);
    native.invoke.mockClear();
    desktopSettings.update({ trayIcon: 'light' });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).not.toHaveBeenCalled();
    desktopSettings.update({ showIn: 'taskbar' });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_visibility', { showIn: 'taskbar', trayIcon: 'light' });
    native.invoke.mockClear();
    desktopSettings.update({ showIn: 'tray' });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_visibility', { showIn: 'tray', trayIcon: 'light' });
  });

  it('applies saved and live launch focus preferences while continuing to import files', async () => {
    desktopSettings.update({ focusOnFileLaunch: false });
    const files = [{} as File];
    vi.mocked(readDesktopFiles).mockResolvedValue(files);
    const importFiles = vi.fn(async () => undefined);
    native.invoke.mockImplementation(async (command) => command === 'take_desktop_launch_paths' ? ['C:\\music\\track.flac'] : undefined);
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 30, volume: 1, muted: false, backend: 'stream' }),
      canControl: () => true,
      handlers: {
        togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles
    });
    await vi.advanceTimersByTimeAsync(75);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_file_launch', { focus: false });
    expect(importFiles).toHaveBeenCalledWith(files);
    expect(native.invoke).not.toHaveBeenCalledWith('restore_main_window');
    native.invoke.mockClear();
    desktopSettings.update({ focusOnFileLaunch: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls).toEqual([['configure_desktop_file_launch', { focus: true }]]);
  });

  it.each(['open', 'enterOda'])('%s uses the native switch back to the main window', async (action) => {
    const handlers = {
      togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
      openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
    };
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 30, volume: 1, muted: false, backend: 'stream' }),
      canControl: () => true,
      handlers,
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    native.invoke.mockClear();

    let finishRestore!: () => void;
    native.invoke.mockImplementation(async (command) => {
      if (command === 'restore_main_window') await new Promise<void>((resolve) => { finishRestore = resolve; });
    });
    native.callbacks.get(TRAY_ACTION_EVENT)!({ payload: action });
    expect(native.invoke).toHaveBeenCalledWith('restore_main_window');
    expect(handlers.enterOda).not.toHaveBeenCalled();

    finishRestore();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['restore_main_window']);
    expect(handlers.enterOda).toHaveBeenCalledTimes(action === 'enterOda' ? 1 : 0);
    expect(handlers.miniPlayer).not.toHaveBeenCalled();
  });
});
