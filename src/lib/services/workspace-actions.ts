import type { MenuActionItem, TrackItem, WorkspaceCollection } from '$lib/types';
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
  return collection === 'library' ? 'queue' : 'library';
}

export function buildSelectedWorkspaceTracks(
  items: TrackItem[],
  ids: string[]
): TrackItem[] {
  if (ids.length === 0) {
    return [];
  }

  const idSet = new Set(ids);
  return items.filter((item) => idSet.has(item.id));
}

export function libraryHasAllTracks(
  libraryItems: TrackItem[],
  tracks: TrackItem[]
): boolean {
  if (tracks.length === 0) {
    return false;
  }

  const libraryKeys = new Set(libraryItems.map((item) => getTrackIdentity(item)));
  return tracks.every((track) => libraryKeys.has(getTrackIdentity(track)));
}

export function getEquivalentLibraryIds(
  libraryItems: TrackItem[],
  tracks: TrackItem[]
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
  favoriteItems: TrackItem[],
  tracks: TrackItem[]
): boolean {
  if (tracks.length === 0) {
    return false;
  }

  const favoriteKeys = new Set(favoriteItems.map((item) => getFavoriteIdentity(item)));
  return tracks.every((track) => favoriteKeys.has(getFavoriteIdentity(track)));
}

export function getEquivalentFavoriteIds(
  favoriteItems: TrackItem[],
  tracks: TrackItem[]
): string[] {
  const trackKeys = new Set(tracks.map((track) => getFavoriteIdentity(track)));
  return favoriteItems
    .filter((item) => trackKeys.has(getFavoriteIdentity(item)))
    .map((item) => item.id);
}

function buildFavoriteToggleAction(
  favoriteItems: TrackItem[],
  tracks: TrackItem[]
): MenuActionItem {
  const favorite = favoritesHaveAllTracks(favoriteItems, tracks);

  return {
    id: 'toggle-favorite',
    label: favorite ? 'Remove from favorites' : 'Add to favorites',
    icon: favorite ? 'heart_minus' : 'favorite'
  };
}

function buildSendToChatAction(tracks: TrackItem[], enabled: boolean): MenuActionItem | null {
  return enabled && tracks.length === 1
    ? {
        id: 'send-to-chat',
        label: 'Send to chat',
        icon: 'chat',
        separatorBefore: true
      }
    : null;
}

function buildGoToLibraryAction(
  track: TrackItem | undefined,
  libraryItems: TrackItem[]
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
  track: TrackItem | undefined,
  libraryItems: TrackItem[]
): TrackLibraryNavigationTarget | null {
  if (!track || !actionId.startsWith(GO_TO_LIBRARY_ACTION_PREFIX)) return null;

  const field = actionId.slice(GO_TO_LIBRARY_ACTION_PREFIX.length) as TrackLibraryNavigationField;
  if (!TRACK_LIBRARY_NAVIGATION_FIELDS.includes(field)) return null;
  return resolveTrackLibraryNavigationTargets(track, libraryItems)[field] ?? null;
}

export function buildQueueContextActions(
  queueItems: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  favoriteItems: TrackItem[] = [],
  ratingsEnabled = true,
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(queueItems, ids);
  const inLibrary = libraryHasAllTracks(libraryItems, tracks);
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);
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
    ...(sendToChatAction ? [sendToChatAction] : []),
    {
      id: 'play-next',
      label: 'Play next',
      icon: 'queue_play_next'
    },
    {
      id: 'copy-filename',
      label: 'Copy filename',
      icon: 'content_copy'
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
    },
    {
      id: 'randomize-queue',
      label: 'Randomize',
      icon: 'shuffle',
      separatorBefore: true
    }
  ];
}

/** Images are catalog entries, never playback queue candidates. */
function filterImagePlaybackActions(actions: MenuActionItem[], tracks: TrackItem[]): MenuActionItem[] {
  if (tracks.length === 0 || tracks.some((item) => item.kind !== 'image')) return actions;
  return actions.filter((action) => !['add-to-queue', 'replace-queue', 'shuffle-play', 'play-next', 'reset-play-count'].includes(action.id));
}

export function buildLibraryContextActions(
  libraryItems: TrackItem[] = [],
  favoriteItems: TrackItem[] = [],
  ids: string[] = [],
  ratingsEnabled = true,
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(libraryItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);

  return filterImagePlaybackActions([
    {
      id: 'add-to-queue',
      label: 'Add to queue',
      icon: 'playlist_add'
    },
    ...(tracks.length > 1
      ? [{
          id: 'replace-queue',
          label: 'Replace queue',
          icon: 'playlist_play'
        }]
      : []),
    {
      id: 'play-next',
      label: 'Play next',
      icon: 'queue_play_next'
    },
    ...(goToLibrary ? [goToLibrary] : []),
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    ...(sendToChatAction ? [sendToChatAction] : []),
    {
      id: 'copy-filename',
      label: 'Copy filename',
      icon: 'content_copy'
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
  ], tracks);
}

export function buildLibraryGroupContextActions(actions: MenuActionItem[]): MenuActionItem[] {
  const shuffleAfterActionId = actions.some((action) => action.id === 'replace-queue')
    ? 'replace-queue'
    : 'add-to-queue';

  return actions
    .filter((action) => action.id !== 'go-to-library')
    .flatMap((action) => action.id === shuffleAfterActionId
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
  favoriteItems: TrackItem[] = [],
  libraryItems: TrackItem[] = [],
  ids: string[] = [],
  ratingsEnabled = true,
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(favoriteItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);

  return filterImagePlaybackActions([
    {
      id: 'add-to-queue',
      label: 'Add to queue',
      icon: 'playlist_add'
    },
    ...(tracks.length > 1
      ? [{
          id: 'replace-queue',
          label: 'Replace queue',
          icon: 'playlist_play'
        }]
      : []),
    {
      id: 'play-next',
      label: 'Play next',
      icon: 'queue_play_next'
    },
    ...(goToLibrary ? [goToLibrary] : []),
    {
      id: 'track-details',
      label: 'Track details',
      icon: 'info'
    },
    ...(sendToChatAction ? [sendToChatAction] : []),
    ...(ratingsEnabled && tracks.length > 0 ? [buildTrackRatingAction(tracks)] : []),
    {
      id: 'remove-favorite',
      label: 'Remove from favorites',
      icon: 'heart_minus',
      separatorBefore: true
    }
  ], tracks);
}

export function buildUpNextContextActions(
  queueItems: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  favoriteItems: TrackItem[] = [],
  ratingsEnabled = true,
  sendToChat = false
): MenuActionItem[] {
  return buildQueueContextActions(
    queueItems,
    libraryItems,
    ids,
    favoriteItems,
    ratingsEnabled,
    sendToChat
  )
    .filter((action) => action.id !== 'randomize-queue' && action.id !== 'play-next')
    .map((action) =>
      action.id === 'remove'
        ? {
            ...action,
            id: 'remove-from-up-next',
            label: 'Remove from up next',
            icon: 'remove',
            shortcut: undefined
          }
        : action
    );
}

export function buildFreeplayQueueContextActions(
  queueItems: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(queueItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);
  return [
    ...(goToLibrary ? [goToLibrary] : []),
    { id: 'track-details', label: 'Track details', icon: 'info' },
    ...(sendToChatAction ? [sendToChatAction] : []),
    { id: 'play-next', label: 'Play next', icon: 'queue_play_next' },
    { id: 'copy-filename', label: 'Copy filename', icon: 'content_copy' },
    {
      id: 'remove',
      label: 'Remove',
      icon: 'delete',
      shortcut: 'Delete',
      separatorBefore: true
    }
  ];
}

export function buildFreeplayLibraryContextActions(
  items: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(items, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);
  return filterImagePlaybackActions([
    { id: 'add-to-queue', label: 'Add to queue', icon: 'playlist_add' },
    ...(tracks.length > 1
      ? [{ id: 'replace-queue', label: 'Replace queue', icon: 'playlist_play' }]
      : []),
    { id: 'play-next', label: 'Play next', icon: 'queue_play_next' },
    ...(goToLibrary ? [goToLibrary] : []),
    { id: 'track-details', label: 'Track details', icon: 'info' },
    ...(sendToChatAction ? [sendToChatAction] : []),
    { id: 'copy-filename', label: 'Copy filename', icon: 'content_copy' }
  ], tracks);
}

export function buildCoopQueueContextActions(
  queueItems: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(queueItems, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);

  return [
    ...(goToLibrary ? [goToLibrary] : []),
    { id: 'track-details', label: 'Track details', icon: 'info' },
    ...(sendToChatAction ? [sendToChatAction] : []),
    { id: 'play-next', label: 'Play next', icon: 'queue_play_next' },
    { id: 'copy-filename', label: 'Copy filename', icon: 'content_copy' },
    { id: 'remove', label: 'Remove from queue', icon: 'delete', shortcut: 'Delete', separatorBefore: true },
    { id: 'randomize-queue', label: 'Randomize', icon: 'shuffle', separatorBefore: true }
  ];
}

export function buildCoopLibraryContextActions(
  items: TrackItem[],
  libraryItems: TrackItem[],
  ids: string[],
  sendToChat = false
): MenuActionItem[] {
  const tracks = buildSelectedWorkspaceTracks(items, ids);
  const goToLibrary = tracks.length === 1
    ? buildGoToLibraryAction(tracks[0], libraryItems)
    : null;
  const sendToChatAction = buildSendToChatAction(tracks, sendToChat);

  return filterImagePlaybackActions([
    { id: 'add-to-queue', label: 'Add to queue', icon: 'playlist_add' },
    { id: 'replace-queue', label: 'Replace queue', icon: 'playlist_play' },
    { id: 'play-next', label: 'Play next', icon: 'queue_play_next' },
    ...(goToLibrary ? [goToLibrary] : []),
    { id: 'track-details', label: 'Track details', icon: 'info' },
    ...(sendToChatAction ? [sendToChatAction] : []),
    { id: 'copy-filename', label: 'Copy filename', icon: 'content_copy' }
  ], tracks);
}
