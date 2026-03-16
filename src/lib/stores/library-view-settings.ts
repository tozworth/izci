import { writable } from 'svelte/store';
import type { LibraryColumnId, LibraryViewSettings, SortDirection } from '$lib/types';

export const LIBRARY_VIEW_SETTINGS_STORAGE_KEY = 'izci.library-view-settings.v1';
export const LIBRARY_VIEW_SETTINGS_CHANNEL = 'izci-library-view-settings';
export const LIBRARY_COLUMN_IDS: LibraryColumnId[] = ['title', 'artist', 'format', 'duration'];
export const LIBRARY_COLUMN_LABELS: Record<LibraryColumnId, string> = {
  title: 'Title',
  artist: 'Artist',
  format: 'Format',
  duration: 'Duration'
};
export const LIBRARY_COLUMN_DEFAULT_WIDTHS: Record<LibraryColumnId, number> = {
  title: 300,
  artist: 220,
  format: 96,
  duration: 104
};
export const LIBRARY_COLUMN_MIN_WIDTHS: Record<LibraryColumnId, number> = {
  title: 72,
  artist: 72,
  format: 56,
  duration: 64
};

const DEFAULT_LIBRARY_VIEW_SETTINGS: LibraryViewSettings = {
  order: [...LIBRARY_COLUMN_IDS],
  columns: {
    title: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.title,
      visible: true
    },
    artist: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.artist,
      visible: true
    },
    format: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.format,
      visible: true
    },
    duration: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.duration,
      visible: true
    }
  },
  sort: {
    columnId: 'title',
    direction: 'asc'
  }
};

let broadcastChannel: BroadcastChannel | null = null;
let syncInitialized = false;

function clampWidth(columnId: LibraryColumnId, width: unknown): number {
  const minWidth = LIBRARY_COLUMN_MIN_WIDTHS[columnId];

  if (typeof width === 'number' && Number.isFinite(width)) {
    return Math.max(minWidth, Math.round(width));
  }

  if (typeof width === 'string' && width.trim() !== '') {
    const parsed = Number(width);

    if (Number.isFinite(parsed)) {
      return Math.max(minWidth, Math.round(parsed));
    }
  }

  return LIBRARY_COLUMN_DEFAULT_WIDTHS[columnId];
}

function normalizeOrder(order: unknown): LibraryColumnId[] {
  const normalized = Array.isArray(order)
    ? order.filter((columnId): columnId is LibraryColumnId =>
        LIBRARY_COLUMN_IDS.includes(columnId as LibraryColumnId)
      )
    : [];
  const unique = Array.from(new Set(normalized));

  for (const columnId of LIBRARY_COLUMN_IDS) {
    if (!unique.includes(columnId)) {
      unique.push(columnId);
    }
  }

  return unique;
}

function normalizeDirection(value: unknown): SortDirection {
  return value === 'desc' ? 'desc' : 'asc';
}

function normalizeSettings(value: unknown): LibraryViewSettings {
  const source = value && typeof value === 'object' ? (value as Partial<LibraryViewSettings>) : {};
  const columnsSource =
    source.columns && typeof source.columns === 'object'
      ? (source.columns as Partial<Record<LibraryColumnId, { width?: unknown; visible?: unknown }>>)
      : {};

  const columns = LIBRARY_COLUMN_IDS.reduce(
    (result, columnId) => {
      const column = columnsSource[columnId];

      result[columnId] = {
        width: clampWidth(columnId, column?.width),
        visible:
          typeof column?.visible === 'boolean'
            ? column.visible
            : DEFAULT_LIBRARY_VIEW_SETTINGS.columns[columnId].visible
      };

      return result;
    },
    {} as LibraryViewSettings['columns']
  );

  if (!LIBRARY_COLUMN_IDS.some((columnId) => columns[columnId].visible)) {
    columns.title.visible = true;
  }

  const order = normalizeOrder(source.order);
  const sortSource =
    source.sort && typeof source.sort === 'object'
      ? (source.sort as Partial<LibraryViewSettings['sort']>)
      : {};
  const sortColumnId = LIBRARY_COLUMN_IDS.includes(sortSource.columnId as LibraryColumnId)
    ? (sortSource.columnId as LibraryColumnId)
    : DEFAULT_LIBRARY_VIEW_SETTINGS.sort.columnId;

  return {
    order,
    columns,
    sort: {
      columnId: sortColumnId,
      direction: normalizeDirection(sortSource.direction)
    }
  };
}

function readStoredSettings(): LibraryViewSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_LIBRARY_VIEW_SETTINGS;
  }

  try {
    const rawValue = window.localStorage.getItem(LIBRARY_VIEW_SETTINGS_STORAGE_KEY);
    return rawValue ? normalizeSettings(JSON.parse(rawValue)) : DEFAULT_LIBRARY_VIEW_SETTINGS;
  } catch {
    return DEFAULT_LIBRARY_VIEW_SETTINGS;
  }
}

function persistSettings(settings: LibraryViewSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LIBRARY_VIEW_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  broadcastChannel?.postMessage(settings);
}

const store = writable<LibraryViewSettings>(readStoredSettings());
let currentSettings = readStoredSettings();

store.subscribe((value) => {
  currentSettings = value;
});

function initializeSync(): void {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== LIBRARY_VIEW_SETTINGS_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_LIBRARY_VIEW_SETTINGS);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(LIBRARY_VIEW_SETTINGS_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeSettings(event.data));
    });
  }
}

function setSettings(nextValue: unknown): LibraryViewSettings {
  const normalized = normalizeSettings(nextValue);
  store.set(normalized);
  persistSettings(normalized);
  return normalized;
}

function updateSettings(updater: (settings: LibraryViewSettings) => LibraryViewSettings): LibraryViewSettings {
  return setSettings(updater(currentSettings));
}

initializeSync();

export const libraryViewSettings = {
  subscribe: store.subscribe,
  getSnapshot(): LibraryViewSettings {
    return currentSettings;
  },
  setSort(columnId: LibraryColumnId): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      sort: {
        columnId,
        direction:
          settings.sort.columnId === columnId && settings.sort.direction === 'asc' ? 'desc' : 'asc'
      }
    }));
  },
  setColumnWidth(columnId: LibraryColumnId, width: number): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      columns: {
        ...settings.columns,
        [columnId]: {
          ...settings.columns[columnId],
          width: clampWidth(columnId, width)
        }
      }
    }));
  },
  setColumnWidths(widths: Partial<Record<LibraryColumnId, number>>): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      columns: {
        ...settings.columns,
        ...Object.fromEntries(
          Object.entries(widths).map(([columnId, width]) => [
            columnId,
            {
              ...settings.columns[columnId as LibraryColumnId],
              width: clampWidth(columnId as LibraryColumnId, width)
            }
          ])
        )
      }
    }));
  },
  setColumnVisibility(columnId: LibraryColumnId, visible: boolean): LibraryViewSettings {
    return updateSettings((settings) => {
      const visibleColumnCount = LIBRARY_COLUMN_IDS.filter((id) => settings.columns[id].visible).length;

      if (!visible && settings.columns[columnId].visible && visibleColumnCount === 1) {
        return settings;
      }

      return {
        ...settings,
        columns: {
          ...settings.columns,
          [columnId]: {
            ...settings.columns[columnId],
            visible
          }
        }
      };
    });
  },
  moveColumn(columnId: LibraryColumnId, targetColumnId: LibraryColumnId, position: 'before' | 'after'): LibraryViewSettings {
    return updateSettings((settings) => {
      if (columnId === targetColumnId) {
        return settings;
      }

      const nextOrder = settings.order.filter((id) => id !== columnId);
      const targetIndex = nextOrder.indexOf(targetColumnId);

      if (targetIndex === -1) {
        return settings;
      }

      nextOrder.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, columnId);

      return {
        ...settings,
        order: nextOrder
      };
    });
  },
  reset(): LibraryViewSettings {
    return setSettings(DEFAULT_LIBRARY_VIEW_SETTINGS);
  }
};
