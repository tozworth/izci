import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_SETTINGS, normalizeVideoSettings } from './video-settings';

describe('normalizeVideoSettings', () => {
  it('accepts supported video settings', () => {
    expect(normalizeVideoSettings({ autoResizeWindow: true, viewportArea: 'all' })).toEqual({
      autoResizeWindow: true,
      viewportArea: 'all'
    });
  });

  it('falls back to defaults for unsupported values', () => {
    expect(normalizeVideoSettings({ autoResizeWindow: 'yes', viewportArea: 'left' })).toEqual(
      DEFAULT_VIDEO_SETTINGS
    );
  });
});
