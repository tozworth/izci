import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import type { PlaybackSnapshot } from '$lib/types';
import { TRAY_ACTION_EVENT, TRAY_VOLUME_STEP_EVENT } from './tray-protocol';
import { BUBBLE_VOLUME_EVENT } from './tray-bubble-protocol';

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
import { rafSettings } from '$lib/stores/raf-settings';
import { rafPresets } from '$lib/stores/raf-presets';

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
    rafSettings.reset();
    rafPresets.reset();
    vi.useRealTimers();
  });

  it('applies the saved tray color and updates it without unrelated native changes', async () => {
    desktopSettings.update({ showIn: 'both', trayIcon: 'dark', closeToTray: true });
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 30, volume: 1, muted: false, backend: 'stream' }),
      canControl: () => true,
      handlers: {
        stepVolume: vi.fn(() => 1),
        togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_visibility', { showIn: 'both', trayIcon: 'dark' });
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_close', { closeToTray: true });
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_autostart', { enabled: false });
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
    native.invoke.mockClear();
    desktopSettings.update({ closeToTray: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls).toEqual([['configure_desktop_close', { closeToTray: false }]]);
    native.invoke.mockClear();
    desktopSettings.update({ closeToTray: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('registers saved boot launches, removes them live, and avoids unrelated native changes', async () => {
    desktopSettings.update({ launchOnBoot: true });
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 0, volume: 1, muted: false, backend: null }),
      canControl: () => false,
      handlers: {
        stepVolume: vi.fn(() => 1), togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).toHaveBeenCalledWith('configure_desktop_autostart', { enabled: true });
    native.invoke.mockClear();
    desktopSettings.update({ launchOnBoot: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls).toEqual([['configure_desktop_autostart', { enabled: false }]]);
    native.invoke.mockClear();
    desktopSettings.update({ launchOnBoot: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke).not.toHaveBeenCalled();
    desktopSettings.update({ launchOnBoot: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls).toEqual([['configure_desktop_autostart', { enabled: true }]]);
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
        stepVolume: vi.fn(() => 1),
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

  it('restores the main window before entering Oda', async () => {
    const handlers = {
      stepVolume: vi.fn(() => 1),
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
    native.callbacks.get(TRAY_ACTION_EVENT)!({ payload: 'enterOda' });
    expect(native.invoke).toHaveBeenCalledWith('restore_main_window');
    expect(handlers.enterOda).not.toHaveBeenCalled();

    finishRestore();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(['restore_main_window']);
    expect(handlers.enterOda).toHaveBeenCalledTimes(1);
    expect(handlers.miniPlayer).not.toHaveBeenCalled();
  });

  it('runs Raf controls on the player without restoring the main window', async () => {
    rafSettings.setEnabled(true);
    const preset = rafPresets.create('Tray rack')!;
    rafSettings.setEnabled(false);
    rafPresets.setSelectedPresetId(null);
    const openOptions = vi.fn();
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 0, volume: 1, muted: false, backend: null }),
      canControl: () => false,
      handlers: {
        stepVolume: vi.fn(() => 1), togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions, enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    native.invoke.mockClear();
    const action = native.callbacks.get(TRAY_ACTION_EVENT)!;
    action({ payload: 'toggleRaf' });
    expect(rafSettings.getSnapshot().enabled).toBe(true);
    action({ payload: `applyRafPreset:${preset.id}` });
    expect(rafPresets.getSnapshot().selectedPresetId).toBe(preset.id);
    expect(rafSettings.getSnapshot().effects).toEqual(preset.settings.effects);
    expect(rafSettings.getSnapshot().enabled).toBe(true);
    action({ payload: `applyRafPreset:${preset.id}` });
    expect(rafSettings.getSnapshot().enabled).toBe(false);
    expect(rafPresets.getSnapshot().selectedPresetId).toBe(preset.id);
    action({ payload: `applyRafPreset:${preset.id}` });
    expect(rafSettings.getSnapshot().enabled).toBe(true);
    action({ payload: 'openRaf' });
    expect(openOptions).toHaveBeenCalledWith('raf');
    action({ payload: 'toggleRaf' });
    expect(rafSettings.getSnapshot().enabled).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
    dispose(); dispose = undefined;
    action({ payload: 'toggleRaf' });
    expect(rafSettings.getSnapshot().enabled).toBe(false);
  });

  it('changes local volume and announces it with track bubbles disabled, without activating a window', async () => {
    desktopSettings.update({ showIn: 'both', trackInfoBubble: false });
    let volume = 0.5;
    const stepVolume = vi.fn((delta: number) => (volume = Math.min(1, Math.max(0, volume + delta))));
    dispose = createPlatformIntegration({
      track: writable(null),
      snapshot: writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 0, volume, muted: false, backend: null }),
      canControl: () => false,
      handlers: {
        stepVolume, togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
        openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
      },
      importFiles: vi.fn(async () => undefined)
    });
    await vi.advanceTimersByTimeAsync(0);
    native.invoke.mockClear(); native.emitTo.mockClear();
    const wheel = (payload: unknown) => native.callbacks.get(TRAY_VOLUME_STEP_EVENT)!({ payload });
    wheel(1); wheel(-2); wheel(20); wheel(-30);
    expect(stepVolume.mock.calls.map(([delta]) => delta)).toEqual([0.05, -0.1, 1, -1.5]);
    expect(native.emitTo.mock.calls).toEqual([
      ['tray-bubble', BUBBLE_VOLUME_EVENT, { percent: 55 }],
      ['tray-bubble', BUBBLE_VOLUME_EVENT, { percent: 45 }],
      ['tray-bubble', BUBBLE_VOLUME_EVENT, { percent: 100 }],
      ['tray-bubble', BUBBLE_VOLUME_EVENT, { percent: 0 }]
    ]);
    expect(native.invoke).not.toHaveBeenCalled();
    for (const invalid of [0, NaN, Infinity, 0.5, 1001, '1', null]) wheel(invalid);
    expect(stepVolume).toHaveBeenCalledTimes(4);
    desktopSettings.update({ showIn: 'taskbar' });
    wheel(1);
    expect(stepVolume).toHaveBeenCalledTimes(4);
    const queuedWheel = native.callbacks.get(TRAY_VOLUME_STEP_EVENT)!;
    dispose(); dispose = undefined;
    queuedWheel({ payload: 1 });
    expect(stepVolume).toHaveBeenCalledTimes(4);
  });
});
