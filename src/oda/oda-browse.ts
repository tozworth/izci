/**
 * Pure helpers for the Oda music browser.
 *
 * Grouping reuses the desktop library grouping builders, but Oda only reads
 * the resulting data. It never touches the persisted desktop
 * `libraryViewSettings`, so entering a group in Oda cannot rearrange the
 * desktop Library view.
 */

import { buildLibraryGroups, type LibraryGroup } from '$lib/components/track-list-panel/library-views';
import type { LibraryGroupViewId, TrackItem } from '$lib/types';
import type { OdaBrowseView } from '$lib/services/oda-session';

export const ODA_TRACK_FOCUS_PREFIX = 'item:';
export const ODA_GROUP_FOCUS_PREFIX = 'group:';

export function odaTrackFocusId(id: string): string {
  return `${ODA_TRACK_FOCUS_PREFIX}${id}`;
}

export function odaGroupFocusId(key: string): string {
  return `${ODA_GROUP_FOCUS_PREFIX}${key}`;
}

export function odaBrowseTrackId(focusId: string | null | undefined): string | null {
  if (!focusId?.startsWith(ODA_TRACK_FOCUS_PREFIX)) return null;
  return focusId.slice(ODA_TRACK_FOCUS_PREFIX.length);
}

export function odaBrowseGroupKey(focusId: string | null | undefined): string | null {
  if (!focusId?.startsWith(ODA_GROUP_FOCUS_PREFIX)) return null;
  return focusId.slice(ODA_GROUP_FOCUS_PREFIX.length);
}

/** `songs` and `tracks` are flat lists; the others drill into groups. */
export function isOdaGroupedBrowseView(view: OdaBrowseView): view is LibraryGroupViewId {
  return view !== 'tracks' && view !== 'songs';
}

export interface OdaBrowseGroupRow {
  kind: 'group';
  focusId: string;
  key: string;
  label: string;
  secondary: string;
  count: number;
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
    count: group.items.length
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
