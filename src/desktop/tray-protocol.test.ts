import { describe, expect, it } from 'vitest';
import { parseTrayAction, trayItems } from './tray-protocol';
import { normalizeDesktopSettings } from './settings';

describe('desktop tray', () => {
  it('defaults to taskbar only and normalizes desktop preferences independently of loadouts', () => {
    expect(normalizeDesktopSettings(null)).toEqual({ showIn: 'taskbar', fileAssociations: true });
    expect(normalizeDesktopSettings({ showIn: 'invalid' })).toEqual({ showIn: 'taskbar', fileAssociations: true });
    expect(normalizeDesktopSettings({ showIn: 'both', fileAssociations: false })).toEqual({ showIn: 'both', fileAssociations: false });
    expect(normalizeDesktopSettings({ showIn: 'tray' })).toEqual({ showIn: 'tray', fileAssociations: true });
  });
  it('keeps the requested menu order and separators', () => {
    const items = trayItems({ playing: true, canControl: true }, (key) => key);
    expect(items.map((item) => item.id)).toEqual(['previousTrack', 'togglePlayback', 'nextTrack', 'open', 'openOptions', 'enterOda', 'miniPlayer', 'exit']);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual(['open', 'enterOda']);
    expect(items[5].label).toBe('desktop.tray.oda');
    expect(items[1].label).toBe('desktop.tray.pause');
  });
  it('offers Play when paused and disables unavailable transport', () => {
    const items = trayItems({ playing: false, canControl: false }, (key) => key);
    expect(items[1].label).toBe('desktop.tray.play');
    expect(items.slice(0, 3).every((item) => item.disabled)).toBe(true);
    expect(items.slice(3).every((item) => !item.disabled)).toBe(true);
  });
  it('accepts only the tray command vocabulary', () => {
    expect(parseTrayAction('nextTrack')).toBe('nextTrack');
    expect(parseTrayAction('enterOda')).toBe('enterOda');
    for (const value of ['seek', 'constructor', { action: 'exit' }, null]) expect(parseTrayAction(value)).toBeNull();
  });
});
