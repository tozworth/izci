import type { MenuActionItem, PlaylistItem, WorkspaceCollection } from '$lib/types';
import {
  resolveTrackLibraryNavigationTargets,
  TRACK_LIBRARY_NAVIGATION_FIELDS,
  type TrackLibraryNavigationField,
  type TrackLibraryNavigationTarget
} from '$lib/services/library-navigation';
import { getFavoriteIdentity, getTrackIdentity } from '$lib/utils/files';
import { buildTrackRatingAction } from '$lib/services/track-ratings';

const GO_TO_LIBRARY_ACTION_PREFIX = 'go-to-library-';

const libraryNavigationActionPresentation: Record<
  TrackLibraryNavigationField,
  Pick<MenuActionItem, 'label' | 'icon'>
> = {
  artist: { label: 'Artist', icon: 'person' },
  album: { label: 'Album', icon: 'album' },
  genre: { label: 'Genre', icon: 'category' },
  year: { label: 'Year', icon: 'calendar_month' },
  format: { label: 'Format', icon: 'equalizer' }
};

export function getOtherWorkspaceCollection(
  collection: WorkspaceCollection
): WorkspaceCollection {
  return collection === 'library' ? 'playlist' : 'library';
}

export function buildSelectedWorkspaceTracks(
  items: PlaylistItem[],
  ids: string[]
): PlaylistItem[] {
  if (ids.length === 0) {
    return [];
  }

  const idSet = new Set(ids);
  return items.filter((item) => idSet.has(item.id));
}

export function libraryHasAllTracks(
  libraryItems: PlaylistItem[],
  tracks: PlaylistItem[]
): boolean {
  if (tracks.length === 0) {
    return false;
  }

  const libraryKeys = new Set(libraryItems.map((item) => getTrackIdentity(item)));
  return tracks.every((track) => libraryKeys.has(getTrackIdentity(track)));
}

export function getEquivalentLibraryIds(
  libraryItems: PlaylistItem[],
  tracks: PlaylistItem[]
): string[] {
  if (tracks.length === 0) {
    return [];
  }

  const trackKeys = new Set(tracks.map((track) => getTrackIdentity(track)));
  return libraryItems
    .filter((item) => trackKeys.has(getTrackIdentity(item)))
    .map((item) => item.id);
}

export function favoritesHaveAllTracks(
  favoriteItems: PlaylistItem[],
  tracks: PlaylistItem[]
): boolean {
  if (tracks.length === 0) {
    return false;
  }

  const favoriteKeys = new Set(favoriteItems.map((item) => getFavoriteIdentity(item)));
  return tracks.every((track) => favoriteKeys.has(getFavoriteIdentity(track)));
}

export function getEquivalentFavoriteIds(
  favoriteItems: PlaylistItem[],
  tracks: PlaylistItem[]
): string[] {
  const trackKeys = new Set(tracks.map((track) => getFavoriteIdentity(track)));
  return favoriteItems
    .filter((item) => trackKeys.has(getFavoriteIdentity(item)))
    .map((item) => item.id);
}

function buildFavoriteToggleAction(
  favoriteItems: PlaylistItem[],
  tracks: PlaylistItem[]
): MenuActionItem {
  const favorite = favoritesHaveAllTracks(favoriteItems, tracks);

  return {
    id: 'toggle-favorite',
    label: favorite ? 'Remove from favorites' : 'Add to favorites',
    icon: favorite ? 'heart_minus' : 'favorite'
  };
}

function buildGoToLibraryAction(
  track: PlaylistItem | undefined,
  libraryItems: PlaylistItem[]
): MenuActionItem | null {
  if (!track) return null;

  const targets = resolveTrackLibraryNavigationTargets(track, libraryItems);
  const children = TRACK_LIBRARY_NAVIGATION_FIELDS.flatMap((field) => {
    if (!targets[field]) return [];
    return [{
      id: `${GO_TO_LIBRARY_ACTION_PREFIX}${field}`,
      ...libraryNavigationActionPresentation[field]
    }];
  });

  return children.length > 0
    ? { id: 'go-to-library', label: 'Go to...', icon: 'arrow_forward', children }
    : null;
}

export function resolveTrackLibraryNavigationAction(
  actionId: string,
  track: PlaylistItem | undefined,
  libraryItems: PlaylistItem[]
): TrackLibraryNavigationTarget | null {
  if (!track || !actionId.startsWith(GO_TO_LIBRARY_ACTION_PREFIX)) return null;

  const field = actionId.slice(GO_TO_LIBRARY_ACTION_PREFIX.length) as TrackLibraryNavigationField;
  if (!TRACK_LIBRARY_NAVIGATION_FIELDS.includes(field)) return null;
  return resolveTrackLibraryNavigationTargets(track, libraryItems)[field] ?? null;
}

export function buildPlaylistContextActions(
  playlistItems: PlaylistItem[],
  libraryItems: PlaylistItem[],
  ids: string[],
  favoriteItems: PlaylistItem[] = [],
  ratingsEnabled = true
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);
  const inLibrary = libraryHasAllTracks(libraryItems, tracks);
  const canSeparateSubsongs =
    tracks.length === 1 &&
    tracks[0].kind === 'module' &&
    tracks[0].subsong === undefined &&
    (tracks[0].metadata?.subsongs ?? 0) > 1;
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;

  return [
    ...(goToLibrary ? [goToLibrary] : []),
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    {
      id: 'toggle-library',
      label: inLibrary ? 'Remove from library' : 'Add to library',
      icon: inLibrary ? 'remove_circle' : 'library_add'
    },
    buildFavoriteToggleAction(favoriteItems, tracks),
    ...(ratingsEnabled && tracks.length > 0 ? [buildTrackRatingAction(tracks)] : []),
    ...(canSeparateSubsongs
      ? [{
          id: 'separate-subsongs',
          label: 'Separate subsongs',
          icon: 'call_split'
        }]
      : []),
    {
      id: 'remove',
      label: 'Remove',
      icon: 'delete',
      shortcut: 'Delete',
      separatorBefore: true
    }
  ];
}

export function buildLibraryContextActions(
  libraryItems: PlaylistItem[] = [],
  favoriteItems: PlaylistItem[] = [],
  ids: string[] = [],
  ratingsEnabled = true
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(libraryItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;

  return [
    {
      id: 'add-to-playlist',
      label: 'Add to playlist',
      icon: 'playlist_add'
    },
    {
      id: 'replace-playlist',
      label: 'Replace playlist',
      icon: 'playlist_play'
    },
    ...(goToLibrary ? [goToLibrary] : []),
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    buildFavoriteToggleAction(favoriteItems, tracks),
    ...(ratingsEnabled && tracks.length > 0 ? [buildTrackRatingAction(tracks)] : []),
    {
      id: 'reset-play-count',
      label: 'Reset play count',
      icon: 'restart_alt',
      separatorBefore: true
    },
    {
      id: 'remove',
      label: 'Remove',
      icon: 'delete',
      shortcut: 'Delete'
    }
  ];
}

export function buildLibraryGroupContextActions(actions: MenuActionItem[]): MenuActionItem[] {
  return actions
    .filter((action) => action.id !== 'go-to-library')
    .flatMap((action) => action.id === 'replace-playlist'
      ? [
          action,
          {
            id: 'shuffle-play',
            label: 'Shuffle play',
            icon: 'shuffle'
          }
        ]
      : [action]);
}

export function buildFavoritesContextActions(
  favoriteItems: PlaylistItem[] = [],
  libraryItems: PlaylistItem[] = [],
  ids: string[] = [],
  ratingsEnabled = true
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(favoriteItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;

  return [
    {
      id: 'add-to-playlist',
      label: 'Add to playlist',
      icon: 'playlist_add'
    },
    {
      id: 'replace-playlist',
      label: 'Replace playlist',
      icon: 'playlist_play'
    },
    ...(goToLibrary ? [goToLibrary] : []),
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    ...(ratingsEnabled && tracks.length > 0 ? [buildTrackRatingAction(tracks)] : []),
    {
      id: 'remove-favorite',
      label: 'Remove from favorites',
      icon: 'heart_minus',
      separatorBefore: true
    }
  ];
}
