import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ODA_SETTINGS,
  ODA_ARROW_REPEAT_INTERVAL_MAX_MS,
  ODA_ARROW_REPEAT_INTERVAL_MIN_MS,
  ODA_BACKGROUND_OPACITY_MAX_PERCENT,
  ODA_BACKGROUND_OPACITY_MIN_PERCENT,
  ODA_HOLD_BACK_THRESHOLD_MAX_MS,
  ODA_HOLD_BACK_THRESHOLD_MIN_MS,
  ODA_OVERSCAN_MAX_PERCENT,
  ODA_OVERSCAN_MIN_PERCENT,
  ODA_SCREENSAVER_DELAY_MAX_MINUTES,
  ODA_SCREENSAVER_DELAY_MIN_MINUTES,
  ODA_SCREENSAVER_MOVE_MAX_MINUTES,
  ODA_SCREENSAVER_MOVE_MIN_MINUTES,
  normalizeOdaSettings
} from './oda-settings';

describe('normalizeOdaSettings', () => {
  it('accepts supported Oda settings', () => {
    expect(normalizeOdaSettings({
      odaLayout: 'waterfall',
      odaEnterFullscreen: false,
      odaWrapNavigation: true,
      odaBrowserLayouts: { music: 'list', video: 'gallery', image: 'grid' },
      odaBrowserZoomLevels: {
        music: { list: 0, grid: 1, gallery: 2 },
        video: { list: 1, grid: 2, gallery: 3 },
        image: { list: 2, grid: 3, gallery: 4 }
      },
      odaOverscanPercent: 4.5,
      odaArrowRepeatInitialDelayMs: 600,
      odaArrowRepeatIntervalMs: 90,
      odaHoldBackAction: 'return-home',
      odaHoldBackThresholdMs: 1_200,
      odaBackground: 'custom',
      odaBackgroundImage: 'data:image/jpeg;base64,/9j/',
      odaBackgroundOpacity: 65,
      odaUseHostBackground: false,
      odaScreensaverDelayMinutes: 15,
      odaScreensaverMoveIntervalMinutes: 30
    })).toEqual({
      odaLayout: 'waterfall',
      odaEnterFullscreen: false,
      odaWrapNavigation: true,
      odaBrowserLayouts: { music: 'list', video: 'gallery', image: 'grid' },
      odaBrowserZoomLevels: {
        music: { list: 0, grid: 1, gallery: 2 },
        video: { list: 1, grid: 2, gallery: 3 },
        image: { list: 2, grid: 3, gallery: 4 }
      },
      odaOverscanPercent: 4.5,
      odaArrowRepeatInitialDelayMs: 600,
      odaArrowRepeatIntervalMs: 90,
      odaHoldBackAction: 'return-home',
      odaHoldBackThresholdMs: 1_200,
      odaBackground: 'custom',
      odaBackgroundImage: 'data:image/jpeg;base64,/9j/',
      odaBackgroundOpacity: 65,
      odaUseHostBackground: false,
      odaScreensaverDelayMinutes: 15,
      odaScreensaverMoveIntervalMinutes: 30
    });
  });

  it('falls back to defaults for unsupported values', () => {
    expect(normalizeOdaSettings({
      odaLayout: 'grid',
      odaEnterFullscreen: 'yes',
      odaWrapNavigation: 1,
      odaOverscanPercent: 'wide',
      odaArrowRepeatInitialDelayMs: null,
      odaArrowRepeatIntervalMs: Number.NaN,
      odaHoldBackAction: 'exit',
      odaHoldBackThresholdMs: 'soon',
      odaBackground: 'artwork',
      odaBackgroundImage: 'blob:https://example/1',
      odaBackgroundOpacity: 'opaque'
    })).toEqual(DEFAULT_ODA_SETTINGS);
  });

  it('clamps numeric bounds into range', () => {
    expect(normalizeOdaSettings({ odaOverscanPercent: -5 }).odaOverscanPercent).toBe(ODA_OVERSCAN_MIN_PERCENT);
    expect(normalizeOdaSettings({ odaOverscanPercent: 99 }).odaOverscanPercent).toBe(ODA_OVERSCAN_MAX_PERCENT);
    expect(normalizeOdaSettings({ odaArrowRepeatIntervalMs: 1 }).odaArrowRepeatIntervalMs)
      .toBe(ODA_ARROW_REPEAT_INTERVAL_MIN_MS);
    expect(normalizeOdaSettings({ odaArrowRepeatIntervalMs: 5_000 }).odaArrowRepeatIntervalMs)
      .toBe(ODA_ARROW_REPEAT_INTERVAL_MAX_MS);
    expect(normalizeOdaSettings({ odaHoldBackThresholdMs: 1 }).odaHoldBackThresholdMs)
      .toBe(ODA_HOLD_BACK_THRESHOLD_MIN_MS);
    expect(normalizeOdaSettings({ odaHoldBackThresholdMs: 5_000 }).odaHoldBackThresholdMs)
      .toBe(ODA_HOLD_BACK_THRESHOLD_MAX_MS);
    expect(normalizeOdaSettings({ odaBackgroundOpacity: -10 }).odaBackgroundOpacity)
      .toBe(ODA_BACKGROUND_OPACITY_MIN_PERCENT);
    expect(normalizeOdaSettings({ odaBackgroundOpacity: 250 }).odaBackgroundOpacity)
      .toBe(ODA_BACKGROUND_OPACITY_MAX_PERCENT);
    expect(normalizeOdaSettings({ odaScreensaverDelayMinutes: -1 }).odaScreensaverDelayMinutes)
      .toBe(ODA_SCREENSAVER_DELAY_MIN_MINUTES);
    expect(normalizeOdaSettings({ odaScreensaverDelayMinutes: 90 }).odaScreensaverDelayMinutes)
      .toBe(ODA_SCREENSAVER_DELAY_MAX_MINUTES);
    expect(normalizeOdaSettings({ odaScreensaverMoveIntervalMinutes: -1 }).odaScreensaverMoveIntervalMinutes)
      .toBe(ODA_SCREENSAVER_MOVE_MIN_MINUTES);
    expect(normalizeOdaSettings({ odaScreensaverMoveIntervalMinutes: 90 }).odaScreensaverMoveIntervalMinutes)
      .toBe(ODA_SCREENSAVER_MOVE_MAX_MINUTES);
    expect(normalizeOdaSettings({
      odaBrowserZoomLevels: {
        music: { list: -5, grid: 99, gallery: 2 }
      }
    }).odaBrowserZoomLevels.music).toEqual({ list: 0, grid: 4, gallery: 2 });
  });

  it('allows Gallery only for visual-media browsers', () => {
    const normalized = normalizeOdaSettings({
      odaBrowserLayouts: { music: 'gallery', video: 'gallery', image: 'gallery' }
    });
    expect(normalized.odaBrowserLayouts).toEqual({
      music: 'grid',
      video: 'gallery',
      image: 'gallery'
    });
  });

  it('rounds overscan and durations to stable precision', () => {
    expect(normalizeOdaSettings({ odaOverscanPercent: 1.234 }).odaOverscanPercent).toBe(1.2);
    expect(normalizeOdaSettings({ odaArrowRepeatInitialDelayMs: 450.7 }).odaArrowRepeatInitialDelayMs).toBe(451);
  });
});
