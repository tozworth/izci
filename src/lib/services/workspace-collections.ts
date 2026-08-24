import { appInstallService } from '$lib/services/app-install';
import { logWarning } from '$lib/services/logging';
import { playerController } from '$lib/services/player-controller';
import {
  buildLibraryContextActions,
  buildFavoritesContextActions,
  buildQueueContextActions,
  buildUpNextContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentFavoriteIds,
  getEquivalentLibraryIds,
  favoritesHaveAllTracks,
  libraryHasAllTracks,
  resolveTrackLibraryNavigationAction
} from '$lib/services/workspace-actions';
import type { TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
import { favoritesStore, libraryStore, queueStore } from '$lib/stores/queue';
import { upNext } from '$lib/stores/up-next';
import { trackSettings } from '$lib/stores/track-settings';
import { normalizeTrackRating, parseTrackRatingAction } from '$lib/services/track-ratings';
import type {
  MenuActionItem,
  TrackItem,
  WorkspaceCollection
} from '$lib/types';
import {
  buildTrackItems,
  buildSeparatedSubsongItems,
  cloneTrackItems,
  getTrackIdentity
} from '$lib/utils/files';

interface WorkspaceCollectionState {
  queueItems: TrackItem[];
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  queueSelectionIds: string[];
  librarySelectionIds: string[];
  favoriteSelectionIds: string[];
  playingTrack: TrackItem | null;
}

interface WorkspaceCollectionHandlers {
  focusCollection: (collection: WorkspaceCollection) => void;
  selectTrack: (collection: WorkspaceCollection, id: string) => void;
  showTrackDetails: () => void;
  showTrackLyrics: () => void;
  showLibraryGroup: (target: TrackLibraryNavigationTarget) => void;
  playQueue: () => void;
}

interface CreateWorkspaceCollectionsControllerOptions {
  getState: () => WorkspaceCollectionState;
  handlers: WorkspaceCollectionHandlers;
}

export function createWorkspaceCollectionsController({
  getState,
  handlers
}: CreateWorkspaceCollectionsControllerOptions) {
  function cleanupRemovedItems(items: TrackItem[]): void {
    for (const item of items) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }
  }

  async function copyTrackFilenames(tracks: TrackItem[]): Promise<void> {
    const filenames = tracks.map((track) => track.name).filter(Boolean);
    if (filenames.length === 0) {
      return;
    }

    try {
      await navigator.clipboard.writeText(filenames.join('\n'));
    } catch (error) {
      logWarning('files', 'Failed to copy filenames to clipboard', { error });
    }
  }

  function addFiles(files: FileList | File[], target: WorkspaceCollection): TrackItem[] {
    const nextItems = buildTrackItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    appInstallService.markEngaged();
    return (target === 'library' ? libraryStore : queueStore).add(nextItems);
  }

  function handleAddFiles(files: FileList | File[], target: WorkspaceCollection): void {
    const nextItems = addFiles(files, target);
    const state = getState();
    const selectedIds =
      target === 'library'
        ? state.librarySelectionIds
        : state.queueSelectionIds;

    if (nextItems.length > 0 && selectedIds.length === 0) {
      handlers.selectTrack(target, nextItems[0].id);
    } else {
      handlers.focusCollection(target);
    }
  }

  function removeTrackItems(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }

    const removedSet = new Set(ids);
    const removedItems = queueStore.remove(ids);

    if (getState().playingTrack && removedSet.has(getState().playingTrack!.id)) {
      playerController.unload();
    }

    cleanupRemovedItems(removedItems);
  }

  function removeLibraryItems(ids: string[]): void {
    if (ids.length > 0) {
      cleanupRemovedItems(libraryStore.remove(ids));
    }
  }

  function getQueueContextActions(ids: string[]): MenuActionItem[] {
    const { queueItems, libraryItems } = getState();
    return buildQueueContextActions(
      queueItems,
      libraryItems,
      ids,
      getState().favoriteItems,
      trackSettings.getSnapshot().enableRatings
    );
  }

  function getLibraryContextActions(ids: string[]): MenuActionItem[] {
    const { libraryItems, favoriteItems } = getState();
    return buildLibraryContextActions(
      libraryItems,
      favoriteItems,
      ids,
      trackSettings.getSnapshot().enableRatings
    );
  }

  function getFavoriteContextActions(ids: string[]): MenuActionItem[] {
    const { favoriteItems, libraryItems } = getState();
    return buildFavoritesContextActions(
      favoriteItems,
      libraryItems,
      ids,
      trackSettings.getSnapshot().enableRatings
    );
  }

  function getUpNextContextActions(ids: string[]): MenuActionItem[] {
    const { queueItems, libraryItems, favoriteItems } = getState();
    return buildUpNextContextActions(
      queueItems,
      libraryItems,
      ids,
      favoriteItems,
      trackSettings.getSnapshot().enableRatings
    );
  }

  function queueTracksFromQueue(tracks: TrackItem[], position: 'front' | 'end'): void {
    if (tracks.length === 0) return;
    upNext.add(tracks, position);
  }

  function queueTracksFromCollection(tracks: TrackItem[], position: 'front' | 'end'): void {
    if (tracks.length === 0) return;

    const addedItems = queueStore.add(cloneTrackItems(tracks));
    const queuedItems = tracks
      .map((track, index) => addedItems[index] ?? queueStore.findEquivalent(track))
      .filter((item): item is TrackItem => item !== null);

    upNext.add(queuedItems, position);
  }

  function rateTracks(tracks: TrackItem[], value: number | undefined): void {
    const rating = normalizeTrackRating(value);
    const identities = new Set(tracks.map((track) => getTrackIdentity(track)));

    for (const { items, store } of [
      { items: getState().queueItems, store: queueStore },
      { items: getState().libraryItems, store: libraryStore },
      { items: getState().favoriteItems, store: favoritesStore }
    ]) {
      for (const item of items) {
        if (identities.has(getTrackIdentity(item))) {
          store.updateRating(item.id, rating);
        }
      }
    }
  }

  function handleRatingAction(actionId: string, tracks: TrackItem[]): boolean {
    const action = parseTrackRatingAction(actionId);
    if (!action.matched || !trackSettings.getSnapshot().enableRatings) return false;
    rateTracks(tracks, action.rating);
    return true;
  }

  function handleLibraryNavigationAction(actionId: string, tracks: TrackItem[]): boolean {
    if (tracks.length !== 1) return false;

    const target = resolveTrackLibraryNavigationAction(
      actionId,
      tracks[0],
      getState().libraryItems
    );
    if (!target) return false;

    handlers.showLibraryGroup(target);
    return true;
  }

  function incrementLibraryPlayCount(libraryItemId: string): void {
    const item = getState().libraryItems.find((entry) => entry.id === libraryItemId);
    const currentPlayCount = item?.metadata?.playCount ?? 0;
    const nextPlayCount = Number.isFinite(currentPlayCount)
      ? Math.max(0, Math.floor(currentPlayCount)) + 1
      : 1;

    libraryStore.updateMetadata(libraryItemId, { playCount: nextPlayCount });
  }

  function recordLibraryLastPlayed(libraryItemId: string): void {
    libraryStore.updateMetadata(libraryItemId, { lastPlayed: Date.now() });
  }

  function resetLibraryPlayCounts(ids: string[]): void {
    for (const id of ids) {
      libraryStore.updateMetadata(id, { playCount: 0, lastPlayed: undefined });
    }
  }

  function addFavoriteTracks(tracks: TrackItem[]): TrackItem[] {
    return favoritesStore.add(cloneTrackItems(tracks));
  }

  function removeFavoriteTracks(tracks: TrackItem[]): void {
    const ids = getEquivalentFavoriteIds(getState().favoriteItems, tracks);
    cleanupRemovedItems(favoritesStore.remove(ids));
  }

  function toggleFavoriteTracks(tracks: TrackItem[]): void {
    if (favoritesHaveAllTracks(getState().favoriteItems, tracks)) {
      removeFavoriteTracks(tracks);
      return;
    }

    addFavoriteTracks(tracks);
  }

  function handleQueueContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'randomize-queue') {
      queueStore.randomize();
      return;
    }

    const { queueItems, libraryItems, librarySelectionIds } = getState();
    const tracks = buildSelectedWorkspaceTracks(queueItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (handleRatingAction(actionId, tracks)) return;

    if (handleLibraryNavigationAction(actionId, tracks)) return;

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'play-next') {
      queueTracksFromQueue(tracks, 'front');
    } else if (actionId === 'copy-filename') {
      void copyTrackFilenames(tracks);
    } else if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(libraryItems, tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(libraryItems, tracks));
        return;
      }

      const addedItems = libraryStore.add(cloneTrackItems(tracks));
      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        handlers.selectTrack('library', addedItems[0].id);
      }
    } else if (actionId === 'toggle-favorite') {
      toggleFavoriteTracks(tracks);
    } else if (actionId === 'separate-subsongs' && tracks.length === 1) {
      const track = tracks[0];
      const playingTrack = getState().playingTrack;
      const activeSubsong = playingTrack?.id === track.id ? playingTrack.subsong ?? 0 : 0;
      queueStore.replaceItem(track.id, buildSeparatedSubsongItems(track, activeSubsong));
    } else if (actionId === 'remove') {
      removeTrackItems(ids);
    }
  }

  function handleLibraryContextAction(actionId: string, ids: string[]): void {
    const tracks = buildSelectedWorkspaceTracks(getState().libraryItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (handleRatingAction(actionId, tracks)) return;

    if (handleLibraryNavigationAction(actionId, tracks)) return;

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'play-next') {
      queueTracksFromCollection(tracks, 'front');
    } else if (actionId === 'copy-filename') {
      void copyTrackFilenames(tracks);
    } else if (actionId === 'toggle-favorite') {
      toggleFavoriteTracks(tracks);
    } else if (actionId === 'add-to-queue') {
      const addedItems = queueStore.add(cloneTrackItems(tracks));
      if (addedItems.length > 0) {
        handlers.selectTrack('queue', addedItems[0].id);
      }
    } else if (actionId === 'replace-queue') {
      const { removedItems, addedItems } = queueStore.replaceAll(cloneTrackItems(tracks));
      cleanupRemovedItems(removedItems);
      playerController.unload();
      if (addedItems.length > 0) {
        handlers.selectTrack('queue', addedItems[0].id);
      }
    } else if (actionId === 'shuffle-play') {
      const { removedItems, addedItems } = queueStore.replaceAll(cloneTrackItems(tracks));
      cleanupRemovedItems(removedItems);
      playerController.unload();
      queueStore.setShuffleEnabled(true);
      if (addedItems.length > 0) {
        handlers.playQueue();
      }
    } else if (actionId === 'reset-play-count') {
      resetLibraryPlayCounts(ids);
    } else if (actionId === 'remove') {
      removeLibraryItems(ids);
    }
  }

  function handleFavoriteContextAction(actionId: string, ids: string[]): void {
    const tracks = buildSelectedWorkspaceTracks(getState().favoriteItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (handleRatingAction(actionId, tracks)) return;

    if (handleLibraryNavigationAction(actionId, tracks)) return;

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'play-next') {
      queueTracksFromCollection(tracks, 'front');
    } else if (actionId === 'add-to-queue') {
      const addedItems = queueStore.add(cloneTrackItems(tracks));
      if (addedItems.length > 0) handlers.selectTrack('queue', addedItems[0].id);
    } else if (actionId === 'replace-queue') {
      const { removedItems, addedItems } = queueStore.replaceAll(cloneTrackItems(tracks));
      cleanupRemovedItems(removedItems);
      playerController.unload();
      if (addedItems.length > 0) handlers.selectTrack('queue', addedItems[0].id);
    } else if (actionId === 'remove-favorite') {
      cleanupRemovedItems(favoritesStore.remove(ids));
    }
  }

  function handleUpNextContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'remove-from-up-next') {
      upNext.remove(ids);
      return;
    }

    handleQueueContextAction(actionId, ids);
  }

  return {
    cleanupRemovedItems,
    handleAddFiles,
    removeTrackItems,
    removeLibraryItems,
    getQueueContextActions,
    getLibraryContextActions,
    getFavoriteContextActions,
    getUpNextContextActions,
    incrementLibraryPlayCount,
    recordLibraryLastPlayed,
    handleQueueContextAction,
    handleLibraryContextAction,
    handleFavoriteContextAction,
    handleUpNextContextAction,
    toggleFavoriteTracks,
    rateTracks
  };
}

interface SyncPlayingTrackMetadataDeps {
  isMultiplayerClient: boolean;
  libraryItems: TrackItem[];
  favoriteItems: TrackItem[];
  notifyCurrentTrackChanged(track: TrackItem | null): void;
}

/**
 * Applies a newly current track's metadata to the queue and library/favorites
 * collections (identity-matched), mirroring the playing track in the
 * collections. Client-mode (remote playback) updates are skipped.
 */
export function syncPlayingTrackMetadata(track: TrackItem | null, deps: SyncPlayingTrackMetadataDeps): void {
  if (deps.isMultiplayerClient) return;
  deps.notifyCurrentTrackChanged(track);

  if (!track?.metadata) {
    return;
  }

  queueStore.updateMetadata(track.id, track.metadata);

  const playingIdentity = getTrackIdentity(track);

  for (const item of deps.libraryItems) {
    if (getTrackIdentity(item) === playingIdentity) {
      libraryStore.updateMetadata(item.id, track.metadata);
    }
  }

  for (const item of deps.favoriteItems) {
    if (getTrackIdentity(item) === playingIdentity) {
      favoritesStore.updateMetadata(item.id, track.metadata);
    }
  }
}
