import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ODA_SETTINGS,
  ODA_ARROW_REPEAT_INTERVAL_MAX_MS,
  ODA_ARROW_REPEAT_INTERVAL_MIN_MS,
  ODA_HOLD_BACK_THRESHOLD_MAX_MS,
  ODA_HOLD_BACK_THRESHOLD_MIN_MS,
  ODA_OVERSCAN_MAX_PERCENT,
  ODA_OVERSCAN_MIN_PERCENT,
  normalizeOdaSettings
} from './oda-settings';

describe('normalizeOdaSettings', () => {
  it('accepts supported Oda settings', () => {
    expect(normalizeOdaSettings({
      odaLayout: 'waterfall',
      odaEnterFullscreen: false,
      odaWrapNavigation: true,
      odaOverscanPercent: 4.5,
      odaArrowRepeatInitialDelayMs: 600,
      odaArrowRepeatIntervalMs: 90,
      odaHoldBackAction: 'return-home',
      odaHoldBackThresholdMs: 1_200
    })).toEqual({
      odaLayout: 'waterfall',
      odaEnterFullscreen: false,
      odaWrapNavigation: true,
      odaOverscanPercent: 4.5,
      odaArrowRepeatInitialDelayMs: 600,
      odaArrowRepeatIntervalMs: 90,
      odaHoldBackAction: 'return-home',
      odaHoldBackThresholdMs: 1_200
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
      odaHoldBackThresholdMs: 'soon'
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
  });

  it('rounds overscan and durations to stable precision', () => {
    expect(normalizeOdaSettings({ odaOverscanPercent: 1.234 }).odaOverscanPercent).toBe(1.2);
    expect(normalizeOdaSettings({ odaArrowRepeatInitialDelayMs: 450.7 }).odaArrowRepeatInitialDelayMs).toBe(451);
  });
});
