import { getColumnTextValue } from '$lib/components/playlist-panel/library-columns';
import type { LibraryColumnId, PlaylistItem } from '$lib/types';

const DEFAULT_SEARCH_COLUMN_IDS: LibraryColumnId[] = ['title', 'artist', 'format', 'duration'];

function getSearchValues(item: PlaylistItem, columnIds: LibraryColumnId[]): string[] {
  return columnIds
    .map((columnId) => getColumnTextValue(item, columnId).trim())
    .filter((value) => value !== '');
}

export function matchesSearchQuery(
  item: PlaylistItem,
  normalizedQuery: string,
  columnIds: LibraryColumnId[] = DEFAULT_SEARCH_COLUMN_IDS
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const searchValues = getSearchValues(item, columnIds);
  return searchValues.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterItemsByQuery(
  items: PlaylistItem[],
  normalizedQuery: string,
  columnIds: LibraryColumnId[] = DEFAULT_SEARCH_COLUMN_IDS
): PlaylistItem[] {
  return normalizedQuery ? items.filter((item) => matchesSearchQuery(item, normalizedQuery, columnIds)) : items;
}

export function getTotalDuration(items: PlaylistItem[]): number {
  return items.reduce((sum, item) => {
    const duration = item.metadata?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
  }, 0);
}

export function formatTotalDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '--:--';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function getTrackSummary(
  items: PlaylistItem[],
  filteredItems: PlaylistItem[],
  normalizedQuery: string
): string {
  const totalDuration = getTotalDuration(filteredItems);

  if (normalizedQuery && filteredItems.length !== items.length) {
    return `${filteredItems.length} of ${items.length} song${items.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
  }

  return `${filteredItems.length} song${filteredItems.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
}
