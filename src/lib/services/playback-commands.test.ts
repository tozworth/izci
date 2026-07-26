import { describe, expect, it } from 'vitest';

import {
  PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS,
  shouldRestartForPrevious
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
