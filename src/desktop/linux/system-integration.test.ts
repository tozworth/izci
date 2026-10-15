import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { locale } from 'svelte-i18n';
import { initializeLocalization } from '$lib/i18n';
import type { PlaybackSnapshot } from '$lib/types';
import { desktopSettings } from '../settings';
import { rafSettings } from '$lib/stores/raf-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { TRAY_ACTION_EVENT } from '../tray-protocol';

const native = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown): Promise<void> => undefined),
  listen: vi.fn(), release: vi.fn(),
  action: undefined as ((event: { payload: unknown }) => void) | undefined
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }));

import { createPlatformIntegration } from './system-integration';

describe('Linux native tray integration', () => {
  let dispose: (() => void) | undefined;
  const snapshot = writable<PlaybackSnapshot>({ state: 'paused', currentTime: 0, duration: 60, volume: 1, muted: false, backend: 'stream' });
  const handlers = {
    stepVolume: vi.fn(() => 1), togglePlayback: vi.fn(), previousTrack: vi.fn(), nextTrack: vi.fn(),
    openOptions: vi.fn(), enterOda: vi.fn(), miniPlayer: vi.fn(), exit: vi.fn()
  };
  const start = () => {
    dispose = createPlatformIntegration({ snapshot, track: writable(null), canControl: () => true, handlers, importFiles: vi.fn() });
  };
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const payload = () => native.invoke.mock.calls.filter(([command]) => command === 'configure_linux_tray').at(-1)?.[1] as {
    showIn: string; trayIcon: string; closeToTray: boolean;
    items: { id: string; label: string; disabled?: boolean; children?: { id: string; checked?: boolean }[] }[];
  };

  beforeEach(async () => {
    initializeLocalization();
    await locale.set('en');
    vi.useFakeTimers();
    vi.clearAllMocks();
    rafSettings.setEnabled(false);
    native.invoke.mockResolvedValue(undefined);
    native.listen.mockImplementation(async (_event, callback) => { native.action = callback; return native.release; });
    snapshot.set({ state: 'paused', currentTime: 0, duration: 60, volume: 1, muted: false, backend: 'stream' });
  });

  afterEach(() => {
    dispose?.(); dispose = undefined;
    desktopSettings.reset(); rafSettings.reset(); rafPresets.reset();
    vi.useRealTimers();
  });

  it('starts with saved settings after registering actions and ignores Windows-only preferences', async () => {
    desktopSettings.update({ showIn: 'both', trayIcon: 'dark', closeToTray: true });
    start(); await flush();
    expect(native.listen).toHaveBeenCalledWith(TRAY_ACTION_EVENT, expect.any(Function));
    expect(native.invoke).toHaveBeenCalledOnce();
    expect(payload()).toMatchObject({ showIn: 'both', trayIcon: 'dark', closeToTray: true });
    expect(payload().items.map(({ id }) => id)).toEqual([
      'showMain', 'raf', 'openOptions', 'enterOda', 'exit'
    ]);
    native.invoke.mockClear();
    desktopSettings.update({ launchOnBoot: true, fileAssociations: false, trackInfoBubble: false });
    await flush();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('updates localization, presets and live visibility independently of playback', async () => {
    desktopSettings.update({ showIn: 'tray' });
    start(); await flush(); native.invoke.mockClear();
    snapshot.update((value) => ({ ...value, currentTime: 1 }));
    await flush(); expect(native.invoke).not.toHaveBeenCalled();
    snapshot.update((value) => ({ ...value, state: 'playing' }));
    await flush();
    expect(native.invoke).not.toHaveBeenCalled();
    const preset = rafPresets.create('Quiet & clear')!;
    rafPresets.apply(preset.id, true);
    await locale.set('tr'); await flush();
    expect(payload().items.find(({ id }) => id === 'showMain')?.label).toBe('izci’yi göster');
    expect(payload().items.find(({ id }) => id === 'raf')?.children).toContainEqual(expect.objectContaining({ id: `applyRafPreset:${preset.id}`, checked: true }));
    desktopSettings.update({ showIn: 'taskbar' }); await flush();
    expect(payload()).toMatchObject({ showIn: 'taskbar', items: [] });
    desktopSettings.update({ showIn: 'both', closeToTray: true, trayIcon: 'dark' }); await flush();
    expect(payload()).toMatchObject({ showIn: 'both', closeToTray: true, trayIcon: 'dark' });
  });

  it('dispatches Options, Exit and Raf through the playback owner and restores before Oda', async () => {
    desktopSettings.update({ showIn: 'both' });
    start(); await flush();
    const action = (payload: unknown) => native.action!({ payload });
    action('openOptions'); action('exit');
    for (const name of ['openOptions', 'exit'] as const) {
      expect(handlers[name]).toHaveBeenCalledOnce();
    }
    action('toggleRaf'); expect(rafSettings.getSnapshot().enabled).toBe(true);
    action('openRaf'); expect(handlers.openOptions).toHaveBeenLastCalledWith('raf');
    action('miniPlayer'); action('showMain'); action('hideMain'); action(null); action('unknown');
    action('togglePlayback'); action('previousTrack'); action('nextTrack');
    expect(handlers.togglePlayback).not.toHaveBeenCalled();
    expect(handlers.previousTrack).not.toHaveBeenCalled();
    expect(handlers.nextTrack).not.toHaveBeenCalled();
    expect(handlers.miniPlayer).not.toHaveBeenCalled();
    action('enterOda');
    expect(handlers.enterOda).not.toHaveBeenCalled();
    await flush();
    expect(native.invoke).toHaveBeenCalledWith('restore_main_window');
    expect(handlers.enterOda).toHaveBeenCalledOnce();
    desktopSettings.update({ showIn: 'taskbar' });
    action('openOptions'); expect(handlers.openOptions).toHaveBeenCalledTimes(2);
    dispose!(); dispose = undefined;
    action('exit'); expect(handlers.exit).toHaveBeenCalledOnce();
    expect(native.release).toHaveBeenCalledOnce();
  });

  it('releases a late listener and cancels configuration when disposed during setup', async () => {
    start(); dispose!(); dispose = undefined; await flush();
    expect(native.release).toHaveBeenCalledOnce();
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('serializes settings updates while native configuration is pending', async () => {
    let finish!: () => void;
    native.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    start(); await flush();
    desktopSettings.update({ showIn: 'tray' }); await flush();
    expect(native.invoke).toHaveBeenCalledOnce();
    desktopSettings.update({ showIn: 'both', trayIcon: 'dark' });
    finish(); await flush();
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(payload()).toMatchObject({ showIn: 'both', trayIcon: 'dark' });
  });

  it('retries failed configuration on the next update without marking it applied', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      desktopSettings.update({ showIn: 'both' });
      native.invoke.mockRejectedValueOnce(new Error('Indicator unavailable'));
      start(); await flush();
      expect(log).toHaveBeenCalledOnce();
      desktopSettings.update({ trayIcon: 'dark' });
      await flush();
      expect(native.invoke).toHaveBeenCalledTimes(2);
      expect(payload().showIn).toBe('both');
    } finally {
      log.mockRestore();
    }
  });
});
