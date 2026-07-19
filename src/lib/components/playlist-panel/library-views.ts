import type { LibraryViewId, PlaylistItem } from '$lib/types';
import { getFolderFromPath, getTrackDisplayTitle } from '$lib/utils/files';
import { filterItemsByQuery, formatTotalDuration, getTotalDuration, matchesSearchQuery } from './search';

export type LibraryGroupViewId = Exclude<LibraryViewId, 'favorites' | 'songs'>;

export interface LibraryViewDefinition {
  id: LibraryViewId;
  label: string;
  icon: string;
}

export interface LibraryGroup {
  key: string;
  label: string;
  secondary: string;
  placeholder?: 'artist' | 'album' | 'genre' | 'year' | 'format' | 'folder';
  secondaryKind?: 'trackerModule' | 'stream';
  items: PlaylistItem[];
  duration: number;
}

type LibraryGroupValue = Pick<LibraryGroup, 'label' | 'secondary' | 'placeholder' | 'secondaryKind'>;

export const LIBRARY_VIEW_DEFINITIONS: LibraryViewDefinition[] = [
  { id: 'favorites', label: 'Favorites', icon: 'favorite' },
  { id: 'songs', label: 'Songs', icon: 'music_note' },
  { id: 'artists', label: 'Artists', icon: 'person' },
  { id: 'albums', label: 'Albums', icon: 'album' },
  { id: 'genres', label: 'Genres', icon: 'category' },
  { id: 'years', label: 'Years', icon: 'calendar_month' },
  { id: 'formats', label: 'Formats', icon: 'extension' },
  { id: 'folders', label: 'Folders', icon: 'folder' }
];

const collators = new Map<string, Intl.Collator>();

function getCollator(locale?: string): Intl.Collator {
  const key = locale ?? '';
  const existing = collators.get(key);
  if (existing) return existing;

  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  collators.set(key, collator);
  return collator;
}

function normalized(value: string | undefined): string {
  return value?.trim() ?? '';
}

function groupKey(view: LibraryGroupViewId, label: string, secondary = ''): string {
  return `${view}:${label.toLowerCase()}\u0000${secondary.toLowerCase()}`;
}

function getGenreValues(item: PlaylistItem): LibraryGroupValue[] {
  const genre = normalized(item.metadata?.genre);

  if (!genre) return [{ label: 'Unknown genre', secondary: '', placeholder: 'genre' }];

  const values = genre
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0
    ? Array.from(new Map(values.map((value) => [value.toLowerCase(), value])).values())
        .map((label) => ({ label, secondary: '' }))
    : [{ label: 'Unknown genre', secondary: '', placeholder: 'genre' }];
}

function getYearValue(item: PlaylistItem): LibraryGroupValue {
  const rawYear = normalized(item.metadata?.year);
  const year = rawYear.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? rawYear;
  return year
    ? { label: year, secondary: '' }
    : { label: 'Unknown year', secondary: '', placeholder: 'year' };
}

function getFolderValues(item: PlaylistItem): LibraryGroupValue {
  const folder = normalized(getFolderFromPath(item.path));

  if (!folder) return { label: 'Unknown folder', secondary: '', placeholder: 'folder' };

  const segments = folder.split('/').filter(Boolean);
  return {
    label: segments.at(-1) ?? folder,
    secondary: segments.length > 1 ? folder : ''
  };
}

function getGroupValues(
  item: PlaylistItem,
  view: LibraryGroupViewId
): LibraryGroupValue[] {
  switch (view) {
    case 'artists':
      return normalized(item.metadata?.artist)
        ? [{ label: normalized(item.metadata?.artist), secondary: '' }]
        : [{ label: 'Unknown artist', secondary: '', placeholder: 'artist' }];
    case 'albums': {
      const album = normalized(item.metadata?.album);
      const label = album || 'Unknown album';
      const secondary = normalized(item.metadata?.albumArtist) || normalized(item.metadata?.artist);
      return [{ label, secondary, placeholder: album ? undefined : 'album' }];
    }
    case 'genres':
      return getGenreValues(item);
    case 'years':
      return [getYearValue(item)];
    case 'formats':
      return normalized(item.extension)
        ? [{
            label: normalized(item.extension).toUpperCase(),
            secondary: item.kind === 'module' ? 'Tracker module' : 'Stream',
            secondaryKind: item.kind === 'module' ? 'trackerModule' : 'stream'
          }]
        : [{
            label: 'Unknown format',
            secondary: item.kind === 'module' ? 'Tracker module' : 'Stream',
            placeholder: 'format',
            secondaryKind: item.kind === 'module' ? 'trackerModule' : 'stream'
          }];
    case 'folders':
      return [getFolderValues(item)];
  }
}

function compareGroups(
  left: LibraryGroup,
  right: LibraryGroup,
  view: LibraryGroupViewId,
  collator: Intl.Collator
): number {
  const leftUnknown = Boolean(left.placeholder);
  const rightUnknown = Boolean(right.placeholder);

  if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;

  if (view === 'years') {
    const yearComparison = Number(right.label) - Number(left.label);
    if (Number.isFinite(yearComparison) && yearComparison !== 0) return yearComparison;
  }

  const labelComparison = collator.compare(left.label, right.label);
  return labelComparison || collator.compare(left.secondary, right.secondary);
}

export function buildLibraryGroups(
  items: PlaylistItem[],
  view: LibraryGroupViewId,
  locale?: string
): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  const collator = getCollator(locale);

  for (const item of items) {
    for (const value of getGroupValues(item, view)) {
      const key = groupKey(
        view,
        value.placeholder ? `__unknown:${value.placeholder}` : value.label,
        value.secondaryKind ? `__kind:${value.secondaryKind}` : value.secondary
      );
      const existing = groups.get(key);

      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          key,
          label: value.label,
          secondary: value.secondary,
          placeholder: value.placeholder,
          secondaryKind: value.secondaryKind,
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
    .sort((left, right) => compareGroups(left, right, view, collator));
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

export function getLibraryViewTooltipDetails(
  items: PlaylistItem[],
  favoriteItems: PlaylistItem[],
  normalizedQuery: string,
  locale?: string
): Record<LibraryViewId, string> {
  const filteredSongs = filterItemsByQuery(items, normalizedQuery);
  const filteredFavorites = filterItemsByQuery(favoriteItems, normalizedQuery);
  const songCount = normalizedQuery && filteredSongs.length !== items.length
    ? `${filteredSongs.length} of ${items.length}`
    : String(filteredSongs.length);
  const details = {
    favorites: String(filteredFavorites.length),
    songs: `${songCount} · ${formatTotalDuration(getTotalDuration(filteredSongs))}`
  } as Record<LibraryViewId, string>;

  for (const definition of LIBRARY_VIEW_DEFINITIONS) {
    if (definition.id === 'favorites' || definition.id === 'songs') continue;

    const groups = buildLibraryGroups(items, definition.id, locale);
    const visibleGroups = filterLibraryGroups(groups, normalizedQuery);
    const groupCount = normalizedQuery && visibleGroups.length !== groups.length
      ? `${visibleGroups.length} of ${groups.length}`
      : String(visibleGroups.length);

    details[definition.id] = groupCount;
  }

  return details;
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
