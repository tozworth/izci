import type { LibraryGroupViewId, LibraryViewId, TrackItem } from '$lib/types';
import { getFolderFromPath, getTrackDisplayTitle } from '$lib/utils/files';
import { filterItemsByQuery, formatTotalDuration, getTotalDuration, matchesSearchQuery } from './search';
import { normalizeTrackRating } from '$lib/services/track-ratings';

export type { LibraryGroupViewId } from '$lib/types';

interface LibraryViewDefinition {
  id: LibraryViewId;
  label: string;
  icon: string;
}

export interface LibraryGroup {
  key: string;
  label: string;
  secondary: string;
  parentKey?: string;
  depth?: number;
  hasChildren?: boolean;
  placeholder?: 'artist' | 'album' | 'genre' | 'year' | 'format' | 'folder';
  secondaryKind?: 'trackerModule' | 'stream' | 'video' | 'image';
  items: TrackItem[];
  duration: number;
}

type LibraryGroupValue = Pick<LibraryGroup, 'label' | 'secondary' | 'placeholder' | 'secondaryKind'>;

export const LIBRARY_VIEW_DEFINITIONS: LibraryViewDefinition[] = [
  { id: 'favorites', label: 'Favorites', icon: 'favorite' },
  { id: 'ratings', label: 'Ratings', icon: 'star' },
  { id: 'allMedia', label: 'All Media', icon: 'perm_media' },
  { id: 'songs', label: 'Songs', icon: 'music_note' },
  { id: 'images', label: 'Images', icon: 'image' },
  { id: 'videos', label: 'Videos', icon: 'movie' },
  { id: 'artists', label: 'Artists', icon: 'person' },
  { id: 'albums', label: 'Albums', icon: 'album' },
  { id: 'genres', label: 'Genres', icon: 'category' },
  { id: 'years', label: 'Years', icon: 'calendar_month' },
  { id: 'formats', label: 'Formats', icon: 'extension' },
  { id: 'folders', label: 'Folders', icon: 'folder' }
];

const LIBRARY_FLAT_VIEW_IDS: LibraryViewId[] = [
  'favorites',
  'ratings',
  'allMedia',
  'songs',
  'images',
  'videos'
];

export function isLibraryFlatView(view: LibraryViewId): boolean {
  return LIBRARY_FLAT_VIEW_IDS.includes(view);
}

export function isLibraryGroupView(view: LibraryViewId): view is LibraryGroupViewId {
  return !LIBRARY_FLAT_VIEW_IDS.includes(view);
}

export function filterLibraryViewItems(items: TrackItem[], view: LibraryViewId): TrackItem[] {
  switch (view) {
    case 'songs':
      return items.filter((item) => item.kind !== 'image' && item.kind !== 'video');
    case 'images':
      return items.filter((item) => item.kind === 'image');
    case 'videos':
      return items.filter((item) => item.kind === 'video');
    default:
      return items;
  }
}

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

function getPrimaryArtist(item: TrackItem): string {
  return normalized(item.metadata?.albumArtist) || normalized(item.metadata?.artist);
}

function groupKey(view: LibraryGroupViewId, label: string, secondary = ''): string {
  return `${view}:${label.toLowerCase()}\u0000${secondary.toLowerCase()}`;
}

function getGenreValues(item: TrackItem): LibraryGroupValue[] {
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

function getYearValue(item: TrackItem): LibraryGroupValue {
  const rawYear = normalized(item.metadata?.year);
  const year = rawYear.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? rawYear;
  return year
    ? { label: year, secondary: '' }
    : { label: 'Unknown year', secondary: '', placeholder: 'year' };
}

function getGroupValues(
  item: TrackItem,
  view: LibraryGroupViewId
): LibraryGroupValue[] {
  switch (view) {
    case 'artists': {
      const artist = getPrimaryArtist(item);
      return artist
        ? [{ label: artist, secondary: '' }]
        : [{ label: 'Unknown artist', secondary: '', placeholder: 'artist' }];
    }
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
            secondary: item.kind === 'module' ? 'Tracker module' : item.kind === 'video' ? 'Video' : item.kind === 'image' ? 'Image' : 'Stream',
            secondaryKind: item.kind === 'module' ? 'trackerModule' : item.kind
          }]
        : [{
            label: 'Unknown format',
            secondary: item.kind === 'module' ? 'Tracker module' : item.kind === 'video' ? 'Video' : item.kind === 'image' ? 'Image' : 'Stream',
            placeholder: 'format',
            secondaryKind: item.kind === 'module' ? 'trackerModule' : item.kind
          }];
    case 'folders':
      return [];
  }
}

export function getLibraryGroupIdentities(
  item: TrackItem,
  view: Exclude<LibraryGroupViewId, 'folders'>
): Array<Pick<LibraryGroup, 'key' | 'label'>> {
  return getGroupValues(item, view).map((value) => ({
    key: groupKey(
      view,
      value.placeholder ? `__unknown:${value.placeholder}` : value.label,
      value.secondaryKind ? `__kind:${value.secondaryKind}` : value.secondary
    ),
    label: value.label
  }));
}

function buildFolderGroups(items: TrackItem[], collator: Intl.Collator): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();

  for (const item of items) {
    const folder = normalized(getFolderFromPath(item.path));

    if (!folder) {
      const key = groupKey('folders', '__unknown:folder');
      const existing = groups.get(key);
      if (existing) existing.items.push(item);
      else groups.set(key, {
        key,
        label: 'Unknown folder',
        secondary: '',
        placeholder: 'folder',
        items: [item],
        duration: 0,
        depth: 0,
        hasChildren: false
      });
      continue;
    }

    const segments = folder.split('/').filter(Boolean);
    let parentKey: string | undefined;

    for (let index = 0; index < segments.length; index += 1) {
      const path = segments.slice(0, index + 1).join('/');
      const key = groupKey('folders', path);
      const existing = groups.get(key);

      if (existing) {
        existing.items.push(item);
      } else {
        groups.set(key, {
          key,
          label: segments[index],
          secondary: '',
          parentKey,
          depth: index,
          hasChildren: false,
          items: [item],
          duration: 0
        });
      }

      if (parentKey) {
        const parent = groups.get(parentKey);
        if (parent) parent.hasChildren = true;
      }
      parentKey = key;
    }
  }

  const finalized = new Map(
    Array.from(groups.values()).map((group) => [group.key, {
      ...group,
      items: [...group.items].sort((left, right) =>
        collator.compare(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
      ),
      duration: getTotalDuration(group.items)
    }])
  );
  const childrenByParent = new Map<string | undefined, LibraryGroup[]>();

  for (const group of finalized.values()) {
    const siblings = childrenByParent.get(group.parentKey) ?? [];
    siblings.push(group);
    childrenByParent.set(group.parentKey, siblings);
  }

  const ordered: LibraryGroup[] = [];
  const visit = (parentKey: string | undefined) => {
    const children = childrenByParent.get(parentKey) ?? [];
    children.sort((left, right) => compareGroups(left, right, 'folders', collator));
    for (const child of children) {
      ordered.push(child);
      visit(child.key);
    }
  };
  visit(undefined);
  return ordered;
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
  items: TrackItem[],
  view: LibraryGroupViewId,
  locale?: string
): LibraryGroup[] {
  const groups = new Map<string, LibraryGroup>();
  const collator = getCollator(locale);

  if (view === 'folders') return buildFolderGroups(items, collator);

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

export function countLibraryGroups(items: TrackItem[], view: LibraryGroupViewId): number {
  const keys = new Set<string>();

  if (view === 'folders') {
    for (const item of items) {
      const folder = normalized(getFolderFromPath(item.path));

      if (!folder) {
        keys.add(groupKey('folders', '__unknown:folder'));
        continue;
      }

      const segments = folder.split('/').filter(Boolean);
      for (let index = 0; index < segments.length; index += 1) {
        keys.add(groupKey('folders', segments.slice(0, index + 1).join('/')));
      }
    }

    return keys.size;
  }

  for (const item of items) {
    for (const value of getGroupValues(item, view)) {
      keys.add(groupKey(
        view,
        value.placeholder ? `__unknown:${value.placeholder}` : value.label,
        value.secondaryKind ? `__kind:${value.secondaryKind}` : value.secondary
      ));
    }
  }

  return keys.size;
}

function groupMatchesSearchQuery(group: LibraryGroup, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  const groupText = `${group.label}\n${group.secondary}`.toLowerCase();
  const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);
  return queryTokens.every((token) => groupText.includes(token))
    || group.items.some((item) => matchesSearchQuery(item, normalizedQuery));
}

export function filterLibraryGroups(groups: LibraryGroup[], normalizedQuery: string): LibraryGroup[] {
  if (!normalizedQuery) return groups;

  const matchingKeys = new Set(
    groups.filter((group) => groupMatchesSearchQuery(group, normalizedQuery)).map((group) => group.key)
  );
  const groupsByKey = new Map(groups.map((group) => [group.key, group]));

  for (const key of [...matchingKeys]) {
    let parentKey = groupsByKey.get(key)?.parentKey;
    while (parentKey) {
      matchingKeys.add(parentKey);
      parentKey = groupsByKey.get(parentKey)?.parentKey;
    }
  }

  return groups.filter((group) => matchingKeys.has(group.key));
}

export function orderLibraryGroups(groups: LibraryGroup[], pinnedKeys: string[]): LibraryGroup[] {
  if (pinnedKeys.length === 0) return groups;

  const groupsByKey = new Map(groups.map((group) => [group.key, group]));
  const pinnedKeySet = new Set(pinnedKeys);
  const pinnedGroups = pinnedKeys.flatMap((key) => {
    const group = groupsByKey.get(key);
    return group ? [group] : [];
  });

  return [...pinnedGroups, ...groups.filter((group) => !pinnedKeySet.has(group.key))];
}

export function getLibraryViewTooltipDetails(
  items: TrackItem[],
  favoriteItems: TrackItem[],
  normalizedQuery: string,
  locale?: string
): Record<LibraryViewId, string> {
  const filteredFavorites = filterItemsByQuery(favoriteItems, normalizedQuery);
  const ratedItems = items.filter((item) => normalizeTrackRating(item.rating) !== undefined);
  const filteredRatings = filterItemsByQuery(ratedItems, normalizedQuery);
  const flatViews: LibraryViewId[] = ['allMedia', 'songs', 'images', 'videos'];
  const details = {
    favorites: String(filteredFavorites.length),
    ratings: `${filteredRatings.length} · ${formatTotalDuration(getTotalDuration(filteredRatings))}`
  } as Record<LibraryViewId, string>;

  for (const view of flatViews) {
    const viewItems = filterLibraryViewItems(items, view);
    const filteredViewItems = filterItemsByQuery(viewItems, normalizedQuery);
    const count = normalizedQuery && filteredViewItems.length !== viewItems.length
      ? `${filteredViewItems.length} of ${viewItems.length}`
      : String(filteredViewItems.length);
    details[view] = `${count} · ${formatTotalDuration(getTotalDuration(filteredViewItems))}`;
  }

  for (const definition of LIBRARY_VIEW_DEFINITIONS) {
    if (!isLibraryGroupView(definition.id)) continue;

    if (!normalizedQuery) {
      details[definition.id] = String(countLibraryGroups(items, definition.id));
      continue;
    }

    const groups = buildLibraryGroups(items, definition.id, locale);
    const visibleGroups = filterLibraryGroups(groups, normalizedQuery);
    const groupCount = normalizedQuery && visibleGroups.length !== groups.length
      ? `${visibleGroups.length} of ${groups.length}`
      : String(visibleGroups.length);

    details[definition.id] = groupCount;
  }

  return details;
}

export function filterLibraryGroupItems(group: LibraryGroup, normalizedQuery: string): TrackItem[] {
  const groupText = `${group.label}\n${group.secondary}`.toLowerCase();
  const queryTokens = normalizedQuery.toLowerCase().split(/\s+/).filter(Boolean);

  if (!normalizedQuery || queryTokens.every((token) => groupText.includes(token))) {
    return group.items;
  }

  return filterItemsByQuery(group.items, normalizedQuery);
}
