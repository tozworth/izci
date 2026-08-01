import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TROUBADOUR_WORKSPACE_STATE,
  TROUBADOUR_TABS,
  normalizeTroubadourWorkspaceState
} from './troubadour-workspace';

describe('Troubadour workspace normalization', () => {
  it('returns independent default arrays for missing state', () => {
    const state = normalizeTroubadourWorkspaceState(undefined);

    expect(state).toEqual(DEFAULT_TROUBADOUR_WORKSPACE_STATE);
    expect(state.zones['middle-bottom']).not.toBe(DEFAULT_TROUBADOUR_WORKSPACE_STATE.zones['middle-bottom']);
    expect(state.layout).not.toBe(DEFAULT_TROUBADOUR_WORKSPACE_STATE.layout);
    expect(state.layout.rows).not.toBe(DEFAULT_TROUBADOUR_WORKSPACE_STATE.layout.rows);
  });

  it('keeps each supported tab exactly once and restores missing tabs', () => {
    const state = normalizeTroubadourWorkspaceState({
      zones: {
        'top-left': ['lyrics', 'lyrics', 'unknown'],
        'right-bottom': ['files']
      },
      activeTabsByZone: {
        'top-left': 'metadata',
        'right-bottom': 'files'
      }
    });
    const assigned = Object.values(state.zones).flat();

    expect(assigned).toHaveLength(TROUBADOUR_TABS.length);
    expect(new Set(assigned)).toEqual(new Set(TROUBADOUR_TABS));
    expect(state.activeTabsByZone['top-left']).toBe('lyrics');
    expect(state.activeTabsByZone['right-bottom']).toBe('files');
  });

  it('restores missing layout axes and clamps split positions', () => {
    const state = normalizeTroubadourWorkspaceState({
      layout: {
        rows: { top: 0.35 },
        columns: { left: Number.NaN, right: 0.4 },
        splits: { middle: 2, bottom: 0.02 }
      }
    });

    expect(state.layout.rows.top).toBe(0.35);
    expect(state.layout.rows.middle).toBe(DEFAULT_TROUBADOUR_WORKSPACE_STATE.layout.rows.middle);
    expect(state.layout.columns.left).toBe(DEFAULT_TROUBADOUR_WORKSPACE_STATE.layout.columns.left);
    expect(state.layout.columns.right).toBe(0.4);
    expect(state.layout.splits.middle).toBe(0.88);
    expect(state.layout.splits.bottom).toBe(0.12);
  });
});
