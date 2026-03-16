import type { PlaylistItem } from '$lib/types';
import { resolveModuleTrackerName } from '$lib/utils/files';

const EXCLUDED_SEARCH_ROOT_KEYS = new Set(['id', 'file', 'fileHandle', 'objectUrl', 'extension']);
const EXCLUDED_METADATA_SEARCH_KEYS = new Set(['duration']);

function collectSearchValues(value: unknown, excludedKeys: Set<string> | null = null): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSearchValues(entry));
  }

  if (typeof value !== 'object') {
    return [];
  }

  return Object.entries(value).flatMap(([key, entry]) => {
    if (excludedKeys?.has(key)) {
      return [];
    }

    if (key === 'metadata' && entry && typeof entry === 'object') {
      return collectSearchValues(entry, EXCLUDED_METADATA_SEARCH_KEYS);
    }

    return collectSearchValues(entry);
  });
}

export function matchesSearchQuery(item: PlaylistItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  const searchValues = [
    ...collectSearchValues(item, EXCLUDED_SEARCH_ROOT_KEYS),
    resolveModuleTrackerName(item.extension, item.metadata?.trackerType)
  ];

  return searchValues.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

export function filterItemsByQuery(items: PlaylistItem[], normalizedQuery: string): PlaylistItem[] {
  return normalizedQuery ? items.filter((item) => matchesSearchQuery(item, normalizedQuery)) : items;
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
