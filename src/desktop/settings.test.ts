import { afterEach, describe, expect, it } from 'vitest';
import { desktopSettings, resetDesktopAppearance, resetDesktopTracks } from './settings';

describe('desktop settings page resets', () => {
  afterEach(() => desktopSettings.reset());

  it('preserves file registration when Appearance is reset', () => {
    desktopSettings.set({ showIn: 'both', fileAssociations: false });
    resetDesktopAppearance();
    expect(desktopSettings.getSnapshot()).toEqual({ showIn: 'taskbar', fileAssociations: false });
  });

  it('preserves desktop visibility when Tracks is reset', () => {
    desktopSettings.set({ showIn: 'both', fileAssociations: false });
    resetDesktopTracks();
    expect(desktopSettings.getSnapshot()).toEqual({ showIn: 'both', fileAssociations: true });
  });
});
