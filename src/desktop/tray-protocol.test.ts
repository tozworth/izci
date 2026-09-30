import { describe, expect, it } from 'vitest';
import { parseTrayAction, trayItems } from './tray-protocol';
import { normalizeDesktopSettings } from './settings';

describe('desktop tray', () => {
  it('defaults off and normalizes desktop preferences independently of loadouts', () => {
    expect(normalizeDesktopSettings(null)).toEqual({ trayIcon: false, fileAssociations: true });
    expect(normalizeDesktopSettings({ trayIcon: 'true' })).toEqual({ trayIcon: false, fileAssociations: true });
    expect(normalizeDesktopSettings({ trayIcon: true, fileAssociations: false })).toEqual({ trayIcon: true, fileAssociations: false });
  });
  it('keeps the requested menu order and separators', () => {
    const items = trayItems({ playing: true, canControl: true }, (key) => key);
    expect(items.map((item) => item.id)).toEqual(['togglePlayback', 'previousTrack', 'nextTrack', 'open', 'openOptions', 'miniPlayer', 'exit']);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.id)).toEqual(['open', 'miniPlayer']);
    expect(items[0].label).toBe('desktop.tray.pause');
  });
  it('offers Play when paused and disables unavailable transport', () => {
    const items = trayItems({ playing: false, canControl: false }, (key) => key);
    expect(items[0].label).toBe('desktop.tray.play');
    expect(items.slice(0, 3).every((item) => item.disabled)).toBe(true);
    expect(items.slice(3).every((item) => !item.disabled)).toBe(true);
  });
  it('accepts only the tray command vocabulary', () => {
    expect(parseTrayAction('nextTrack')).toBe('nextTrack');
    for (const value of ['seek', 'constructor', { action: 'exit' }, null]) expect(parseTrayAction(value)).toBeNull();
  });
});
