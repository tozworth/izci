/**
 * Pure helpers for the Oda music browser.
 *
 * Grouping reuses the desktop library grouping builders, but Oda only reads
 * the resulting data. It never touches the persisted desktop
 * `libraryViewSettings`, so entering a group in Oda cannot rearrange the
 * desktop Library view.
 */

import { buildLibraryGroups, type LibraryGroup } from '$lib/components/track-list-panel/library-views';
import type { LibraryGroupViewId, OdaBrowserLayout, TrackItem } from '$lib/types';
import type { OdaBrowseView } from '$lib/services/oda-session';
import type { OdaMedium } from '$lib/services/oda-session';

export const ODA_TRACK_FOCUS_PREFIX = 'item:';
export const ODA_GROUP_FOCUS_PREFIX = 'group:';
export const ODA_BROWSER_FILTER_FOCUS_PREFIX = 'browse-filter:';
export const ODA_BROWSER_LAYOUT_FOCUS_PREFIX = 'browse-layout:';
export const ODA_BROWSER_ZOOM_FOCUS_PREFIX = 'browse-zoom:';

const ODA_GRID_COLUMNS = [7, 6, 4, 3, 2] as const;
const ODA_GALLERY_COLUMNS = [8, 6, 5, 4, 3] as const;
const ODA_LIST_ROW_HEIGHTS = [48, 60, 72, 88, 108] as const;

function clampZoomLevel(level: number): number {
  return Math.min(Math.max(Math.round(level), 0), 4);
}

export function resolveOdaBrowserColumns(layout: OdaBrowserLayout, zoomLevel: number): number {
  const level = clampZoomLevel(zoomLevel);
  if (layout === 'list') return 1;
  return (layout === 'gallery' ? ODA_GALLERY_COLUMNS : ODA_GRID_COLUMNS)[level];
}

export function resolveOdaBrowserListRowHeight(zoomLevel: number): number {
  return ODA_LIST_ROW_HEIGHTS[clampZoomLevel(zoomLevel)];
}

/** Keep portrait/panorama outliers useful in a dense collage. */
export function resolveOdaGalleryAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 4 / 3;
  return Math.min(Math.max(width / height, 0.5), 2.4);
}

export const ODA_MUSIC_BROWSER_VIEWS: readonly OdaBrowseView[] = [
  'songs',
  'albums',
  'artists',
  'genres',
  'years',
  'formats',
  'folders'
];

export function odaTrackFocusId(id: string): string {
  return `${ODA_TRACK_FOCUS_PREFIX}${id}`;
}

export function odaGroupFocusId(key: string): string {
  return `${ODA_GROUP_FOCUS_PREFIX}${key}`;
}

export function odaBrowserFilterFocusId(medium: OdaMedium, view: OdaBrowseView): string {
  return `${ODA_BROWSER_FILTER_FOCUS_PREFIX}${medium}:${view}`;
}

export function odaBrowserLayoutFocusId(layout: OdaBrowserLayout): string {
  return `${ODA_BROWSER_LAYOUT_FOCUS_PREFIX}${layout}`;
}

export function odaBrowserZoomFocusId(direction: 'out' | 'in'): string {
  return `${ODA_BROWSER_ZOOM_FOCUS_PREFIX}${direction}`;
}

export function odaBrowserLayoutFromFocusId(
  focusId: string | null | undefined
): OdaBrowserLayout | null {
  if (!focusId?.startsWith(ODA_BROWSER_LAYOUT_FOCUS_PREFIX)) return null;
  const layout = focusId.slice(ODA_BROWSER_LAYOUT_FOCUS_PREFIX.length);
  return layout === 'list' || layout === 'grid' || layout === 'gallery' ? layout : null;
}

export function odaBrowserZoomFromFocusId(
  focusId: string | null | undefined
): 'out' | 'in' | null {
  if (!focusId?.startsWith(ODA_BROWSER_ZOOM_FOCUS_PREFIX)) return null;
  const direction = focusId.slice(ODA_BROWSER_ZOOM_FOCUS_PREFIX.length);
  return direction === 'out' || direction === 'in' ? direction : null;
}

export function odaBrowserFilterFromFocusId(
  focusId: string | null | undefined
): { medium: OdaMedium; view: OdaBrowseView } | null {
  if (!focusId?.startsWith(ODA_BROWSER_FILTER_FOCUS_PREFIX)) return null;
  const [medium, view] = focusId.slice(ODA_BROWSER_FILTER_FOCUS_PREFIX.length).split(':');
  if (medium !== 'music' && medium !== 'video' && medium !== 'image') return null;
  if (![...ODA_MUSIC_BROWSER_VIEWS].includes(view as OdaBrowseView)) return null;
  return { medium, view: view as OdaBrowseView };
}

export function resolveOdaBrowserViews(medium: OdaMedium): readonly OdaBrowseView[] {
  return medium === 'music' ? ODA_MUSIC_BROWSER_VIEWS : ['songs'];
}

export function odaBrowseTrackId(focusId: string | null | undefined): string | null {
  if (!focusId?.startsWith(ODA_TRACK_FOCUS_PREFIX)) return null;
  return focusId.slice(ODA_TRACK_FOCUS_PREFIX.length);
}

export function odaBrowseGroupKey(focusId: string | null | undefined): string | null {
  if (!focusId?.startsWith(ODA_GROUP_FOCUS_PREFIX)) return null;
  return focusId.slice(ODA_GROUP_FOCUS_PREFIX.length);
}

/** `songs` is a flat collection; the other music filters drill into groups. */
export function isOdaGroupedBrowseView(view: OdaBrowseView): view is LibraryGroupViewId {
  return view !== 'songs';
}

export interface OdaBrowseGroupRow {
  kind: 'group';
  focusId: string;
  key: string;
  label: string;
  secondary: string;
  count: number;
  items: TrackItem[];
}

export interface OdaBrowseTrackRow {
  kind: 'track';
  focusId: string;
  track: TrackItem;
}

export type OdaBrowseRow = OdaBrowseGroupRow | OdaBrowseTrackRow;

export function buildOdaBrowseGroupRows(
  items: readonly TrackItem[],
  view: LibraryGroupViewId,
  locale?: string
): OdaBrowseGroupRow[] {
  return buildLibraryGroups([...items], view, locale).map((group) => ({
    kind: 'group',
    focusId: odaGroupFocusId(group.key),
    key: group.key,
    label: group.label,
    secondary: group.secondary,
    count: group.items.length,
    items: group.items
  }));
}

/** Resolve the tracks of a group, or null when the group no longer exists. */
export function resolveOdaBrowseGroup(
  items: readonly TrackItem[],
  view: LibraryGroupViewId,
  groupKey: string,
  locale?: string
): LibraryGroup | null {
  return buildLibraryGroups([...items], view, locale)
    .find((group) => group.key === groupKey) ?? null;
}

export function buildOdaBrowseTrackRows(items: readonly TrackItem[]): OdaBrowseTrackRow[] {
  return items.map((track) => ({
    kind: 'track',
    focusId: odaTrackFocusId(track.id),
    track
  }));
}
