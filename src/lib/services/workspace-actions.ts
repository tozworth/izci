import type { MenuActionItem, PlaylistItem, WorkspaceCollection } from '$lib/types';
import { getFavoriteIdentity, getTrackIdentity } from '$lib/utils/files';

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

export function buildPlaylistContextActions(
  playlistItems: PlaylistItem[],
  libraryItems: PlaylistItem[],
  ids: string[],
  favoriteItems: PlaylistItem[] = []
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);
  const inLibrary = libraryHasAllTracks(libraryItems, tracks);
  const canSeparateSubsongs =
    tracks.length === 1 &&
    tracks[0].kind === 'module' &&
    tracks[0].subsong === undefined &&
    (tracks[0].metadata?.subsongs ?? 0) > 1;

  return [
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
  ids: string[] = []
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(libraryItems, ids);

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
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    buildFavoriteToggleAction(favoriteItems, tracks),
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

export function buildFavoritesContextActions(): MenuActionItem[] {
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
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    {
      id: 'remove-favorite',
      label: 'Remove from favorites',
      icon: 'heart_minus',
      separatorBefore: true
    }
  ];
}
