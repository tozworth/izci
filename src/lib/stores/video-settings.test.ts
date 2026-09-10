import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIDEO_SETTINGS,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  normalizeImageZoom,
  normalizeVideoSettings,
  stepImageZoom
} from './video-settings';

describe('normalizeVideoSettings', () => {
  it('accepts supported video settings', () => {
    expect(normalizeVideoSettings({
      autoResizeWindow: true,
      autoEnterTheater: true,
      fitMode: 'cover',
      imageZoom: 2.5
    })).toEqual({
      autoResizeWindow: true,
      autoEnterTheater: true,
      fitMode: 'cover',
      imageZoom: 2.5
    });
  });

  it('falls back to defaults for unsupported values', () => {
    expect(normalizeVideoSettings({
      autoResizeWindow: 'yes',
      autoEnterTheater: 'yes',
      fitMode: 'stretch',
      imageZoom: 'far'
    })).toEqual(DEFAULT_VIDEO_SETTINGS);
  });

  it('clamps image zoom into range', () => {
    expect(normalizeVideoSettings({ imageZoom: 0.25 }).imageZoom).toBe(IMAGE_ZOOM_MIN);
    expect(normalizeVideoSettings({ imageZoom: 42 }).imageZoom).toBe(IMAGE_ZOOM_MAX);
  });
});

describe('stepImageZoom', () => {
  it('scales the current zoom and clamps into range', () => {
    expect(stepImageZoom(1, 1.25)).toBe(1.25);
    expect(stepImageZoom(1.25, 1 / 1.25)).toBe(1);
    expect(stepImageZoom(IMAGE_ZOOM_MAX, 2)).toBe(IMAGE_ZOOM_MAX);
    expect(stepImageZoom(IMAGE_ZOOM_MIN, 0.5)).toBe(IMAGE_ZOOM_MIN);
  });

  it('ignores non-positive factors', () => {
    expect(stepImageZoom(2, 0)).toBe(2);
    expect(stepImageZoom(2, Number.NaN)).toBe(2);
  });
});

describe('normalizeImageZoom', () => {
  it('rounds to avoid float drift', () => {
    expect(normalizeImageZoom(1.1500000000000001)).toBe(1.15);
  });
});
