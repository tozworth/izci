import { describe, expect, it } from 'vitest';

import { resolveSleepRemainingSeconds } from './sleep-timer';

describe('sleep timer remaining time', () => {
  it('rounds the remaining time up to whole seconds', () => {
    expect(resolveSleepRemainingSeconds(1_000, 0)).toBe(1);
    expect(resolveSleepRemainingSeconds(999, 0)).toBe(1);
    expect(resolveSleepRemainingSeconds(1, 0)).toBe(1);
  });

  it('reports zero once the end time has passed', () => {
    expect(resolveSleepRemainingSeconds(0, 0)).toBe(0);
    expect(resolveSleepRemainingSeconds(-1, 0)).toBe(0);
    expect(resolveSleepRemainingSeconds(0, 10_000)).toBe(0);
  });
});
