import type { LibraryColumnId, LibraryViewSettings, SortDirection } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const LIBRARY_VIEW_SETTINGS_STORAGE_KEY = 'izci.library-view-settings.v1';
export const LIBRARY_VIEW_SETTINGS_CHANNEL = 'izci-library-view-settings';
export const LIBRARY_COLUMN_IDS: LibraryColumnId[] = ['title', 'artist', 'album', 'folder', 'format', 'duration', 'plays'];
export const LIBRARY_COLUMN_LABELS: Record<LibraryColumnId, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  folder: 'Folder',
  format: 'Format',
  duration: 'Duration',
  plays: 'Plays'
};
export const LIBRARY_COLUMN_DEFAULT_WIDTHS: Record<LibraryColumnId, number> = {
  title: 300,
  artist: 220,
  album: 220,
  folder: 220,
  format: 96,
  duration: 104,
  plays: 88
};
export const LIBRARY_COLUMN_MIN_WIDTHS: Record<LibraryColumnId, number> = {
  title: 72,
  artist: 72,
  album: 72,
  folder: 72,
  format: 48,
  duration: 48,
  plays: 48
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
    album: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.album,
      visible: false
    },
    folder: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.folder,
      visible: true
    },
    format: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.format,
      visible: true
    },
    duration: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.duration,
      visible: true
    },
    plays: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.plays,
      visible: false
    }
  },
  sort: {
    columnId: 'title',
    direction: 'asc'
  },
  searchQuery: ''
};

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

function normalizeSearchQuery(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
    },
    searchQuery: normalizeSearchQuery(source.searchQuery)
  };
}

const store = createPersistentStore({
  storageKey: LIBRARY_VIEW_SETTINGS_STORAGE_KEY,
  channelName: LIBRARY_VIEW_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_LIBRARY_VIEW_SETTINGS,
  normalize: normalizeSettings
});

function updateSettings(updater: (settings: LibraryViewSettings) => LibraryViewSettings): LibraryViewSettings {
  return store.update(updater);
}

export const libraryViewSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
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
  setSearchQuery(searchQuery: string): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      searchQuery: normalizeSearchQuery(searchQuery)
    }));
  },
  reset: store.reset
};
