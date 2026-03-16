import type { LibraryColumnId } from '$lib/types';

export type PlaylistPanelContextMenu =
  | {
      kind: 'items';
      x: number;
      y: number;
      ids: string[];
    }
  | {
      kind: 'columns';
      x: number;
      y: number;
    };

export function clampContextMenuPosition(
  contextMenu: PlaylistPanelContextMenu | null,
  element: HTMLElement | null,
  viewportWidth: number,
  viewportHeight: number
): PlaylistPanelContextMenu | null {
  if (!contextMenu || !element) {
    return contextMenu;
  }

  const padding = 8;
  const minX = padding;
  const minY = padding;
  const maxX = Math.max(padding, viewportWidth - element.offsetWidth - padding);
  const maxY = Math.max(padding, viewportHeight - element.offsetHeight - padding);

  return {
    ...contextMenu,
    x: Math.max(minX, Math.min(contextMenu.x, maxX)),
    y: Math.max(minY, Math.min(contextMenu.y, maxY))
  };
}

export type ColumnVisibilityAction = {
  columnId: LibraryColumnId;
  visible: boolean;
};
