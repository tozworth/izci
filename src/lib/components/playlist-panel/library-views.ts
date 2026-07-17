import type { LibraryViewId, PlaylistItem } from '$lib/types';
import { getFolderFromPath, getTrackDisplayTitle } from '$lib/utils/files';
import { filterItemsByQuery, formatTotalDuration, getTotalDuration, matchesSearchQuery } from './search';

export type LibraryGroupViewId = Exclude<LibraryViewId, 'songs'>;

export interface LibraryViewDefinition {
  id: LibraryViewId;
  label: string;
  icon: string;
}

export interface LibraryGroup {
  key: string;
  label: string;
  secondary: string;
  items: PlaylistItem[];
  duration: number;
}

export const LIBRARY_VIEW_DEFINITIONS: LibraryViewDefinition[] = [
  { id: 'songs', label: 'Songs', icon: 'music_note' },
  { id: 'artists', label: 'Artists', icon: 'person' },
  { id: 'albums', label: 'Albums', icon: 'album' },
  { id: 'genres', label: 'Genres', icon: 'category' },
  { id: 'years', label: 'Years', icon: 'calendar_month' },
  { id: 'formats', label: 'Formats', icon: 'extension' },
  { id: 'folders', label: 'Folders', icon: 'folder' }
];

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

function groupKey(view: LibraryGroupViewId, label: string, secondary = ''): string {
  return `${view}:${label.toLowerCase()}\u0000${secondary.toLowerCase()}`;
}

function getGenreValues(item: PlaylistItem): string[] {
  const genre = normalized(item.metadata?.genre);

  if (!genre) return ['Unknown genre'];

  const values = genre
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0
    ? Array.from(new Map(values.map((value) => [value.toLowerCase(), value])).values())
    : ['Unknown genre'];
}

function getYearValue(item: PlaylistItem): string {
  const rawYear = normalized(item.metadata?.year);
  return (rawYear.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? rawYear) || 'Unknown year';
}

function getFolderValues(item: PlaylistItem): { label: string; secondary: string } {
  const folder = normalized(getFolderFromPath(item.path));

  if (!folder) return { label: 'Unknown folder', secondary: '' };

  const segments = folder.split('/').filter(Boolean);
  return {
    label: segments.at(-1) ?? folder,
    secondary: segments.length > 1 ? folder : ''
  };
}

function getGroupValues(
  item: PlaylistItem,
  view: LibraryGroupViewId
): Array<{ label: string; secondary: string }> {
  switch (view) {
    case 'artists':
      return [{ label: normalized(item.metadata?.artist) || 'Unknown artist', secondary: '' }];
    case 'albums': {
      const label = normalized(item.metadata?.album) || 'Unknown album';
      const secondary = normalized(item.metadata?.albumArtist) || normalized(item.metadata?.artist);
      return [{ label, secondary }];
    }
    case 'genres':
      return getGenreValues(item).map((label) => ({ label, secondary: '' }));
    case 'years':
      return [{ label: getYearValue(item), secondary: '' }];
    case 'formats':
      return [{
        label: normalized(item.extension).toUpperCase() || 'Unknown format',
        secondary: item.kind === 'module' ? 'Tracker module' : 'Stream'
      }];
    case 'folders':
      return [getFolderValues(item)];
  }
}

function compareGroups(left: LibraryGroup, right: LibraryGroup, view: LibraryGroupViewId): number {
  const leftUnknown = left.label.toLowerCase().startsWith('unknown ');
  const rightUnknown = right.label.toLowerCase().startsWith('unknown ');

  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;

  if (view === 'years') {
    const yearComparison = Number(right.label) - Number(left.label);
    if (Number.isFinite(yearComparison) && yearComparison !== 0) return yearComparison;
  }

  const labelComparison = collator.compare(left.label, right.label);
  return labelComparison || collator.compare(left.secondary, right.secondary);
}

export function buildLibraryGroups(items: PlaylistItem[], view: LibraryGroupViewId): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();

  for (const item of items) {
    for (const value of getGroupValues(item, view)) {
      const key = groupKey(view, value.label, value.secondary);
      const existing = groups.get(key);

      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          key,
          label: value.label,
          secondary: value.secondary,
          items: [item],
          duration: 0
        });
      }
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort((left, right) =>
        collator.compare(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
      ),
      duration: getTotalDuration(group.items)
    }))
    .sort((left, right) => compareGroups(left, right, view));
}

export function groupMatchesSearchQuery(group: LibraryGroup, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  const groupText = `${group.label}\n${group.secondary}`.toLowerCase();
  const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => groupText.includes(token))
    || group.items.some((item) => matchesSearchQuery(item, normalizedQuery));
}

export function filterLibraryGroups(groups: LibraryGroup[], normalizedQuery: string): LibraryGroup[] {
  return normalizedQuery ? groups.filter((group) => groupMatchesSearchQuery(group, normalizedQuery)) : groups;
}

export function filterLibraryGroupItems(group: LibraryGroup, normalizedQuery: string): PlaylistItem[] {
  const groupText = `${group.label}\n${group.secondary}`.toLowerCase();
  const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);

  if (!normalizedQuery || queryTokens.every((token) => groupText.includes(token))) {
    return group.items;
  }

  return filterItemsByQuery(group.items, normalizedQuery);
}

export function getGroupSummary(
  view: LibraryGroupViewId,
  visibleGroupCount: number,
  totalGroupCount: number,
  songCount: number,
  normalizedQuery: string
): string {
  const label = LIBRARY_VIEW_DEFINITIONS.find((definition) => definition.id === view)?.label.toLocaleLowerCase() ?? 'groups';
  const groupCount = normalizedQuery && visibleGroupCount !== totalGroupCount
    ? `${visibleGroupCount} of ${totalGroupCount}`
    : String(visibleGroupCount);
  return `${groupCount} ${visibleGroupCount === 1 ? label.replace(/s$/, '') : label} · ${songCount} song${songCount === 1 ? '' : 's'}`;
}

export function getGroupTrackSummary(group: LibraryGroup, visibleItems: PlaylistItem[]): string {
  const duration = getTotalDuration(visibleItems);
  const count = visibleItems.length === group.items.length
    ? String(visibleItems.length)
    : `${visibleItems.length} of ${group.items.length}`;
  return `${count} song${group.items.length === 1 ? '' : 's'} · ${formatTotalDuration(duration)}`;
}
