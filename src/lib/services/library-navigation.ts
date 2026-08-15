import { getLibraryGroupIdentities } from '$lib/components/track-list-panel/library-views';
import type { LibraryGroupViewId, TrackItem } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

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
  track: TrackItem,
  libraryItems: TrackItem[]
): TrackItem | null {
  const directMatch = libraryItems.find((item) => item.id === track.id);
  if (directMatch) return directMatch;

  const identity = getTrackIdentity(track);
  return libraryItems.find((item) => getTrackIdentity(item) === identity) ?? null;
}

function findTarget(
  libraryTrack: TrackItem,
  view: Exclude<LibraryGroupViewId, 'folders'>,
  acceptedLabels?: string[]
): TrackLibraryNavigationTarget | null {
  const normalizedLabels = acceptedLabels?.map(normalize).filter(Boolean);
  const trackGroups = getLibraryGroupIdentities(libraryTrack, view);
  const group = normalizedLabels
    ? normalizedLabels
        .map((label) => trackGroups.find((candidate) => normalize(candidate.label) === label))
        .find(Boolean)
    : trackGroups[0];

  return group
    ? { view, groupKey: group.key, trackId: libraryTrack.id }
    : null;
}

export function resolveTrackLibraryNavigationTargets(
  track: TrackItem | null,
  libraryItems: TrackItem[]
): TrackLibraryNavigationTargets {
  if (!track) return {};

  const libraryTrack = findEquivalentLibraryTrack(track, libraryItems);
  if (!libraryTrack) return {};

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
