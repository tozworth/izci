import { describe, expect, it } from 'vitest';
import {
  compactClusterRanges,
  createRangeMembership,
  indexForTime,
  planRenderClusters
} from './multiplayer-render-scheduler';

const TIMELINE = [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000];

describe('indexForTime', () => {
  it('finds the cluster containing a time', () => {
    expect(indexForTime(TIMELINE, 0)).toBe(0);
    expect(indexForTime(TIMELINE, 999)).toBe(0);
    expect(indexForTime(TIMELINE, 1000)).toBe(1);
    expect(indexForTime(TIMELINE, 999_999)).toBe(TIMELINE.length - 1);
  });
});

describe('planRenderClusters', () => {
  it('prioritizes the seek target window before the playhead', () => {
    // Seek to cluster 5 (5000 ms); playhead is stale at 0.
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 5000,
      aheadMs: 3000,
      playheadTimeMs: 0,
      protectionMs: 1000,
      receivedRanges: [],
      sent: new Set()
    });
    expect(planned[0]).toBe(5);
    expect(planned).toContain(6);
    expect(planned).toContain(7);
    // Download-ahead fills the rest; holes (0..4) come last.
    expect(planned.indexOf(0)).toBeGreaterThan(planned.indexOf(5));
  });

  it('skips clusters the client already holds', () => {
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 0,
      aheadMs: 2000,
      playheadTimeMs: 0,
      protectionMs: 1000,
      receivedRanges: [[0, 1]],
      sent: new Set()
    });
    expect(planned).not.toContain(0);
    expect(planned).not.toContain(1);
    expect(planned[0]).toBe(2);
  });

  it('skips clusters already enqueued for the peer', () => {
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 0,
      aheadMs: 1000,
      playheadTimeMs: 0,
      protectionMs: 1000,
      receivedRanges: [],
      sent: new Set([0])
    });
    expect(planned).not.toContain(0);
    expect(planned[0]).toBe(1);
  });

  it('respects the budget', () => {
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 0,
      aheadMs: 1000,
      playheadTimeMs: 0,
      protectionMs: 1000,
      receivedRanges: [],
      sent: new Set(),
      budget: 3
    });
    expect(planned).toHaveLength(3);
  });

  it('returns nothing when everything is held', () => {
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 0,
      aheadMs: 1000,
      playheadTimeMs: 0,
      protectionMs: 1000,
      receivedRanges: [[0, TIMELINE.length - 1]],
      sent: new Set()
    });
    expect(planned).toEqual([]);
  });

  it('plans holes after forward download-ahead', () => {
    const planned = planRenderClusters({
      clusterTimeMs: TIMELINE,
      targetTimeMs: 4000,
      aheadMs: 1000,
      playheadTimeMs: 4000,
      protectionMs: 1000,
      receivedRanges: [[5, 7]],
      sent: new Set()
    });
    // Forward (4, then 5-7 already held, so 8 doesn't exist) — end of track.
    expect(planned[0]).toBe(4);
    // Earlier hole (0) comes after all forward clusters.
    expect(planned.indexOf(0)).toBeGreaterThan(planned.indexOf(4));
  });
});

describe('compactClusterRanges', () => {
  it('compacts sorted and unsorted input', () => {
    expect(compactClusterRanges([5, 0, 1, 2, 5, 7])).toEqual([[0, 2], [5, 5], [7, 7]]);
    expect(compactClusterRanges([])).toEqual([]);
  });
});

describe('createRangeMembership', () => {
  it('answers membership across disjoint ranges', () => {
    const has = createRangeMembership([[0, 2], [5, 7]]);
    expect(has(0)).toBe(true);
    expect(has(2)).toBe(true);
    expect(has(3)).toBe(false);
    expect(has(5)).toBe(true);
    expect(has(8)).toBe(false);
  });
});
