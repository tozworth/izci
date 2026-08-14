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
import {
  formatDuration,
  getFolderFromPath,
  getSeparatedSubsongPlaylistLabel,
  getTrackDisplayTitle
} from '$lib/utils/files';
import { formatTrackRating, normalizeTrackRating } from '$lib/services/track-ratings';

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

const LIBRARY_COLUMN_ICONS: Record<LibraryColumnId, string> = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  discAndTrack: 'tag',
  folder: 'folder',
  format: 'audio_file',
  duration: 'schedule',
  rating: 'star',
  plays: 'play_arrow',
  lastPlayed: 'history'
};

export function getLibraryColumnIcon(columnId: LibraryColumnId): string {
  return LIBRARY_COLUMN_ICONS[columnId];
}

const stringCollators = new Map<string, Intl.Collator>();

type TrackPosition = {
  display: string;
  disc: number | null;
  track: number | null;
};

function getStringCollator(locale?: string): Intl.Collator {
  const key = locale ?? '';
  const existing = stringCollators.get(key);
  if (existing) return existing;

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  stringCollators.set(key, collator);
  return collator;
}

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

export function getTrackPlayCount(item: PlaylistItem): string {
  const playCount = item.metadata?.playCount ?? 0;
  return Number.isFinite(playCount) && playCount > 0 ? String(Math.floor(playCount)) : '';
}

const lastPlayedDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

export function getTrackLastPlayed(item: PlaylistItem): string {
  const lastPlayed = item.metadata?.lastPlayed;
  return typeof lastPlayed === 'number' && Number.isFinite(lastPlayed) && lastPlayed > 0
    ? lastPlayedDateFormatter.format(lastPlayed)
    : '';
}

function parsePositionNumber(value: string): number | null {
  const match = value.match(/^\d+/);
  if (!match) return null;

  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function getTrackPosition(item: PlaylistItem): TrackPosition {
  const discText = item.metadata?.discNumber?.trim() ?? '';
  const trackText = item.metadata?.trackNumber?.trim() ?? '';

  return {
    display: discText && trackText ? `${discText} / ${trackText}` : discText || trackText,
    disc: parsePositionNumber(discText),
    track: parsePositionNumber(trackText)
  };
}

export function getColumnTextValue(item: PlaylistItem, columnId: LibraryColumnId): string {
  switch (columnId) {
    case 'title':
      return getSeparatedSubsongPlaylistLabel(item) || getTrackDisplayTitle(item);
    case 'artist':
      return item.metadata?.artist?.trim() ?? '';
    case 'album':
      return item.metadata?.album?.trim() ?? '';
    case 'discAndTrack':
      return getTrackPosition(item).display;
    case 'folder':
      return getFolderFromPath(item.path)?.trim() ?? '';
    case 'format':
      return formatTrackType(item);
    case 'duration':
      return getTrackDuration(item);
    case 'rating':
      return formatTrackRating(item.rating);
    case 'plays':
      return getTrackPlayCount(item);
    case 'lastPlayed':
      return getTrackLastPlayed(item);
  }
}

export function isRightAlignedColumn(columnId: LibraryColumnId): boolean {
  return columnId === 'discAndTrack'
    || columnId === 'format'
    || columnId === 'duration'
    || columnId === 'rating'
    || columnId === 'plays';
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
  const columnIndex = visibleColumnIds.indexOf(columnId);

  if (columnIndex === -1 || visibleColumnIds.length < 2) {
    return widths;
  }

  const columnsToRight = visibleColumnIds.slice(columnIndex + 1);
  const columnsToLeft = visibleColumnIds.slice(0, columnIndex).reverse();
  const neighboringColumns = [...columnsToRight, ...columnsToLeft];
  const currentWidth = widths[columnId] ?? 0;
  const targetWidth = Math.max(LIBRARY_COLUMN_MIN_WIDTHS[columnId], currentWidth + delta);

  if (targetWidth > currentWidth) {
    let remainingIncrease = targetWidth - currentWidth;

    for (const id of neighboringColumns) {
      if (remainingIncrease <= 0) {
        break;
      }

      const width = widths[id] ?? 0;
      const capacity = Math.max(0, width - LIBRARY_COLUMN_MIN_WIDTHS[id]);
      const reduction = Math.min(capacity, remainingIncrease);

      widths[id] = width - reduction;
      remainingIncrease -= reduction;
    }

    const actualIncrease = neighboringColumns.reduce(
      (sum, id) => sum + (baseWidths[id] ?? 0) - (widths[id] ?? 0),
      0
    );
    widths[columnId] = currentWidth + actualIncrease;
    return widths;
  }

  const actualReduction = Math.max(0, currentWidth - targetWidth);
  const neighborId = neighboringColumns[0];

  widths[neighborId] = (widths[neighborId] ?? 0) + actualReduction;

  widths[columnId] = targetWidth;
  return widths;
}

function compareByColumn(
  left: PlaylistItem,
  right: PlaylistItem,
  columnId: LibraryColumnId,
  direction: 'asc' | 'desc',
  stringCollator: Intl.Collator
): number {
  if (columnId === 'discAndTrack') {
    const leftPosition = getTrackPosition(left);
    const rightPosition = getTrackPosition(right);
    const compareNumber = (leftValue: number | null, rightValue: number | null): number => {
      if (leftValue === null || rightValue === null) {
        if (leftValue === rightValue) return 0;
        return leftValue === null ? 1 : -1;
      }

      return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    };
    const discComparison = compareNumber(leftPosition.disc, rightPosition.disc);

    return discComparison || compareNumber(leftPosition.track, rightPosition.track);
  }

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

  if (columnId === 'plays') {
    const leftPlayCount = left.metadata?.playCount ?? 0;
    const rightPlayCount = right.metadata?.playCount ?? 0;
    const leftMissing = !Number.isFinite(leftPlayCount) || leftPlayCount <= 0;
    const rightMissing = !Number.isFinite(rightPlayCount) || rightPlayCount <= 0;

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        return 0;
      }

      return leftMissing ? 1 : -1;
    }

    return direction === 'desc' ? rightPlayCount - leftPlayCount : leftPlayCount - rightPlayCount;
  }

  if (columnId === 'lastPlayed') {
    const leftLastPlayed = left.metadata?.lastPlayed;
    const rightLastPlayed = right.metadata?.lastPlayed;
    const leftMissing = !Number.isFinite(leftLastPlayed);
    const rightMissing = !Number.isFinite(rightLastPlayed);

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        return 0;
      }

      return leftMissing ? 1 : -1;
    }

    return direction === 'desc'
      ? (rightLastPlayed as number) - (leftLastPlayed as number)
      : (leftLastPlayed as number) - (rightLastPlayed as number);
  }

  if (columnId === 'rating') {
    const leftRating = normalizeTrackRating(left.rating);
    const rightRating = normalizeTrackRating(right.rating);

    if (leftRating === undefined || rightRating === undefined) {
      if (leftRating === rightRating) return 0;
      return leftRating === undefined ? 1 : -1;
    }

    return direction === 'desc' ? rightRating - leftRating : leftRating - rightRating;
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

export function compareItems(
  left: PlaylistItem,
  right: PlaylistItem,
  sort: LibraryViewSortState,
  locale?: string
): number {
  const { columnId, direction } = sort;
  const stringCollator = getStringCollator(locale);
  const comparison = compareByColumn(left, right, columnId, direction, stringCollator);

  if (comparison !== 0) {
    return comparison;
  }

  const titleComparison = stringCollator.compare(getTrackDisplayTitle(left), getTrackDisplayTitle(right));

  if (titleComparison !== 0) {
    return titleComparison;
  }

  return stringCollator.compare(left.name, right.name);
}
