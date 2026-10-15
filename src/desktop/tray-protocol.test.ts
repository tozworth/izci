import { describe, expect, it } from 'vitest';
import { parseTrayAction, trayItems } from './tray-protocol';
import { normalizeDesktopSettings } from './settings';
import { buildRafMenuItems } from '$lib/services/raf-menu';
import { normalizeRafSettings } from '$lib/stores/raf-settings';

describe('desktop tray', () => {
  it('defaults to taskbar only and normalizes desktop preferences independently of loadouts', () => {
    expect(normalizeDesktopSettings(null)).toEqual({ zoomPercent: 100, showIn: 'taskbar', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: true, fileAssociations: true, focusOnFileLaunch: true });
    expect(normalizeDesktopSettings({ showIn: 'invalid' })).toEqual({ zoomPercent: 100, showIn: 'taskbar', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: true, fileAssociations: true, focusOnFileLaunch: true });
    expect(normalizeDesktopSettings({ showIn: 'both', trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: true })).toEqual({ zoomPercent: 100, showIn: 'both', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: true });
    expect(normalizeDesktopSettings({ showIn: 'tray' })).toEqual({ zoomPercent: 100, showIn: 'tray', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: true, fileAssociations: true, focusOnFileLaunch: true });
    expect(normalizeDesktopSettings({ closeToTray: true }).closeToTray).toBe(true);
    expect(normalizeDesktopSettings({ closeToTray: 'true' }).closeToTray).toBe(false);
    expect(normalizeDesktopSettings({ launchOnBoot: true }).launchOnBoot).toBe(true);
    expect(normalizeDesktopSettings({ launchOnBoot: 'true' }).launchOnBoot).toBe(false);
    expect(normalizeDesktopSettings({ trayIcon: 'dark' }).trayIcon).toBe('dark');
    expect(normalizeDesktopSettings({ trayIcon: 'invalid' }).trayIcon).toBe('light');
    expect(normalizeDesktopSettings({ trackInfoBubble: 'false' }).trackInfoBubble).toBe(true);
    expect(normalizeDesktopSettings({ focusOnFileLaunch: false }).focusOnFileLaunch).toBe(false);
    expect(normalizeDesktopSettings({ focusOnFileLaunch: 'false' }).focusOnFileLaunch).toBe(true);
  });
  it('keeps the requested menu order and separators', () => {
    const items = trayItems({ playing: true, canControl: true }, (key) => key);
    expect(items.map((item) => item.id)).toEqual(['previousTrack', 'togglePlayback', 'nextTrack', 'openOptions', 'enterOda', 'miniPlayer', 'exit']);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual(['openOptions', 'enterOda']);
    expect(items[4].label).toBe('desktop.tray.oda');
    expect(items[1].label).toBe('desktop.tray.pause');
  });
  it('offers Play when paused and disables unavailable transport', () => {
    const items = trayItems({ playing: false, canControl: false }, (key) => key);
    expect(items[1].label).toBe('desktop.tray.play');
    expect(items.slice(0, 3).every((item) => item.disabled)).toBe(true);
    expect(items.slice(3).every((item) => !item.disabled)).toBe(true);
  });
  it('places the shared Raf menu between transport and Options', () => {
    const rafItems = buildRafMenuItems({
      translate: (key) => String(key),
      rafSettings: normalizeRafSettings({ enabled: true }),
      rafPresets: { presets: [], selectedPresetId: null }
    });
    const items = trayItems({ playing: false, canControl: false }, (key) => key, rafItems);
    expect(items.map((item) => item.id)).toEqual(['previousTrack', 'togglePlayback', 'nextTrack', 'raf', 'openOptions', 'enterOda', 'miniPlayer', 'exit']);
    expect(items[3].children).toBe(rafItems);
    expect(items[3].label).toBe('options.views.raf');
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual(['raf', 'enterOda']);
  });
  it('accepts only the tray command vocabulary', () => {
    expect(parseTrayAction('nextTrack')).toBe('nextTrack');
    expect(parseTrayAction('enterOda')).toBe('enterOda');
    expect(parseTrayAction('toggleRaf')).toBe('toggleRaf');
    expect(parseTrayAction('openRaf')).toBe('openRaf');
    expect(parseTrayAction('applyRafPreset:raf-preset-1')).toBe('applyRafPreset:raf-preset-1');
    for (const value of ['open', 'raf', 'applyRafPreset:', 'applyRafPreset:bad/id', 'seek', 'constructor', { action: 'exit' }, null]) expect(parseTrayAction(value)).toBeNull();
  });
});
