import {
  LIBRARY_COLUMN_LABELS,
  LIBRARY_COLUMN_MIN_WIDTHS
} from '$lib/stores/library-view-settings';
import type {
  LibraryColumnId,
  LibraryViewColumnState,
  LibraryViewSortState,
  PlaylistItem
} from '$lib/types';
import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';

export type LibraryColumnWidths = Partial<Record<LibraryColumnId, number>>;

export type LibraryPanelColumn = {
  id: LibraryColumnId;
  label: string;
  width: number;
  visible: boolean;
};

export type ColumnDropIndicator = {
  columnId: LibraryColumnId;
  position: 'before' | 'after';
};

const stringCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

export function getOrderedColumns(
  order: LibraryColumnId[],
  columns: Record<LibraryColumnId, LibraryViewColumnState>
): LibraryPanelColumn[] {
  return order.map((columnId) => ({
    id: columnId,
    label: LIBRARY_COLUMN_LABELS[columnId],
    width: columns[columnId].width,
    visible: columns[columnId].visible
  }));
}

export function formatTrackType(item: PlaylistItem): string {
  return item.extension.toUpperCase();
}

export function getTrackDuration(item: PlaylistItem): string {
  const duration = item.metadata?.duration ?? 0;
  return Number.isFinite(duration) && duration > 0 ? formatDuration(duration) : '';
}

export function getColumnTextValue(item: PlaylistItem, columnId: LibraryColumnId): string {
  switch (columnId) {
    case 'title':
      return getTrackDisplayTitle(item);
    case 'artist':
      return item.metadata?.artist?.trim() ?? '';
    case 'album':
      return item.metadata?.album?.trim() ?? '';
    case 'format':
      return formatTrackType(item);
    case 'duration':
      return getTrackDuration(item);
  }
}

export function isRightAlignedColumn(columnId: LibraryColumnId): boolean {
  return columnId === 'format' || columnId === 'duration';
}

export function fitWidthsToAvailableWidth(
  columns: Array<{ id: LibraryColumnId; width: number }>,
  availableWidth: number
): LibraryColumnWidths {
  if (columns.length === 0) {
    return {};
  }

  const safeAvailableWidth = Math.max(0, availableWidth);
  const minTotal = columns.reduce((sum, column) => sum + LIBRARY_COLUMN_MIN_WIDTHS[column.id], 0);

  if (safeAvailableWidth <= minTotal) {
    const scale = minTotal > 0 ? safeAvailableWidth / minTotal : 1;

    return Object.fromEntries(
      columns.map((column) => [column.id, LIBRARY_COLUMN_MIN_WIDTHS[column.id] * scale])
    );
  }

  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

  if (totalWidth <= safeAvailableWidth) {
    const extra = safeAvailableWidth - totalWidth;
    const totalBasis = totalWidth || columns.length;

    return Object.fromEntries(
      columns.map((column) => {
        const share = totalBasis > 0 ? (column.width || 1) / totalBasis : 1 / columns.length;
        return [column.id, column.width + extra * share];
      })
    );
  }

  const nextWidths = Object.fromEntries(columns.map((column) => [column.id, column.width])) as LibraryColumnWidths;
  let remainingOverflow = totalWidth - safeAvailableWidth;
  let adjustableColumns = columns.map((column) => column.id);

  while (remainingOverflow > 0.5 && adjustableColumns.length > 0) {
    const shrinkCapacity = adjustableColumns.reduce(
      (sum, columnId) => sum + Math.max(0, (nextWidths[columnId] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[columnId]),
      0
    );

    if (shrinkCapacity <= 0) {
      break;
    }

    const clampedColumns: LibraryColumnId[] = [];

    for (const columnId of adjustableColumns) {
      const currentWidth = nextWidths[columnId] ?? 0;
      const capacity = Math.max(0, currentWidth - LIBRARY_COLUMN_MIN_WIDTHS[columnId]);
      const reduction = Math.min(capacity, (remainingOverflow * capacity) / shrinkCapacity);
      const nextWidth = currentWidth - reduction;

      nextWidths[columnId] = nextWidth;

      if (nextWidth - LIBRARY_COLUMN_MIN_WIDTHS[columnId] <= 0.5) {
        nextWidths[columnId] = LIBRARY_COLUMN_MIN_WIDTHS[columnId];
        clampedColumns.push(columnId);
      }
    }

    const resolvedTotal = columns.reduce((sum, column) => sum + (nextWidths[column.id] ?? 0), 0);
    remainingOverflow = resolvedTotal - safeAvailableWidth;
    adjustableColumns = adjustableColumns.filter((columnId) => !clampedColumns.includes(columnId));
  }

  return nextWidths;
}

export function rebalanceResizedColumns(
  baseWidths: LibraryColumnWidths,
  visibleColumnIds: LibraryColumnId[],
  columnId: LibraryColumnId,
  delta: number
): LibraryColumnWidths {
  const widths = { ...baseWidths };
  const otherColumns = visibleColumnIds.filter((id) => id !== columnId);
  const currentWidth = widths[columnId] ?? 0;
  const targetWidth = Math.max(LIBRARY_COLUMN_MIN_WIDTHS[columnId], currentWidth + delta);

  if (targetWidth > currentWidth) {
    let remainingIncrease = targetWidth - currentWidth;
    let adjustableColumns = [...otherColumns];

    while (remainingIncrease > 0.5 && adjustableColumns.length > 0) {
      const shrinkCapacity = adjustableColumns.reduce(
        (sum, id) => sum + Math.max(0, (widths[id] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[id]),
        0
      );

      if (shrinkCapacity <= 0) {
        break;
      }

      const clampedColumns: LibraryColumnId[] = [];
      let reducedWidth = 0;

      for (const id of adjustableColumns) {
        const width = widths[id] ?? 0;
        const capacity = Math.max(0, width - LIBRARY_COLUMN_MIN_WIDTHS[id]);
        const reduction = Math.min(capacity, (remainingIncrease * capacity) / shrinkCapacity);

        widths[id] = width - reduction;
        reducedWidth += reduction;

        if ((widths[id] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[id] <= 0.5) {
          widths[id] = LIBRARY_COLUMN_MIN_WIDTHS[id];
          clampedColumns.push(id);
        }
      }

      remainingIncrease = Math.max(0, remainingIncrease - reducedWidth);
      adjustableColumns = adjustableColumns.filter((id) => !clampedColumns.includes(id));
    }

    const actualIncrease = otherColumns.reduce((sum, id) => sum + (baseWidths[id] ?? 0) - (widths[id] ?? 0), 0);
    widths[columnId] = currentWidth + actualIncrease;
    return widths;
  }

  const actualReduction = Math.max(0, currentWidth - targetWidth);
  const totalOtherWidth = otherColumns.reduce((sum, id) => sum + (widths[id] ?? 0), 0);

  for (const id of otherColumns) {
    const basis = totalOtherWidth > 0 ? (widths[id] ?? 0) / totalOtherWidth : 1 / otherColumns.length;
    widths[id] = (widths[id] ?? 0) + actualReduction * basis;
  }

  widths[columnId] = targetWidth;
  return widths;
}

function compareByColumn(
  left: PlaylistItem,
  right: PlaylistItem,
  columnId: LibraryColumnId,
  direction: 'asc' | 'desc'
): number {
  if (columnId === 'duration') {
    const leftDuration = left.metadata?.duration ?? 0;
    const rightDuration = right.metadata?.duration ?? 0;
    const leftMissing = !Number.isFinite(leftDuration) || leftDuration <= 0;
    const rightMissing = !Number.isFinite(rightDuration) || rightDuration <= 0;

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        return 0;
      }

      return leftMissing ? 1 : -1;
    }

    return direction === 'desc' ? rightDuration - leftDuration : leftDuration - rightDuration;
  }

  const leftValue = getColumnTextValue(left, columnId).trim();
  const rightValue = getColumnTextValue(right, columnId).trim();
  const leftMissing = leftValue === '';
  const rightMissing = rightValue === '';

  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) {
      return 0;
    }

    return leftMissing ? 1 : -1;
  }

  return direction === 'desc'
    ? stringCollator.compare(rightValue, leftValue)
    : stringCollator.compare(leftValue, rightValue);
}

export function compareItems(left: PlaylistItem, right: PlaylistItem, sort: LibraryViewSortState): number {
  const { columnId, direction } = sort;
  const comparison = compareByColumn(left, right, columnId, direction);

  if (comparison !== 0) {
    return comparison;
  }

  const titleComparison = stringCollator.compare(getTrackDisplayTitle(left), getTrackDisplayTitle(right));

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return stringCollator.compare(left.name, right.name);
}
