import type {
  LibraryBrowserLayout,
  LibraryColumnId,
  LibraryGroupViewId,
  LibraryViewId,
  LibraryViewSettings,
  LibraryViewTableSettings,
  SortDirection
} from '$lib/types';
import { createPersistentStore, normalizeBoolean } from './persistent-store';

const LIBRARY_VIEW_SETTINGS_STORAGE_KEY = 'izci.library-view-settings.v7';
const LIBRARY_VIEW_SETTINGS_CHANNEL = 'izci-library-view-settings-v7';
export const LIBRARY_VIEW_IDS: LibraryViewId[] = [
  'favorites',
  'ratings',
  'allMedia',
  'songs',
  'images',
  'videos',
  'artists',
  'albums',
  'genres',
  'years',
  'formats',
  'folders'
];
export const LIBRARY_OPT_IN_VIEW_IDS: LibraryViewId[] = ['songs', 'images', 'videos'];
const LIBRARY_GROUP_VIEW_IDS: LibraryGroupViewId[] = [
  'artists',
  'albums',
  'genres',
  'years',
  'formats',
  'folders'
];
const LIBRARY_COLUMN_IDS: LibraryColumnId[] = [
  'title',
  'artist',
  'album',
  'discAndTrack',
  'folder',
  'format',
  'duration',
  'rating',
  'plays',
  'lastPlayed',
  'year',
  'bitrate',
  'fileSize'
];
export const LIBRARY_COLUMN_LABELS: Record<LibraryColumnId, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  discAndTrack: 'Track',
  folder: 'Folder',
  format: 'Format',
  duration: 'Duration',
  rating: 'Rating',
  plays: 'Plays',
  lastPlayed: 'Last played',
  year: 'Year',
  bitrate: 'Bitrate',
  fileSize: 'File size'
};
export const LIBRARY_COLUMN_DEFAULT_WIDTHS: Record<LibraryColumnId, number> = {
  title: 300,
  artist: 220,
  album: 220,
  discAndTrack: 112,
  folder: 220,
  format: 96,
  duration: 104,
  rating: 104,
  plays: 88,
  lastPlayed: 128,
  year: 72,
  bitrate: 88,
  fileSize: 96
};
export const LIBRARY_COLUMN_MIN_WIDTHS: Record<LibraryColumnId, number> = {
  title: 72,
  artist: 72,
  album: 72,
  discAndTrack: 48,
  folder: 72,
  format: 48,
  duration: 48,
  rating: 44,
  plays: 48,
  lastPlayed: 72,
  year: 48,
  bitrate: 56,
  fileSize: 64
};

function createDefaultColumns(view: LibraryViewId): LibraryViewTableSettings['columns'] {
  const columns: LibraryViewTableSettings['columns'] = {
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
    discAndTrack: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.discAndTrack,
      visible: false
    },
    folder: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.folder,
      visible: false
    },
    format: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.format,
      visible: false
    },
    duration: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.duration,
      visible: true
    },
    rating: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.rating,
      visible: false
    },
    plays: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.plays,
      visible: false
    },
    lastPlayed: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.lastPlayed,
      visible: false
    },
    year: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.year,
      visible: false
    },
    bitrate: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.bitrate,
      visible: false
    },
    fileSize: {
      width: LIBRARY_COLUMN_DEFAULT_WIDTHS.fileSize,
      visible: false
    }
  };

  if (view === 'artists' || view === 'genres' || view === 'years' || view === 'formats' || view === 'folders') {
    columns.album.visible = true;
  }

  if (view === 'ratings') {
    for (const columnId of LIBRARY_COLUMN_IDS) {
      columns[columnId].visible = ['rating', 'title', 'artist', 'format', 'duration'].includes(columnId);
    }
  }

  const redundantColumn: Partial<Record<LibraryViewId, LibraryColumnId>> = {
    artists: 'artist',
    albums: 'album'
  };
  const columnId = redundantColumn[view];

  if (columnId) {
    columns[columnId].visible = false;
  }

  return columns;
}

function createDefaultViewSettings(view: LibraryViewId): LibraryViewTableSettings {
  const order = view === 'ratings'
    ? ['rating', 'title', 'artist', 'format', 'duration', 'album', 'discAndTrack', 'folder', 'plays', 'lastPlayed', 'year', 'bitrate', 'fileSize'] satisfies LibraryColumnId[]
    : [...LIBRARY_COLUMN_IDS];

  return {
    layout: 'list',
    tileSize: 144,
    order,
    columns: createDefaultColumns(view),
    sort: {
      columnId: view === 'ratings' ? 'rating' : 'title',
      direction: view === 'ratings' ? 'desc' : 'asc'
    }
  };
}

function createDefaultViews(): LibraryViewSettings['views'] {
  return Object.fromEntries(
    LIBRARY_VIEW_IDS.map((view) => [view, createDefaultViewSettings(view)])
  ) as LibraryViewSettings['views'];
}

function createDefaultPinnedGroupKeys(): LibraryViewSettings['pinnedGroupKeys'] {
  return LIBRARY_GROUP_VIEW_IDS.reduce((result, view) => {
    result[view] = [];
    return result;
  }, {} as LibraryViewSettings['pinnedGroupKeys']);
}

function createDefaultVisibleViews(): LibraryViewId[] {
  return LIBRARY_VIEW_IDS.filter((view) => !LIBRARY_OPT_IN_VIEW_IDS.includes(view));
}

const DEFAULT_LIBRARY_VIEW_SETTINGS: LibraryViewSettings = {
  activeView: 'allMedia',
  views: createDefaultViews(),
  pinnedGroupKeys: createDefaultPinnedGroupKeys(),
  visibleViews: createDefaultVisibleViews(),
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

function normalizePinnedGroupKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(new Set(value.filter((key): key is string => typeof key === 'string' && key !== '')));
}

function normalizeVisibleViews(value: unknown): LibraryViewId[] {
  if (!Array.isArray(value)) return createDefaultVisibleViews();

  const normalized = Array.from(new Set(
    value.filter((view): view is LibraryViewId => LIBRARY_VIEW_IDS.includes(view as LibraryViewId))
  ));

  if (normalized.length === 0) return createDefaultVisibleViews();

  return normalized;
}

function normalizeViewSettings(value: unknown, view: LibraryViewId): LibraryViewTableSettings {
  const defaults = createDefaultViewSettings(view);
  const source = value && typeof value === 'object' ? (value as Partial<LibraryViewTableSettings>) : {};
  const columnsSource =
    source.columns && typeof source.columns === 'object'
      ? (source.columns as Partial<Record<LibraryColumnId, { width?: unknown; visible?: unknown }>>)
      : {};

  const columns = LIBRARY_COLUMN_IDS.reduce(
    (result, columnId) => {
      const column = columnsSource[columnId];

      result[columnId] = {
        width: clampWidth(columnId, column?.width),
        visible: normalizeBoolean(column?.visible, defaults.columns[columnId].visible)
      };

      return result;
    },
    {} as LibraryViewTableSettings['columns']
  );

  if (!LIBRARY_COLUMN_IDS.some((columnId) => columns[columnId].visible)) {
    columns.title.visible = true;
  }

  const order = normalizeOrder(source.order);
  const sortSource =
    source.sort && typeof source.sort === 'object'
      ? (source.sort as Partial<LibraryViewTableSettings['sort']>)
      : {};
  const sortColumnId = LIBRARY_COLUMN_IDS.includes(sortSource.columnId as LibraryColumnId)
    ? (sortSource.columnId as LibraryColumnId)
    : defaults.sort.columnId;

  return {
    layout: source.layout === 'grid' || (source.layout === 'gallery' && (view === 'images' || view === 'videos'))
      ? source.layout : 'list',
    tileSize: typeof source.tileSize === 'number' && Number.isFinite(source.tileSize)
      ? Math.max(80, Math.min(256, Math.round(source.tileSize))) : defaults.tileSize,
    order,
    columns,
    sort: {
      columnId: sortColumnId,
      direction: normalizeDirection(sortSource.direction)
    }
  };
}

function normalizeSettings(value: unknown): LibraryViewSettings {
  const source = value && typeof value === 'object' ? (value as Partial<LibraryViewSettings>) : {};
  const viewsSource =
    source.views && typeof source.views === 'object'
      ? (source.views as Partial<Record<LibraryViewId, unknown>>)
      : {};
  const pinnedGroupKeysSource =
    source.pinnedGroupKeys && typeof source.pinnedGroupKeys === 'object'
      ? (source.pinnedGroupKeys as Partial<Record<LibraryGroupViewId, unknown>>)
      : {};
  const visibleViews = normalizeVisibleViews(source.visibleViews);
  const activeView = LIBRARY_VIEW_IDS.includes(source.activeView as LibraryViewId)
    && visibleViews.includes(source.activeView as LibraryViewId)
    ? (source.activeView as LibraryViewId)
    : visibleViews[0];

  return {
    activeView,
    views: Object.fromEntries(
      LIBRARY_VIEW_IDS.map((view) => [view, normalizeViewSettings(viewsSource[view], view)])
    ) as LibraryViewSettings['views'],
    pinnedGroupKeys: Object.fromEntries(
      LIBRARY_GROUP_VIEW_IDS.map((view) => [view, normalizePinnedGroupKeys(pinnedGroupKeysSource[view])])
    ) as LibraryViewSettings['pinnedGroupKeys'],
    visibleViews,
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
  setLayout(layout: LibraryBrowserLayout, view = store.getSnapshot().activeView): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      views: {
        ...settings.views,
        [view]: { ...settings.views[view], layout }
      }
    }));
  },
  adjustTileSize(delta: number, view = store.getSnapshot().activeView): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      views: {
        ...settings.views,
        [view]: {
          ...settings.views[view],
          tileSize: settings.views[view].tileSize + delta
        }
      }
    }));
  },
  setActiveView(activeView: LibraryViewId): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      activeView: LIBRARY_VIEW_IDS.includes(activeView) ? activeView : 'allMedia'
    }));
  },
  toggleViewVisibility(view: LibraryViewId): LibraryViewSettings {
    return updateSettings((settings) => {
      const isVisible = settings.visibleViews.includes(view);

      if (isVisible && settings.visibleViews.length === 1) {
        return settings;
      }

      const visibleViews = isVisible
        ? settings.visibleViews.filter((id) => id !== view)
        : Array.from(new Set([...settings.visibleViews, view]));
      const activeView = isVisible && settings.activeView === view
        ? visibleViews[0]
        : settings.activeView;

      return {
        ...settings,
        visibleViews,
        activeView
      };
    });
  },
  setSort(columnId: LibraryColumnId): LibraryViewSettings {
    return updateSettings((settings) => {
      const view = settings.views[settings.activeView];

      return {
        ...settings,
        views: {
          ...settings.views,
          [settings.activeView]: {
            ...view,
            sort: {
              columnId,
              direction: view.sort.columnId === columnId && view.sort.direction === 'asc' ? 'desc' : 'asc'
            }
          }
        }
      };
    });
  },
  setColumnWidth(columnId: LibraryColumnId, width: number): LibraryViewSettings {
    return updateSettings((settings) => {
      const view = settings.views[settings.activeView];

      return {
        ...settings,
        views: {
          ...settings.views,
          [settings.activeView]: {
            ...view,
            columns: {
              ...view.columns,
              [columnId]: {
                ...view.columns[columnId],
                width: clampWidth(columnId, width)
              }
            }
          }
        }
      };
    });
  },
  setColumnWidths(widths: Partial<Record<LibraryColumnId, number>>): LibraryViewSettings {
    return updateSettings((settings) => {
      const view = settings.views[settings.activeView];

      return {
        ...settings,
        views: {
          ...settings.views,
          [settings.activeView]: {
            ...view,
            columns: {
              ...view.columns,
              ...Object.fromEntries(
                Object.entries(widths).map(([columnId, width]) => [
                  columnId,
                  {
                    ...view.columns[columnId as LibraryColumnId],
                    width: clampWidth(columnId as LibraryColumnId, width)
                  }
                ])
              )
            }
          }
        }
      };
    });
  },
  setColumnVisibility(columnId: LibraryColumnId, visible: boolean): LibraryViewSettings {
    return updateSettings((settings) => {
      const view = settings.views[settings.activeView];
      const visibleColumnCount = LIBRARY_COLUMN_IDS.filter((id) => view.columns[id].visible).length;

      if (!visible && view.columns[columnId].visible && visibleColumnCount === 1) {
        return settings;
      }

      return {
        ...settings,
        views: {
          ...settings.views,
          [settings.activeView]: {
            ...view,
            columns: {
              ...view.columns,
              [columnId]: {
                ...view.columns[columnId],
                visible
              }
            }
          }
        }
      };
    });
  },
  moveView(view: LibraryViewId, targetView: LibraryViewId, position: 'before' | 'after'): LibraryViewSettings {
    return updateSettings((settings) => {
      if (view === targetView) return settings;
      if (!settings.visibleViews.includes(view) || !settings.visibleViews.includes(targetView)) {
        return settings;
      }

      const nextViews = settings.visibleViews.filter((id) => id !== view);
      const targetIndex = nextViews.indexOf(targetView);

      if (targetIndex === -1) return settings;

      nextViews.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, view);

      return {
        ...settings,
        visibleViews: nextViews
      };
    });
  },
  moveColumn(columnId: LibraryColumnId, targetColumnId: LibraryColumnId, position: 'before' | 'after'): LibraryViewSettings {
    return updateSettings((settings) => {
      const view = settings.views[settings.activeView];

      if (columnId === targetColumnId) {
        return settings;
      }

      const nextOrder = view.order.filter((id) => id !== columnId);
      const targetIndex = nextOrder.indexOf(targetColumnId);

      if (targetIndex === -1) {
        return settings;
      }

      nextOrder.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, columnId);

      return {
        ...settings,
        views: {
          ...settings.views,
          [settings.activeView]: {
            ...view,
            order: nextOrder
          }
        }
      };
    });
  },
  setSearchQuery(searchQuery: string): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      searchQuery: normalizeSearchQuery(searchQuery)
    }));
  },
  pinGroup(view: LibraryGroupViewId, key: string): LibraryViewSettings {
    return updateSettings((settings) => {
      const pinnedKeys = settings.pinnedGroupKeys[view];

      if (!key || pinnedKeys.includes(key)) return settings;

      return {
        ...settings,
        pinnedGroupKeys: {
          ...settings.pinnedGroupKeys,
          [view]: [...pinnedKeys, key]
        }
      };
    });
  },
  unpinGroup(view: LibraryGroupViewId, key: string): LibraryViewSettings {
    return updateSettings((settings) => ({
      ...settings,
      pinnedGroupKeys: {
        ...settings.pinnedGroupKeys,
        [view]: settings.pinnedGroupKeys[view].filter((pinnedKey) => pinnedKey !== key)
      }
    }));
  },
  movePinnedGroup(
    view: LibraryGroupViewId,
    key: string,
    targetKey: string,
    position: 'before' | 'after'
  ): LibraryViewSettings {
    return updateSettings((settings) => {
      const pinnedKeys = settings.pinnedGroupKeys[view];

      if (key === targetKey || !pinnedKeys.includes(key) || !pinnedKeys.includes(targetKey)) {
        return settings;
      }

      const nextKeys = pinnedKeys.filter((pinnedKey) => pinnedKey !== key);
      const targetIndex = nextKeys.indexOf(targetKey);
      nextKeys.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, key);

      return {
        ...settings,
        pinnedGroupKeys: {
          ...settings.pinnedGroupKeys,
          [view]: nextKeys
        }
      };
    });
  },
  reset: store.reset
};
