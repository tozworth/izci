import { describe, expect, it } from 'vitest';
import {
  findDockTabZone,
  moveDockTab,
  resizeDockPairWeights,
  resolveDockSplit
} from './dock-layout';

type Zone = 'left' | 'middle' | 'right';
type Tab = 'files' | 'albums' | 'metadata';

const ZONES: Zone[] = ['left', 'middle', 'right'];

describe('dock layout', () => {
  it('finds the owning zone', () => {
    expect(findDockTabZone<Tab, Zone>({ left: ['files'], middle: ['albums'], right: ['metadata'] }, ZONES, 'albums')).toBe('middle');
  });

  it('moves tabs between zones at an insertion target', () => {
    const next = moveDockTab<Tab, Zone>(
      { left: ['files'], middle: ['albums', 'metadata'], right: [] },
      ZONES,
      { tabId: 'files', sourceZoneId: 'left', targetZoneId: 'middle', targetTabId: 'metadata', position: 'before' }
    );

    expect(next).toEqual({ left: [], middle: ['albums', 'files', 'metadata'], right: [] });
  });

  it('reorders within a zone without duplicating a tab', () => {
    const next = moveDockTab<Tab, Zone>(
      { left: ['files', 'albums', 'metadata'], middle: [], right: [] },
      ZONES,
      { tabId: 'metadata', sourceZoneId: 'left', targetZoneId: 'left', targetTabId: 'files', position: 'before' }
    );

    expect(next.left).toEqual(['metadata', 'files', 'albums']);
  });

  it('resizes adjacent weighted tracks while preserving their combined weight', () => {
    const next = resizeDockPairWeights({
      beforeSize: 300,
      afterSize: 500,
      beforeWeight: 0.3,
      afterWeight: 0.5,
      delta: 100,
      minimumSize: 140
    });

    expect(next).toEqual({ beforeWeight: 0.4, afterWeight: 0.4 });
  });

  it('clamps weighted tracks and inner splits to their minimum panel size', () => {
    const resized = resizeDockPairWeights({
      beforeSize: 300,
      afterSize: 500,
      beforeWeight: 0.3,
      afterWeight: 0.5,
      delta: -1000,
      minimumSize: 140
    });

    expect(resized.beforeWeight).toBeCloseTo(0.14);
    expect(resized.afterWeight).toBeCloseTo(0.66);
    expect(resolveDockSplit(20, 1000, 120)).toBe(0.12);
    expect(resolveDockSplit(980, 1000, 120)).toBe(0.88);
  });
});
