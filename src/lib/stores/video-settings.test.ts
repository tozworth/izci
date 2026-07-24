import { describe, expect, it } from 'vitest';
import { DEFAULT_VIDEO_SETTINGS, normalizeVideoSettings } from './video-settings';

describe('normalizeVideoSettings', () => {
  it('accepts supported video settings', () => {
    expect(normalizeVideoSettings({
      autoResizeWindow: true,
      autoEnterTheater: true,
      fitMode: 'cover'
    })).toEqual({
      autoResizeWindow: true,
      autoEnterTheater: true,
      fitMode: 'cover'
    });
  });

  it('falls back to defaults for unsupported values', () => {
    expect(normalizeVideoSettings({
      autoResizeWindow: 'yes',
      autoEnterTheater: 'yes',
      fitMode: 'stretch'
    })).toEqual(DEFAULT_VIDEO_SETTINGS);
  });
});
