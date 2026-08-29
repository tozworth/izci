import { describe, expect, it } from 'vitest';
import {
  getVirtualTrackWindow,
  DEFAULT_TRACK_ROW_HEIGHT,
  TRACK_LIST_OVERSCAN_ROWS,
  TRACK_LIST_VIRTUALIZATION_THRESHOLD,
} from './track-list-virtualization';

const OVERSCAN = TRACK_LIST_OVERSCAN_ROWS;

describe('track list virtualization', () => {
  it('keeps small lists intact', () => {
    expect(getVirtualTrackWindow(TRACK_LIST_VIRTUALIZATION_THRESHOLD, 400, 280)).toEqual({
      start: 0,
      end: TRACK_LIST_VIRTUALIZATION_THRESHOLD,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0
    });
  });

  it('renders a bounded window while preserving the full scroll height', () => {
    const itemCount = 10_000;
    const window = getVirtualTrackWindow(itemCount, 5_600, 560);
    const firstVisibleRow = Math.floor(5_600 / DEFAULT_TRACK_ROW_HEIGHT);

    expect(window.start).toBe(firstVisibleRow - OVERSCAN);
    expect(window.end).toBe(firstVisibleRow + Math.ceil(560 / DEFAULT_TRACK_ROW_HEIGHT) + OVERSCAN);
    expect(window.topSpacerHeight + (window.end - window.start) * DEFAULT_TRACK_ROW_HEIGHT + window.bottomSpacerHeight)
      .toBe(itemCount * DEFAULT_TRACK_ROW_HEIGHT);
  });

  it('uses a measured flat-list row height for virtual spacers', () => {
    const itemCount = 1_000;
    const rowHeight = 25.5;
    const window = getVirtualTrackWindow(itemCount, 510, 255, rowHeight);
    const firstVisibleRow = Math.floor(510 / rowHeight);

    expect(window.start).toBe(firstVisibleRow - OVERSCAN);
    expect(window.end).toBe(firstVisibleRow + Math.ceil(255 / rowHeight) + OVERSCAN);
    expect(window.topSpacerHeight + (window.end - window.start) * rowHeight + window.bottomSpacerHeight)
      .toBe(itemCount * rowHeight);
  });
});
