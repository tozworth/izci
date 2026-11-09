import { describe, expect, it } from 'vitest';
import {
  hasPendingPlayCounts,
  hasSkippedPlayCounts,
  validatePlayCountSnapshot,
  type CorePlayCountSnapshot
} from './play-counts';

const snapshot: CorePlayCountSnapshot = {
  settings: { enabled: true, threshold_seconds: 15 },
  credited_seconds: 12.5,
  pending: 1,
  overflowed: 0
};

describe('core play-count observation', () => {
  it('validates snapshots and flags pending/skipped work', () => {
    expect(() => validatePlayCountSnapshot(snapshot)).not.toThrow();
    expect(hasPendingPlayCounts(snapshot)).toBe(true);
    expect(hasSkippedPlayCounts(snapshot)).toBe(false);
    expect(hasSkippedPlayCounts({ ...snapshot, pending: 0, overflowed: 2 })).toBe(true);
    expect(() => validatePlayCountSnapshot({ ...snapshot, pending: 65 })).toThrow();
    expect(() => validatePlayCountSnapshot({ ...snapshot, credited_seconds: Number.NaN })).toThrow();
    expect(() =>
      validatePlayCountSnapshot({ ...snapshot, settings: { enabled: true, threshold_seconds: 0 } })
    ).toThrow();
  });
});
