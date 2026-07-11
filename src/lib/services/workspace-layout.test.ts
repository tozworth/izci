import { describe, expect, it } from 'vitest';

import {
  getWideContentWidth,
  resolveResizedPanelLayout,
  resolveWidePanelWidths
} from './workspace-layout';
import type { WorkspacePanelLayoutSettings } from '$lib/types';

const balancedLayout: WorkspacePanelLayoutSettings = {
  leftFraction: 0.3,
  centerFraction: 0.45,
  rightFraction: 0.25
};

function totalWidth(widths: Record<'left' | 'center' | 'right', number>): number {
  return widths.left + widths.center + widths.right;
}

describe('workspace layout', () => {
  it('subtracts padding and only visible resizers from the wide content width', () => {
    expect(getWideContentWidth(1200)).toBe(1198);
    expect(getWideContentWidth(1200, { detailsVisible: false })).toBe(1199);
    expect(getWideContentWidth(1200, { visiblePanels: ['right'] })).toBe(1200);
    expect(getWideContentWidth(1200, { visiblePanels: [] })).toBe(1200);
  });

  it('resolves wide panel widths while preserving total content width', () => {
    const widths = resolveWidePanelWidths(balancedLayout, 1000);

    expect(widths.left).toBeGreaterThanOrEqual(210);
    expect(widths.center).toBeGreaterThanOrEqual(320);
    expect(widths.right).toBeGreaterThanOrEqual(200);
    expect(totalWidth(widths)).toBeCloseTo(1000);
  });

  it('keeps hidden details out of the visible width without mutating the stored proportions', () => {
    const widths = resolveWidePanelWidths(balancedLayout, 1000, { detailsVisible: false });

    expect(widths.right).toBe(0);
    expect(widths.left + widths.center).toBeCloseTo(1000);
    expect(widths.left).toBeCloseTo(400);
    expect(widths.center).toBeCloseTo(600);
  });

  it('reflows any hidden panel out of the visible width', () => {
    const widths = resolveWidePanelWidths(balancedLayout, 1000, {
      visiblePanels: ['left', 'right']
    });

    expect(widths.center).toBe(0);
    expect(widths.left + widths.right).toBeCloseTo(1000);
    expect(widths.left).toBeCloseTo(545.4545);
    expect(widths.right).toBeCloseTo(454.5454);
  });

  it('updates adjacent panel fractions when a resize handle moves', () => {
    const nextLayout = resolveResizedPanelLayout({
      handle: {
        before: 'left',
        after: 'center'
      },
      startLayout: balancedLayout,
      delta: 50,
      contentWidth: 1000
    });

    expect(nextLayout.leftFraction).toBeCloseTo(0.35);
    expect(nextLayout.centerFraction).toBeCloseTo(0.4);
    expect(nextLayout.rightFraction).toBeCloseTo(0.25);
  });
});
