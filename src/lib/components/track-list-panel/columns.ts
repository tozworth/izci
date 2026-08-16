import {
  LIBRARY_COLUMN_MIN_WIDTHS,
  libraryViewSettings
} from '$lib/stores/library-view-settings';
import {
  getLibraryColumnIcon,
  isRightAlignedColumn,
  rebalanceResizedColumns,
  type ColumnDropIndicator,
  type LibraryColumnWidths,
  type LibraryPanelColumn
} from './library-columns';
import type { ColumnListViewColumn } from '$lib/components/column-list-view';
import type { LibraryColumnId } from '$lib/types';
import type { TranslationOptions } from '$lib/i18n';

type Translate = (id: string, options?: TranslationOptions) => string;

export function getColumnDropIndicator(
  columnsHeaderElement: HTMLElement | null,
  visibleColumns: LibraryPanelColumn[],
  clientX: number
): ColumnDropIndicator | null {
  if (!columnsHeaderElement || visibleColumns.length === 0) {
    return null;
  }

  const columnElements = Array.from(
    columnsHeaderElement.querySelectorAll<HTMLElement>('[data-column-id]')
  );
  const columnBounds = visibleColumns
    .map((column) => {
      const element = columnElements.find((node) => node.dataset.columnId === column.id);

      if (!element) {
        return null;
      }

      return {
        columnId: column.id,
        bounds: element.getBoundingClientRect()
      };
    })
    .filter((entry): entry is { columnId: LibraryColumnId; bounds: DOMRect } => Boolean(entry));

  if (columnBounds.length === 0) {
    return null;
  }

  for (const { columnId, bounds } of columnBounds) {
    if (clientX < bounds.left + bounds.width / 2) {
      return {
        columnId,
        position: 'before'
      };
    }
  }

  return {
    columnId: columnBounds[columnBounds.length - 1].columnId,
    position: 'after'
  };
}

export function handleColumnSort(columnId: LibraryColumnId, suppressNextColumnSort: boolean): boolean {
  if (suppressNextColumnSort) {
    return true;
  }

  libraryViewSettings.setSort(columnId);
  return false;
}

export function handleColumnVisibilityToggle(
  columnId: LibraryColumnId,
  orderedColumns: LibraryPanelColumn[],
  visibleColumnCount: number
): void {
  const column = orderedColumns.find((candidate) => candidate.id === columnId);

  if (!column || (column.visible && visibleColumnCount === 1)) {
    return;
  }

  libraryViewSettings.setColumnVisibility(column.id, !column.visible);
}

export function columnResizeLabel(column: ColumnListViewColumn, translate: Translate): string {
  return translate('library.columns.resize', {
    default: 'Resize {column} column',
    values: { column: column.label }
  });
}

export function handleColumnResizeStart(
  event: PointerEvent,
  columnId: LibraryColumnId,
  layout: 'list' | 'columns',
  visibleColumns: LibraryPanelColumn[]
): { resizingColumnId: LibraryColumnId; resizeStartX: number; resizeStartWidths: LibraryColumnWidths } | null {
  if (layout !== 'columns') {
    return null;
  }

  event.preventDefault();
  event.stopPropagation();

  return {
    resizingColumnId: columnId,
    resizeStartX: event.clientX,
    resizeStartWidths: Object.fromEntries(visibleColumns.map((column) => [column.id, column.width]))
  };
}

export function handleColumnPointerDown(
  event: PointerEvent,
  columnId: LibraryColumnId,
  layout: 'list' | 'columns',
  isCompactColumnLayout: boolean,
  resizingColumnId: LibraryColumnId | null
): { pendingDragColumnId: LibraryColumnId; pendingDragStartX: number } | null {
  if (event.button !== 0 || layout !== 'columns' || isCompactColumnLayout || resizingColumnId) {
    return null;
  }

  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return null;
  }

  if (target.closest('.clv-column-resizer')) {
    return null;
  }

  return {
    pendingDragColumnId: columnId,
    pendingDragStartX: event.clientX
  };
}

export type ColumnPointerMoveResult =
  | { type: 'none' }
  | { type: 'resize' }
  | { type: 'drag-start'; draggedColumnId: LibraryColumnId; dropIndicator: ColumnDropIndicator | null }
  | { type: 'drag-move'; dropIndicator: ColumnDropIndicator | null };

export function handleWindowPointerMove(
  event: PointerEvent,
  state: {
    resizingColumnId: LibraryColumnId | null;
    resizeStartX: number;
    resizeStartWidths: LibraryColumnWidths;
    visibleColumns: LibraryPanelColumn[];
    draggedColumnId: LibraryColumnId | null;
    pendingDragColumnId: LibraryColumnId | null;
    pendingDragStartX: number;
  },
  columnsHeaderElement: HTMLElement | null
): ColumnPointerMoveResult {
  const {
    resizingColumnId,
    resizeStartX,
    resizeStartWidths,
    visibleColumns,
    draggedColumnId,
    pendingDragColumnId,
    pendingDragStartX
  } = state;

  if (resizingColumnId) {
    libraryViewSettings.setColumnWidths(
      rebalanceResizedColumns(
        resizeStartWidths,
        visibleColumns.map((column) => column.id),
        resizingColumnId,
        event.clientX - resizeStartX
      )
    );
    return { type: 'resize' };
  }

  if (!draggedColumnId && pendingDragColumnId) {
    if (Math.abs(event.clientX - pendingDragStartX) < 6) {
      return { type: 'none' };
    }

    return {
      type: 'drag-start',
      draggedColumnId: pendingDragColumnId,
      dropIndicator: getColumnDropIndicator(columnsHeaderElement, visibleColumns, event.clientX)
    };
  }

  if (draggedColumnId) {
    return {
      type: 'drag-move',
      dropIndicator: getColumnDropIndicator(columnsHeaderElement, visibleColumns, event.clientX)
    };
  }

  return { type: 'none' };
}

export function handleWindowPointerUp(
  state: {
    draggedColumnId: LibraryColumnId | null;
    dropIndicator: ColumnDropIndicator | null;
  }
): boolean {
  const { draggedColumnId, dropIndicator } = state;

  if (draggedColumnId && dropIndicator) {
    libraryViewSettings.moveColumn(draggedColumnId, dropIndicator.columnId, dropIndicator.position);
  }

  return Boolean(draggedColumnId);
}

export function toColumnListViewColumns(columns: LibraryPanelColumn[]): ColumnListViewColumn[] {
  return columns.map((column) => ({
    id: column.id,
    label: column.label,
    width: column.width,
    minWidth: LIBRARY_COLUMN_MIN_WIDTHS[column.id],
    icon: getLibraryColumnIcon(column.id),
    rightAligned: isRightAlignedColumn(column.id),
    visible: column.visible
  }));
}
