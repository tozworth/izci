import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_SETTINGS, normalizeVideoSettings } from './video-settings';

describe('normalizeVideoSettings', () => {
  it('accepts supported video settings', () => {
    expect(normalizeVideoSettings({ autoResizeWindow: true, autoEnterTheater: true })).toEqual({
      autoResizeWindow: true,
      autoEnterTheater: true
    });
  });

  it('falls back to defaults for unsupported values', () => {
    expect(normalizeVideoSettings({ autoResizeWindow: 'yes', autoEnterTheater: 'yes' })).toEqual(
      DEFAULT_VIDEO_SETTINGS
    );
  });
});
