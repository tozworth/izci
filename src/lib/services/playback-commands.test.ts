import { describe, expect, it } from 'vitest';

import {
  PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS,
  isAutomaticFadeWindow,
  resolveManualTransitionDurationSeconds,
  resolveEffectiveTransitionMode,
  shouldRestartForPrevious,
  shouldSkipAutomaticCrossfade
} from './playback-commands';

describe('previous-track restart behavior', () => {
  it('restarts Previous at the threshold when the setting and a current track are present', () => {
    expect(shouldRestartForPrevious(
      -1,
      true,
      true,
      PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS
    )).toBe(true);
  });

  it('navigates before the threshold or when the setting is disabled', () => {
    expect(shouldRestartForPrevious(-1, true, true, 2.99)).toBe(false);
    expect(shouldRestartForPrevious(-1, false, true, 30)).toBe(false);
  });

  it('never intercepts Next or a missing current track', () => {
    expect(shouldRestartForPrevious(1, true, true, 30)).toBe(false);
    expect(shouldRestartForPrevious(-1, true, false, 30)).toBe(false);
  });
});

describe('track transition behavior', () => {
  it('falls back to fade out when crossfade is selected without gapless playback', () => {
    expect(resolveEffectiveTransitionMode('crossfade', false)).toBe('fadeout');
    expect(resolveEffectiveTransitionMode('crossfade', true)).toBe('crossfade');
    expect(resolveEffectiveTransitionMode('none', false)).toBe('none');
  });

  it('opens the fade window at the configured distance from the end', () => {
    expect(isAutomaticFadeWindow(54.99, 60, 5)).toBe(false);
    expect(isAutomaticFadeWindow(55, 60, 5)).toBe(true);
    expect(isAutomaticFadeWindow(2, 3, 10)).toBe(true);
    expect(isAutomaticFadeWindow(0, 0, 5)).toBe(false);
  });

  it('scales manual transitions from off through the full standard duration', () => {
    expect(resolveManualTransitionDurationSeconds(8, 0)).toBe(0);
    expect(resolveManualTransitionDurationSeconds(8, 25)).toBe(2);
    expect(resolveManualTransitionDurationSeconds(8, 100)).toBe(8);
    expect(resolveManualTransitionDurationSeconds(8, 150)).toBe(8);
  });
});

describe('automatic crossfade skip behavior', () => {
  it('skips when the current track is shorter than twice the fade', () => {
    // 3s track, 5s configured fade: the fade window covers the whole track.
    expect(shouldSkipAutomaticCrossfade(3, 180, 5)).toBe(true);
    // Fade clamps to the track duration, so even a short configured fade is unsafe.
    expect(shouldSkipAutomaticCrossfade(3, 180, 2)).toBe(true);
    expect(shouldSkipAutomaticCrossfade(9, 180, 5)).toBe(true);
  });

  it('skips when the prepared next track is too short for its own tail fade', () => {
    // Long current track but the incoming one can't reach its own fade window
    // before the previous crossfade completes.
    expect(shouldSkipAutomaticCrossfade(180, 3, 5)).toBe(true);
    expect(shouldSkipAutomaticCrossfade(180, 9, 5)).toBe(true);
  });

  it('keeps crossfading when both sides have room', () => {
    expect(shouldSkipAutomaticCrossfade(180, 180, 5)).toBe(false);
    expect(shouldSkipAutomaticCrossfade(60, 30, 5)).toBe(false);
    expect(shouldSkipAutomaticCrossfade(30, 60, 5)).toBe(false);
  });

  it('keeps crossfading when the next duration is unknown', () => {
    expect(shouldSkipAutomaticCrossfade(180, undefined, 5)).toBe(false);
  });
});
