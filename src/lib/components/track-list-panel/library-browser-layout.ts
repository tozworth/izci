export const LIBRARY_TILE_GAP = 6;
export const LIBRARY_TILE_PADDING = 6;

export function getLibraryTileMetrics(width: number, tileSize: number, visual: boolean) {
  const available = Math.max(1, width - LIBRARY_TILE_PADDING * 2);
  const columns = Math.max(1, Math.floor((available + LIBRARY_TILE_GAP) / (tileSize + LIBRARY_TILE_GAP)));
  const tileWidth = (available - (columns - 1) * LIBRARY_TILE_GAP) / columns;
  const rowHeight = Math.ceil(tileWidth / (visual ? 1.6 : 1)) + 44;
  return { columns, rowHeight, rowPitch: rowHeight + LIBRARY_TILE_GAP };
}

export function getLibraryTileWindow(count: number, columns: number, rowPitch: number, scrollTop: number, height: number) {
  const rows = Math.ceil(count / columns);
  const startRow = Math.max(0, Math.min(rows, Math.floor(Math.max(0, scrollTop - LIBRARY_TILE_PADDING) / rowPitch) - 2));
  const endRow = Math.max(startRow, Math.min(rows, Math.ceil((scrollTop + height) / rowPitch) + 2));
  return {
    start: startRow * columns,
    end: endRow * columns,
    top: LIBRARY_TILE_PADDING + startRow * rowPitch,
    height: LIBRARY_TILE_PADDING * 2 + Math.max(0, rows * rowPitch - LIBRARY_TILE_GAP)
  };
}

export function getLibraryTileNavigationIndex(index: number, count: number, columns: number, key: string): number {
  const delta = key === 'ArrowUp' ? -columns : key === 'ArrowDown' ? columns
    : key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  if ((key === 'ArrowLeft' && index % columns === 0)
    || (key === 'ArrowRight' && index % columns === columns - 1)) return index;
  return Math.max(0, Math.min(count - 1, index + delta));
}
