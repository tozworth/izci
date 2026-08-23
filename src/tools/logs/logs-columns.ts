import { createPersistentStore } from '$lib/stores/persistent-store';
import type { LogEntry, LogLevel } from '$lib/services/logging';

export type LogColumnId = 'time' | 'level' | 'source' | 'context' | 'message' | 'details';
export const LOG_COLUMN_IDS: readonly LogColumnId[] = ['time', 'level', 'source', 'context', 'message', 'details'];
export type LogColumnWidths = Record<LogColumnId, number>;
type LogColumnVisibility = Record<LogColumnId, boolean>;

const LOG_COLUMN_DEFAULT_WIDTHS: LogColumnWidths = {
  time: 104, level: 64, source: 92, context: 108, message: 240, details: 240
};
export const LOG_COLUMN_MIN_WIDTHS: LogColumnWidths = {
  time: 64, level: 44, source: 48, context: 52, message: 100, details: 100
};
const LOG_COLUMN_DEFAULT_VISIBILITY: LogColumnVisibility = {
  time: true, level: true, source: true, context: true, message: true, details: true
};

const LOG_COLUMN_ICONS: Record<LogColumnId, string> = {
  time: 'schedule', level: 'signal_cellular_alt', source: 'data_object', context: 'window',
  message: 'chat_bubble', details: 'info'
};
export const getLogColumnIcon = (columnId: LogColumnId) => LOG_COLUMN_ICONS[columnId];

export function formatLogTimestamp(timestamp: number, locales?: Intl.LocalesArgument): string {
  return new Date(timestamp).toLocaleTimeString(locales, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false
  });
}

function normalizeLogColumnWidths(value: unknown): LogColumnWidths {
  const source = value && typeof value === 'object' ? value as Partial<LogColumnWidths> : {};
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
  storageKey: 'izci.logs-column-widths.v2', channelName: 'izci-logs-column-widths-v2',
  defaultValue: LOG_COLUMN_DEFAULT_WIDTHS, normalize: normalizeLogColumnWidths
});

export function fitLogWidthsToAvailableWidth(
  widths: LogColumnWidths,
  availableWidth: number,
  columnIds: readonly LogColumnId[] = LOG_COLUMN_IDS
): LogColumnWidths {
  const safeWidth = Math.max(0, availableWidth);
  const minTotal = columnIds.reduce((sum, id) => sum + LOG_COLUMN_MIN_WIDTHS[id], 0);
  if (safeWidth <= minTotal) {
    const scale = minTotal > 0 ? safeWidth / minTotal : 1;
    return { ...widths, ...Object.fromEntries(columnIds.map((id) => [id, Math.max(1, LOG_COLUMN_MIN_WIDTHS[id] * scale)])) } as LogColumnWidths;
  }

  const total = columnIds.reduce((sum, id) => sum + widths[id], 0);
  if (total <= safeWidth) {
    const extra = safeWidth - total;
    const basis = total || columnIds.length;
    return { ...widths, ...Object.fromEntries(columnIds.map((id) => [id, widths[id] + extra * ((widths[id] || 1) / basis)])) } as LogColumnWidths;
  }

  const next = { ...widths };
  let overflow = total - safeWidth;
  let adjustable = [...columnIds];
  while (overflow > 0.5 && adjustable.length > 0) {
    const capacity = adjustable.reduce((sum, id) => sum + Math.max(0, next[id] - LOG_COLUMN_MIN_WIDTHS[id]), 0);
    if (capacity <= 0) break;
    const clamped: LogColumnId[] = [];
    for (const id of adjustable) {
      const ownCapacity = Math.max(0, next[id] - LOG_COLUMN_MIN_WIDTHS[id]);
      next[id] -= Math.min(ownCapacity, overflow * ownCapacity / capacity);
      if (next[id] - LOG_COLUMN_MIN_WIDTHS[id] <= 0.5) {
        next[id] = LOG_COLUMN_MIN_WIDTHS[id];
        clamped.push(id);
      }
    }
    overflow = columnIds.reduce((sum, id) => sum + next[id], 0) - safeWidth;
    adjustable = adjustable.filter((id) => !clamped.includes(id));
  }
  return next;
}

export function rebalanceLogColumnWidths(
  base: LogColumnWidths,
  columnId: LogColumnId,
  delta: number,
  columnIds: readonly LogColumnId[] = LOG_COLUMN_IDS
): LogColumnWidths {
  const widths = { ...base };
  const index = columnIds.indexOf(columnId);
  if (index < 0) return widths;
  const neighbors = [...columnIds.slice(index + 1), ...columnIds.slice(0, index).reverse()];
  const current = widths[columnId];
  const target = Math.max(LOG_COLUMN_MIN_WIDTHS[columnId], current + delta);
  if (target > current) {
    let remaining = target - current;
    for (const id of neighbors) {
      const reduction = Math.min(Math.max(0, widths[id] - LOG_COLUMN_MIN_WIDTHS[id]), remaining);
      widths[id] -= reduction;
      remaining -= reduction;
      if (remaining <= 0) break;
    }
    widths[columnId] = current + neighbors.reduce((sum, id) => sum + base[id] - widths[id], 0);
  } else {
    const reduction = current - target;
    if (neighbors[0]) widths[neighbors[0]] += reduction;
    widths[columnId] = target;
  }
  return widths;
}

export const logsColumnWidths = {
  subscribe: widthsStore.subscribe,
  getSnapshot: widthsStore.getSnapshot,
  setWidths: (widths: LogColumnWidths) => widthsStore.set(widths),
  reset: widthsStore.reset
};

function normalizeLogColumnVisibility(value: unknown): LogColumnVisibility {
  const source = value && typeof value === 'object' ? value as Partial<LogColumnVisibility> : {};
  const visibility = { ...LOG_COLUMN_DEFAULT_VISIBILITY };
  for (const id of LOG_COLUMN_IDS) if (typeof source[id] === 'boolean') visibility[id] = source[id];
  if (!LOG_COLUMN_IDS.some((id) => visibility[id])) visibility.time = true;
  return visibility;
}

const visibilityStore = createPersistentStore<LogColumnVisibility>({
  storageKey: 'izci.logs-column-visibility.v2', channelName: 'izci-logs-column-visibility-v2',
  defaultValue: LOG_COLUMN_DEFAULT_VISIBILITY, normalize: normalizeLogColumnVisibility
});
export const logsColumnVisibility = {
  subscribe: visibilityStore.subscribe,
  getSnapshot: visibilityStore.getSnapshot,
  setVisibility: (visibility: LogColumnVisibility) => visibilityStore.set(visibility),
  reset: visibilityStore.reset
};

type LogSortState = { columnId: LogColumnId; direction: 'asc' | 'desc' };
const LOG_SORT_DEFAULT: LogSortState = { columnId: 'time', direction: 'asc' };
function normalizeLogSort(value: unknown): LogSortState {
  const source = value && typeof value === 'object' ? value as Partial<LogSortState> : {};
  return {
    columnId: LOG_COLUMN_IDS.includes(source.columnId as LogColumnId) ? source.columnId as LogColumnId : 'time',
    direction: source.direction === 'desc' ? 'desc' : 'asc'
  };
}

const LEVEL_RANK: Record<LogLevel, number> = { error: 0, warning: 1, info: 2, debug: 3 };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export function compareLogEntries(left: LogEntry, right: LogEntry, sort: LogSortState): number {
  let comparison = 0;
  if (sort.columnId === 'time') comparison = left.timestamp - right.timestamp;
  else if (sort.columnId === 'level') comparison = LEVEL_RANK[left.level] - LEVEL_RANK[right.level];
  else if (sort.columnId === 'source') comparison = collator.compare(left.source, right.source);
  else if (sort.columnId === 'context') comparison = collator.compare(left.context, right.context);
  else if (sort.columnId === 'message') comparison = collator.compare(left.message, right.message);
  else comparison = collator.compare(left.details ?? '', right.details ?? '');
  return comparison === 0
    ? left.timestamp - right.timestamp || left.id.localeCompare(right.id)
    : sort.direction === 'desc' ? -comparison : comparison;
}

const sortStore = createPersistentStore<LogSortState>({
  storageKey: 'izci.logs-sort.v2', channelName: 'izci-logs-sort-v2',
  defaultValue: LOG_SORT_DEFAULT, normalize: normalizeLogSort
});
export const logsSort = {
  subscribe: sortStore.subscribe,
  getSnapshot: sortStore.getSnapshot,
  setSort: (columnId: LogColumnId) => sortStore.update((sort) => ({
    columnId,
    direction: sort.columnId === columnId && sort.direction === 'asc' ? 'desc' : 'asc'
  })),
  reset: sortStore.reset
};
