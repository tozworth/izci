import { describe, expect, it } from 'vitest';

import {
  getWideContentWidth,
  resolveResizedPanelLayout,
  resolveWidePanelWidths
} from './workspace-layout';
import type { WorkspacePanelLayoutSettings } from '$lib/types';

const balancedLayout: WorkspacePanelLayoutSettings = {
  playlistFraction: 0.3,
  libraryFraction: 0.45,
  detailsFraction: 0.25
};

function totalWidth(widths: Record<'playlist' | 'library' | 'details', number>): number {
  return widths.playlist + widths.library + widths.details;
}

describe('workspace layout', () => {
  it('subtracts padding and only visible resizers from the wide content width', () => {
    expect(getWideContentWidth(1200)).toBe(1148);
    expect(getWideContentWidth(1200, { detailsVisible: false })).toBe(1162);
  });

  it('resolves wide panel widths while preserving total content width', () => {
    const widths = resolveWidePanelWidths(balancedLayout, 1000);

    expect(widths.playlist).toBeGreaterThanOrEqual(250);
    expect(widths.library).toBeGreaterThanOrEqual(320);
    expect(widths.details).toBeGreaterThanOrEqual(240);
    expect(totalWidth(widths)).toBeCloseTo(1000);
  });

  it('keeps hidden details out of the visible width without mutating the stored proportions', () => {
    const widths = resolveWidePanelWidths(balancedLayout, 1000, { detailsVisible: false });

    expect(widths.details).toBe(0);
    expect(widths.playlist + widths.library).toBeCloseTo(1000);
    expect(widths.playlist).toBeCloseTo(400);
    expect(widths.library).toBeCloseTo(600);
  });

  it('updates adjacent panel fractions when a resize handle moves', () => {
    const nextLayout = resolveResizedPanelLayout({
      handle: 'playlist-library',
      startLayout: balancedLayout,
      delta: 50,
      contentWidth: 1000
    });

    expect(nextLayout.playlistFraction).toBeCloseTo(0.35);
    expect(nextLayout.libraryFraction).toBeCloseTo(0.4);
    expect(nextLayout.detailsFraction).toBeCloseTo(0.25);
  });
});
