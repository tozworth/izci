import type { MenuActionItem, PlaylistItem, WorkspaceCollection } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

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

export function buildPlaylistContextActions(
  playlistItems: PlaylistItem[],
  libraryItems: PlaylistItem[],
  ids: string[]
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);
  const inLibrary = libraryHasAllTracks(libraryItems, tracks);

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
    {
      id: 'remove',
      label: 'Remove',
      icon: 'delete',
      shortcut: 'Delete',
      separatorBefore: true
    }
  ];
}

export function buildLibraryContextActions(): MenuActionItem[] {
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
