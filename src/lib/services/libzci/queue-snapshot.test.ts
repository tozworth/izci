import { describe, expect, it } from 'vitest';
import {
  isQueueSnapshotStale,
  toQueueSnapshotView,
  type CoreProfileQueueState
} from './queue-snapshot';

const state: CoreProfileQueueState = {
  revision: 7,
  sources: [
    { key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' },
    { key: 'b', kind: 'ephemeral', locator: 'blob:b', display_path: 'plain-file.ogg' }
  ],
  queue: {
    items: [
      { id: 1, source_key: 'a', subsong: null },
      { id: 2, source_key: 'b', subsong: 3 },
      { id: 3, source_key: 'gone', subsong: null }
    ],
    current: 2,
    up_next: [3]
  },
  position_seconds: 12.5
};

describe('core queue snapshot probe', () => {
  it('joins occurrences with source references', () => {
    const view = toQueueSnapshotView(state);
    expect(view.revision).toBe(7);
    expect(view.rows).toEqual([
      { occurrenceId: 1, title: '/music/one.mp3', restorable: true, subsong: null, isCurrent: false },
      { occurrenceId: 2, title: 'plain-file.ogg', restorable: false, subsong: 3, isCurrent: true },
      // Unknown sources stay visible under their key instead of dropping.
      { occurrenceId: 3, title: 'gone', restorable: false, subsong: null, isCurrent: false }
    ]);
    expect(view.currentId).toBe(2);
    expect(view.upNext).toEqual([3]);
    expect(view.positionSeconds).toBe(12.5);
  });

  it('guards re-renders on the core revision', () => {
    expect(isQueueSnapshotStale(null, state)).toBe(true);
    expect(isQueueSnapshotStale(7, state)).toBe(false);
    expect(isQueueSnapshotStale(6, { ...state, revision: 8 })).toBe(true);
  });
});
