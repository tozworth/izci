import { describe, expect, it } from 'vitest';
import {
  findDockTabZone,
  moveDockTab,
  normalizeVisibleDockWeights,
  resizeDockPairWeights,
  resolveDockSplitWeights,
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

  it('keeps one membership per tab across repeated cross-zone moves', () => {
    const initial = { left: ['files'], middle: ['albums'], right: ['metadata'] } satisfies Record<Zone, Tab[]>;
    const afterFirstMove = moveDockTab<Tab, Zone>(initial, ZONES, {
      tabId: 'files',
      sourceZoneId: 'left',
      targetZoneId: 'middle',
      position: 'end'
    });
    const afterSecondMove = moveDockTab<Tab, Zone>(afterFirstMove, ZONES, {
      tabId: 'files',
      sourceZoneId: 'middle',
      targetZoneId: 'right',
      position: 'end'
    });

    expect(Object.values(afterSecondMove).flat()).toEqual(['albums', 'metadata', 'files']);
    expect(Object.values(afterSecondMove).flat().filter((tab) => tab === 'files')).toHaveLength(1);
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

  it('removes hidden tracks and lets the remaining tracks fill the layout', () => {
    expect(normalizeVisibleDockWeights<'top' | 'middle' | 'bottom'>(
      { top: 0.2, middle: 0.6, bottom: 0.2 },
      ['middle']
    )).toEqual({ top: 0, middle: 1, bottom: 0 });
    expect(normalizeVisibleDockWeights<'left' | 'middle' | 'right'>(
      { left: 0.28, middle: 0.46, right: 0.26 },
      ['left', 'right']
    )).toEqual({ left: 0.28 / 0.54, middle: 0, right: 0.26 / 0.54 });
  });

  it('expands a lone inner zone instead of preserving an empty half', () => {
    expect(resolveDockSplitWeights(true, false, 0.3)).toEqual({ first: 1, second: 0 });
    expect(resolveDockSplitWeights(false, true, 0.3)).toEqual({ first: 0, second: 1 });
    expect(resolveDockSplitWeights(true, true, 0.3)).toEqual({ first: 0.3, second: 0.7 });
  });
});
