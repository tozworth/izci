import { afterEach, describe, expect, it } from 'vitest';
import { desktopSettings, resetDesktopAppearance, resetDesktopTracks } from './settings';

describe('desktop settings page resets', () => {
  afterEach(() => desktopSettings.reset());

  it('preserves file registration when Appearance is reset', () => {
    desktopSettings.set({ showIn: 'both', trayIcon: 'dark', trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: false });
    resetDesktopAppearance();
    expect(desktopSettings.getSnapshot()).toEqual({ showIn: 'taskbar', trayIcon: 'light', trackInfoBubble: true, fileAssociations: false, focusOnFileLaunch: false });
  });

  it('preserves desktop visibility when Tracks is reset', () => {
    desktopSettings.set({ showIn: 'both', trayIcon: 'dark', trackInfoBubble: false, fileAssociations: false, focusOnFileLaunch: false });
    resetDesktopTracks();
    expect(desktopSettings.getSnapshot()).toEqual({ showIn: 'both', trayIcon: 'dark', trackInfoBubble: false, fileAssociations: true, focusOnFileLaunch: true });
  });
});
