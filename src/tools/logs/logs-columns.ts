import { createPersistentStore } from '$lib/stores/persistent-store';

export type LogColumnId = 'time' | 'level' | 'source' | 'window' | 'message' | 'details';

export const LOG_COLUMN_IDS: readonly LogColumnId[] = [
  'time',
  'level',
  'source',
  'window',
  'message',
  'details'
];

export type LogColumnWidths = Record<LogColumnId, number>;

/** Defaults sum to the logs popup's default width (820px) minus column gaps. */
export const LOG_COLUMN_DEFAULT_WIDTHS: LogColumnWidths = {
  time: 104,
  level: 60,
  source: 92,
  window: 104,
  message: 220,
  details: 220
};

export const LOG_COLUMN_MIN_WIDTHS: LogColumnWidths = {
  time: 64,
  level: 40,
  source: 48,
  window: 48,
  message: 100,
  details: 100
};

const STORAGE_KEY = 'izci.logs-column-widths.v1';
const CHANNEL_NAME = 'izci-logs-column-widths-v1';

export function normalizeLogColumnWidths(value: unknown): LogColumnWidths {
  const source = value && typeof value === 'object' ? (value as Partial<LogColumnWidths>) : {};
  const widths = { ...LOG_COLUMN_DEFAULT_WIDTHS };

  for (const columnId of LOG_COLUMN_IDS) {
    const width = source[columnId];

    if (typeof width === 'number' && Number.isFinite(width)) {
      widths[columnId] = Math.max(LOG_COLUMN_MIN_WIDTHS[columnId], Math.round(width));
    }
  }

  return widths;
}

const widthsStore = createPersistentStore<LogColumnWidths>({
  storageKey: STORAGE_KEY,
  channelName: CHANNEL_NAME,
  defaultValue: LOG_COLUMN_DEFAULT_WIDTHS,
  normalize: normalizeLogColumnWidths
});

/**
 * Fits stored widths to the available width so the columns always fill the
 * popup: extra space is distributed proportionally, and overflow shrinks
 * columns down to their minimums before collapsing below them.
 */
export function fitLogWidthsToAvailableWidth(
  widths: LogColumnWidths,
  availableWidth: number
): LogColumnWidths {
  const safeAvailableWidth = Math.max(0, availableWidth);
  const minTotal = LOG_COLUMN_IDS.reduce((sum, columnId) => sum + LOG_COLUMN_MIN_WIDTHS[columnId], 0);

  if (safeAvailableWidth <= minTotal) {
    const scale = minTotal > 0 ? safeAvailableWidth / minTotal : 1;

    return Object.fromEntries(
      LOG_COLUMN_IDS.map((columnId) => [
        columnId,
        Math.max(1, LOG_COLUMN_MIN_WIDTHS[columnId] * scale)
      ])
    ) as LogColumnWidths;
  }

  const totalWidth = LOG_COLUMN_IDS.reduce((sum, columnId) => sum + widths[columnId], 0);

  if (totalWidth <= safeAvailableWidth) {
    const extra = safeAvailableWidth - totalWidth;
    const totalBasis = totalWidth || LOG_COLUMN_IDS.length;

    return Object.fromEntries(
      LOG_COLUMN_IDS.map((columnId) => {
        const share = totalBasis > 0 ? widths[columnId] / totalBasis : 1 / LOG_COLUMN_IDS.length;
        return [columnId, widths[columnId] + extra * share];
      })
    ) as LogColumnWidths;
  }

  const nextWidths = { ...widths } as LogColumnWidths;
  let remainingOverflow = totalWidth - safeAvailableWidth;
  let adjustableColumns = [...LOG_COLUMN_IDS];

  while (remainingOverflow > 0.5 && adjustableColumns.length > 0) {
    const shrinkCapacity = adjustableColumns.reduce(
      (sum, columnId) => sum + Math.max(0, nextWidths[columnId] - LOG_COLUMN_MIN_WIDTHS[columnId]),
      0
    );

    if (shrinkCapacity <= 0) {
      break;
    }

    const clampedColumns: LogColumnId[] = [];

    for (const columnId of adjustableColumns) {
      const currentWidth = nextWidths[columnId];
      const capacity = Math.max(0, currentWidth - LOG_COLUMN_MIN_WIDTHS[columnId]);
      const reduction = Math.min(capacity, (remainingOverflow * capacity) / shrinkCapacity);
      const nextWidth = currentWidth - reduction;

      nextWidths[columnId] = nextWidth;

      if (nextWidth - LOG_COLUMN_MIN_WIDTHS[columnId] <= 0.5) {
        nextWidths[columnId] = LOG_COLUMN_MIN_WIDTHS[columnId];
        clampedColumns.push(columnId);
      }
    }

    const resolvedTotal = LOG_COLUMN_IDS.reduce((sum, columnId) => sum + nextWidths[columnId], 0);
    remainingOverflow = resolvedTotal - safeAvailableWidth;
    adjustableColumns = adjustableColumns.filter((columnId) => !clampedColumns.includes(columnId));
  }

  return nextWidths;
}

/**
 * Rebalances widths when one column is resized, keeping the total constant by
 * stealing from (or giving to) the nearest neighbor, cascading once a neighbor
 * reaches its minimum. Mirrors the library view's resize behavior.
 */
export function rebalanceLogColumnWidths(
  baseWidths: LogColumnWidths,
  columnId: LogColumnId,
  delta: number
): LogColumnWidths {
  const widths = { ...baseWidths };
  const columnIndex = LOG_COLUMN_IDS.indexOf(columnId);

  if (columnIndex === -1) {
    return widths;
  }

  const columnsToRight = LOG_COLUMN_IDS.slice(columnIndex + 1);
  const columnsToLeft = LOG_COLUMN_IDS.slice(0, columnIndex).slice().reverse();
  const neighboringColumns = [...columnsToRight, ...columnsToLeft];
  const currentWidth = widths[columnId];
  const targetWidth = Math.max(LOG_COLUMN_MIN_WIDTHS[columnId], currentWidth + delta);

  if (targetWidth > currentWidth) {
    let remainingIncrease = targetWidth - currentWidth;

    for (const id of neighboringColumns) {
      if (remainingIncrease <= 0) {
        break;
      }

      const width = widths[id];
      const capacity = Math.max(0, width - LOG_COLUMN_MIN_WIDTHS[id]);
      const reduction = Math.min(capacity, remainingIncrease);

      widths[id] = width - reduction;
      remainingIncrease -= reduction;
    }

    const actualIncrease = neighboringColumns.reduce(
      (sum, id) => sum + baseWidths[id] - widths[id],
      0
    );
    widths[columnId] = currentWidth + actualIncrease;
    return widths;
  }

  const actualReduction = Math.max(0, currentWidth - targetWidth);
  const neighborId = neighboringColumns[0];

  if (neighborId) {
    widths[neighborId] += actualReduction;
  }

  widths[columnId] = targetWidth;
  return widths;
}

export const logsColumnWidths = {
  subscribe: widthsStore.subscribe,
  getSnapshot: widthsStore.getSnapshot,
  setWidths(widths: LogColumnWidths): LogColumnWidths {
    return widthsStore.set(widths);
  },
  reset: widthsStore.reset
};
