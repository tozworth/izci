import { getLibraryGroupIdentities } from '$lib/components/playlist-panel/library-views';
import type { LibraryGroupViewId, PlaylistItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';
import { logDebug, logError, logInfo } from '$lib/services/logging';

export const TRACK_LIBRARY_NAVIGATION_FIELDS = [
  'artist',
  'album',
  'genre',
  'year',
  'format'
] as const;

export type TrackLibraryNavigationField = typeof TRACK_LIBRARY_NAVIGATION_FIELDS[number];

export interface TrackLibraryNavigationTarget {
  view: LibraryGroupViewId;
  groupKey: string;
  trackId: string;
}

export type TrackLibraryNavigationTargets = Partial<
  Record<TrackLibraryNavigationField, TrackLibraryNavigationTarget>
>;

function normalize(value: string | undefined): string {
  return value?.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() ?? '';
}

function findEquivalentLibraryTrack(
  track: PlaylistItem,
  libraryItems: PlaylistItem[]
): PlaylistItem | null {
  const directMatch = libraryItems.find((item) => item.id === track.id);
  if (directMatch) return directMatch;

  const identity = getTrackIdentity(track);
  return libraryItems.find((item) => getTrackIdentity(item) === identity) ?? null;
}

function findTarget(
  libraryTrack: PlaylistItem,
  view: Exclude<LibraryGroupViewId, 'folders'>,
  acceptedLabels?: string[]
): TrackLibraryNavigationTarget | null {
  const normalizedLabels = acceptedLabels?.map(normalize).filter(Boolean);
  let trackGroups: Array<{ key: string; label: string }>;

  try {
    trackGroups = getLibraryGroupIdentities(libraryTrack, view);
  } catch (error) {
    logError('library', 'library group identity lookup failed', {
      view,
      trackId: libraryTrack.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }

  const group = normalizedLabels
    ? normalizedLabels
        .map((label) => trackGroups.find((candidate) => normalize(candidate.label) === label))
        .find(Boolean)
    : trackGroups[0];

  if (group) {
    logDebug('library', 'library group navigation target', {
      view,
      groupKey: group.key,
      trackId: libraryTrack.id
    });
    return { view, groupKey: group.key, trackId: libraryTrack.id };
  }

  return null;
}

export function resolveTrackLibraryNavigationTargets(
  track: PlaylistItem | null,
  libraryItems: PlaylistItem[]
): TrackLibraryNavigationTargets {
  if (!track) return {};

  const libraryTrack = findEquivalentLibraryTrack(track, libraryItems);
  if (!libraryTrack) return {};

  logInfo('library', 'library navigation activated', { trackId: libraryTrack.id });
  const targets: TrackLibraryNavigationTargets = {};
  const artist = track.metadata?.artist?.trim();
  const album = track.metadata?.album?.trim();
  const genres = track.metadata?.genre
    ?.split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (artist) {
    targets.artist = findTarget(libraryTrack, 'artists', [artist]) ?? undefined;
  }
  if (album) {
    targets.album = findTarget(libraryTrack, 'albums', [album]) ?? undefined;
  }
  if (genres?.length) {
    targets.genre = findTarget(libraryTrack, 'genres', genres) ?? undefined;
  }
  if (track.metadata?.year?.trim()) {
    const rawYear = track.metadata.year.trim();
    const year = rawYear.match(/\b(?:18|19|20|21)\d{2}\b/)?.[0] ?? rawYear;
    targets.year = findTarget(libraryTrack, 'years', [year]) ?? undefined;
  }

  targets.format = findTarget(libraryTrack, 'formats') ?? undefined;
  return targets;
}
