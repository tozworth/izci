import { getColumnTextValue } from '$lib/components/track-list-panel/library-columns';
import type { LibraryColumnId, TrackItem } from '$lib/types';

const DEFAULT_SEARCH_COLUMN_IDS: LibraryColumnId[] = ['title', 'artist', 'album', 'folder', 'format', 'duration'];

function getSearchValues(item: TrackItem, columnIds?: LibraryColumnId[]): string[] {
  const columnValues = (columnIds ?? DEFAULT_SEARCH_COLUMN_IDS)
    .map((columnId) => getColumnTextValue(item, columnId).trim())
    .filter((value) => value !== '');

  if (columnIds) {
    return columnValues;
  }

  return [
    ...columnValues,
    item.metadata?.albumArtist?.trim() ?? '',
    item.metadata?.genre?.trim() ?? '',
    item.metadata?.year?.trim() ?? '',
    item.kind === 'module' ? 'tracker module' : item.kind
  ].filter(Boolean);
}

export function matchesSearchQuery(
  item: TrackItem,
  normalizedQuery: string,
  columnIds?: LibraryColumnId[]
): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const haystack = getSearchValues(item, columnIds).join('\n').toLowerCase();
  const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => haystack.includes(token));
}

export function filterItemsByQuery(
  items: TrackItem[],
  normalizedQuery: string,
  columnIds?: LibraryColumnId[]
): TrackItem[] {
  return normalizedQuery ? items.filter((item) => matchesSearchQuery(item, normalizedQuery, columnIds)) : items;
}

export function getTotalDuration(items: TrackItem[]): number {
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
  items: TrackItem[],
  filteredItems: TrackItem[],
  normalizedQuery: string
): string {
  const totalDuration = getTotalDuration(filteredItems);

  if (normalizedQuery && filteredItems.length !== items.length) {
    return `${filteredItems.length} of ${items.length} song${items.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
  }

  return `${filteredItems.length} song${filteredItems.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
}
