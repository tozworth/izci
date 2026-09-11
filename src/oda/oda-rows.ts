/**
 * Pure display-row models shared by the Oda list and browse views.
 *
 * Rows carry a stable focus ID and flatten whatever data the route owns into
 * one presenter shape. Keeping this pure makes list rendering testable without
 * a browser and keeps the windowing component dumb.
 */

import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
import type { LibraryGroupViewId, TrackItem } from '$lib/types';
import { buildOdaBrowseGroupRows, odaTrackFocusId } from './oda-browse';

export interface OdaDisplayRow {
  focusId: string;
  title: string;
  meta: string;
  trailing: string;
  playing: boolean;
}

function trackMeta(track: TrackItem): string {
  return [track.metadata?.artist?.trim(), track.metadata?.album?.trim()]
    .filter(Boolean)
    .join(' · ');
}

function trackDuration(track: TrackItem): string {
  const seconds = track.metadata?.duration;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? formatDuration(seconds)
    : '';
}

export function buildOdaTrackDisplayRows(
  items: readonly TrackItem[],
  playingId: string | null = null
): OdaDisplayRow[] {
  return items.map((track) => ({
    focusId: odaTrackFocusId(track.id),
    title: getTrackDisplayTitle(track) || track.name,
    meta: trackMeta(track),
    trailing: trackDuration(track),
    playing: playingId !== null && track.id === playingId
  }));
}

export function buildOdaGroupDisplayRows(
  items: readonly TrackItem[],
  view: LibraryGroupViewId,
  locale?: string
): OdaDisplayRow[] {
  return buildOdaBrowseGroupRows(items, view, locale).map((row) => ({
    focusId: row.focusId,
    title: row.label,
    meta: row.secondary,
    trailing: String(row.count),
    playing: false
  }));
}
