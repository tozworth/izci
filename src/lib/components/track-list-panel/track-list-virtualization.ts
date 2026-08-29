export const DEFAULT_TRACK_ROW_HEIGHT = 28;
export const TRACK_LIST_VIRTUALIZATION_THRESHOLD = 240;
export const TRACK_LIST_OVERSCAN_ROWS = 12;

export interface VirtualTrackWindow {
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function getVirtualTrackWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = DEFAULT_TRACK_ROW_HEIGHT
): VirtualTrackWindow {
  if (itemCount <= TRACK_LIST_VIRTUALIZATION_THRESHOLD || viewportHeight <= 0) {
    return {
      start: 0,
      end: itemCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0
    };
  }

  const resolvedRowHeight = Math.max(1, rowHeight);
  const firstVisibleRow = Math.floor(Math.max(0, scrollTop) / resolvedRowHeight);
  const visibleRowCount = Math.ceil(viewportHeight / resolvedRowHeight);
  const start = Math.max(0, firstVisibleRow - TRACK_LIST_OVERSCAN_ROWS);
  const end = Math.min(itemCount, firstVisibleRow + visibleRowCount + TRACK_LIST_OVERSCAN_ROWS);

  return {
    start,
    end,
    topSpacerHeight: start * resolvedRowHeight,
    bottomSpacerHeight: Math.max(0, (itemCount - end) * resolvedRowHeight)
  };
}
