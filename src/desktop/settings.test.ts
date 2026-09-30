import { afterEach, describe, expect, it } from 'vitest';
import { desktopSettings, resetDesktopAppearance, resetDesktopTracks } from './settings';

describe('desktop settings page resets', () => {
  afterEach(() => desktopSettings.reset());

  it('preserves file registration when Appearance is reset', () => {
    desktopSettings.set({ trayIcon: true, fileAssociations: false });
    resetDesktopAppearance();
    expect(desktopSettings.getSnapshot()).toEqual({ trayIcon: false, fileAssociations: false });
  });

  it('preserves the tray icon when Tracks is reset', () => {
    desktopSettings.set({ trayIcon: true, fileAssociations: false });
    resetDesktopTracks();
    expect(desktopSettings.getSnapshot()).toEqual({ trayIcon: true, fileAssociations: true });
  });
});
