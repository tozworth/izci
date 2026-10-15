import { afterEach, describe, expect, it } from 'vitest';
import { desktopSettings, resetDesktopAppearance, resetDesktopTracks } from './settings';

describe('desktop settings page resets', () => {
  afterEach(() => desktopSettings.reset());

  it('remembers close-to-tray while tray visibility is disabled and reenabled', () => {
    desktopSettings.update({ showIn: 'both', closeToTray: true });
    desktopSettings.update({ showIn: 'taskbar' });
    expect(desktopSettings.getSnapshot().closeToTray).toBe(true);
    desktopSettings.update({ showIn: 'tray' });
    expect(desktopSettings.getSnapshot().closeToTray).toBe(true);
  });

  it('preserves file registration when Appearance is reset', () => {
    desktopSettings.set({ showIn: 'both', trayIcon: 'dark', launchOnBoot: true, closeToTray: true, trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: false });
    resetDesktopAppearance();
    expect(desktopSettings.getSnapshot()).toEqual({ zoomPercent: 100, showIn: 'taskbar', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: true, fileAssociations: false, focusOnFileLaunch: false });
  });

  it('preserves desktop visibility when Tracks is reset', () => {
    desktopSettings.set({ showIn: 'both', trayIcon: 'dark', launchOnBoot: true, closeToTray: true, trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: false });
    resetDesktopTracks();
    expect(desktopSettings.getSnapshot()).toEqual({ zoomPercent: 100, showIn: 'both', trayIcon: 'dark', launchOnBoot: true, closeToTray: true, trackInfoBubble: false, fileAssociations: true, focusOnFileLaunch: true });
  });
});
