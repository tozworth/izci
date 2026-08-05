import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX,
  MAX_SEEK_WHEEL_STEP_SECONDS,
  MIN_SEEK_WHEEL_STEP_SECONDS,
  normalizeFadeDurationSeconds,
  normalizeManualTrackChangeFadePercent,
  normalizePlaybackRate,
  normalizePlaybackSettings,
  normalizePlaybackRestoreMode,
  normalizePlaybackTransitionMode,
  normalizeRememberProgressDurationIndex,
  normalizeSeekWheelStepSeconds
} from './playback-settings';

describe('playback settings helpers', () => {
  it('accepts each playback restoration mode', () => {
    expect(normalizePlaybackRestoreMode('disabled')).toBe('disabled');
    expect(normalizePlaybackRestoreMode('position')).toBe('position');
    expect(normalizePlaybackRestoreMode('position-and-state')).toBe('position-and-state');
  });

  it('falls back to disabled for invalid restoration modes', () => {
    expect(normalizePlaybackRestoreMode('playing')).toBe('disabled');
    expect(normalizePlaybackRestoreMode(null)).toBe('disabled');
  });

  it('normalizes remembered-progress duration slider indices', () => {
    expect(normalizeRememberProgressDurationIndex(0)).toBe(0);
    expect(normalizeRememberProgressDurationIndex(4.4)).toBe(4);
    expect(normalizeRememberProgressDurationIndex(99)).toBe(8);
    expect(normalizeRememberProgressDurationIndex(-3)).toBe(0);
    expect(normalizeRememberProgressDurationIndex('4')).toBe(
      DEFAULT_REMEMBER_PROGRESS_DURATION_INDEX
    );
  });

  it('normalizes playback rates to the supported slider range and step', () => {
    expect(normalizePlaybackRate(1)).toBe(1);
    expect(normalizePlaybackRate(1.234)).toBe(1.25);
    expect(normalizePlaybackRate(0.1)).toBe(0.5);
    expect(normalizePlaybackRate(4)).toBe(2);
    expect(normalizePlaybackRate('1.5')).toBe(1);
  });

  it('defaults the Previous restart behavior on and preserves an explicit opt-out', () => {
    expect(normalizePlaybackSettings({}).restartCurrentTrackOnPrevious).toBe(true);
    expect(normalizePlaybackSettings({ restartCurrentTrackOnPrevious: false }).restartCurrentTrackOnPrevious).toBe(false);
  });

  it('normalizes transition modes and fade duration', () => {
    expect(normalizePlaybackTransitionMode('crossfade')).toBe('crossfade');
    expect(normalizePlaybackTransitionMode('invalid')).toBe('none');
    expect(normalizeFadeDurationSeconds(4.74)).toBe(4.5);
    expect(normalizeFadeDurationSeconds(0)).toBe(0.5);
    expect(normalizeFadeDurationSeconds(60)).toBe(30);
  });

  it('normalizes the manual track-change fade percentage to the slider range and step', () => {
    expect(normalizeManualTrackChangeFadePercent(47)).toBe(45);
    expect(normalizeManualTrackChangeFadePercent(-1)).toBe(0);
    expect(normalizeManualTrackChangeFadePercent(101)).toBe(100);
    expect(normalizeManualTrackChangeFadePercent('50')).toBe(0);
  });

  it('turns a persisted crossfade into fade out when gapless playback is disabled', () => {
    expect(normalizePlaybackSettings({
      transitionMode: 'crossfade',
      gaplessPlayback: false
    }).transitionMode).toBe('fadeout');
  });

  it('normalizes the wheel seek step to the supported range and step', () => {
    expect(normalizeSeekWheelStepSeconds(7)).toBe(7);
    expect(normalizeSeekWheelStepSeconds(3.6)).toBe(4);
    expect(normalizeSeekWheelStepSeconds(0)).toBe(MIN_SEEK_WHEEL_STEP_SECONDS);
    expect(normalizeSeekWheelStepSeconds(999)).toBe(MAX_SEEK_WHEEL_STEP_SECONDS);
    expect(normalizeSeekWheelStepSeconds('5')).toBe(5);
  });

  it('defaults to total-duration display and the standard wheel step', () => {
    const settings = normalizePlaybackSettings({});
    expect(settings.showTimeRemaining).toBe(false);
    expect(settings.seekWheelStepSeconds).toBe(5);
    expect(normalizePlaybackSettings({ showTimeRemaining: true }).showTimeRemaining).toBe(true);
    expect(normalizePlaybackSettings({ seekWheelStepSeconds: 9 }).seekWheelStepSeconds).toBe(9);
  });
});
