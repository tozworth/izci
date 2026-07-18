import { appInstallService } from '$lib/services/app-install';
import { playerController } from '$lib/services/player-controller';
import {
  buildLibraryContextActions,
  buildFavoritesContextActions,
  buildPlaylistContextActions,
  buildSelectedWorkspaceTracks,
  getEquivalentFavoriteIds,
  getEquivalentLibraryIds,
  favoritesHaveAllTracks,
  libraryHasAllTracks
} from '$lib/services/workspace-actions';
import { favoritesStore, libraryStore, playlistStore } from '$lib/stores/playlist';
import type {
  MenuActionItem,
  PlaylistItem,
  WorkspaceCollection
} from '$lib/types';
import {
  buildPlaylistItems,
  buildSeparatedSubsongItems,
  clonePlaylistItems
} from '$lib/utils/files';

export interface WorkspaceCollectionState {
  playlistItems: PlaylistItem[];
  libraryItems: PlaylistItem[];
  favoriteItems: PlaylistItem[];
  playlistSelectionIds: string[];
  librarySelectionIds: string[];
  favoriteSelectionIds: string[];
  playingTrack: PlaylistItem | null;
}

interface WorkspaceCollectionHandlers {
  focusCollection: (collection: WorkspaceCollection) => void;
  selectTrack: (collection: WorkspaceCollection, id: string) => void;
  showTrackDetails: () => void;
  showTrackLyrics: () => void;
}

interface CreateWorkspaceCollectionsControllerOptions {
  getState: () => WorkspaceCollectionState;
  handlers: WorkspaceCollectionHandlers;
}

export function createWorkspaceCollectionsController({
  getState,
  handlers
}: CreateWorkspaceCollectionsControllerOptions) {
  const favoriteContextActions = buildFavoritesContextActions();

  function cleanupRemovedItems(items: PlaylistItem[]): void {
    for (const item of items) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }
  }

  function addFiles(files: FileList | File[], target: WorkspaceCollection): PlaylistItem[] {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    appInstallService.markEngaged();
    return (target === 'library' ? libraryStore : playlistStore).add(nextItems);
  }

  function handleAddFiles(files: FileList | File[], target: WorkspaceCollection): void {
    const nextItems = addFiles(files, target);
    const state = getState();
    const selectedIds =
      target === 'library'
        ? state.librarySelectionIds
        : state.playlistSelectionIds;

    if (nextItems.length > 0 && selectedIds.length === 0) {
      handlers.selectTrack(target, nextItems[0].id);
    } else {
      handlers.focusCollection(target);
    }
  }

  function removePlaylistItems(ids: string[]): void {
    if (ids.length === 0) {
      return;
    }

    const removedSet = new Set(ids);
    const removedItems = playlistStore.remove(ids);

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

  function getPlaylistContextActions(ids: string[]): MenuActionItem[] {
    const { playlistItems, libraryItems } = getState();
    return buildPlaylistContextActions(playlistItems, libraryItems, ids, getState().favoriteItems);
  }

  function getLibraryContextActions(ids: string[]): MenuActionItem[] {
    const { libraryItems, favoriteItems } = getState();
    return buildLibraryContextActions(libraryItems, favoriteItems, ids);
  }

  function getFavoriteContextActions(): MenuActionItem[] {
    return favoriteContextActions;
  }

  function incrementLibraryPlayCount(libraryItemId: string): void {
    const item = getState().libraryItems.find((entry) => entry.id === libraryItemId);
    const currentPlayCount = item?.metadata?.playCount ?? 0;
    const nextPlayCount = Number.isFinite(currentPlayCount)
      ? Math.max(0, Math.floor(currentPlayCount)) + 1
      : 1;

    libraryStore.updateMetadata(libraryItemId, { playCount: nextPlayCount });
  }

  function resetLibraryPlayCounts(ids: string[]): void {
    for (const id of ids) {
      libraryStore.updateMetadata(id, { playCount: 0 });
    }
  }

  function addFavoriteTracks(tracks: PlaylistItem[]): PlaylistItem[] {
    return favoritesStore.add(clonePlaylistItems(tracks));
  }

  function removeFavoriteTracks(tracks: PlaylistItem[]): void {
    const ids = getEquivalentFavoriteIds(getState().favoriteItems, tracks);
    cleanupRemovedItems(favoritesStore.remove(ids));
  }

  function toggleFavoriteTracks(tracks: PlaylistItem[]): void {
    if (favoritesHaveAllTracks(getState().favoriteItems, tracks)) {
      removeFavoriteTracks(tracks);
      return;
    }

    addFavoriteTracks(tracks);
  }

  function handlePlaylistContextAction(actionId: string, ids: string[]): void {
    const { playlistItems, libraryItems, librarySelectionIds } = getState();
    const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(libraryItems, tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(libraryItems, tracks));
        return;
      }

      const addedItems = libraryStore.add(clonePlaylistItems(tracks));
      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        handlers.selectTrack('library', addedItems[0].id);
      }
    } else if (actionId === 'toggle-favorite') {
      toggleFavoriteTracks(tracks);
    } else if (actionId === 'separate-subsongs' && tracks.length === 1) {
      const track = tracks[0];
      const playingTrack = getState().playingTrack;
      const activeSubsong = playingTrack?.id === track.id ? playingTrack.subsong ?? 0 : 0;
      playlistStore.replaceItem(track.id, buildSeparatedSubsongItems(track, activeSubsong));
    } else if (actionId === 'remove') {
      removePlaylistItems(ids);
    }
  }

  function handleLibraryContextAction(actionId: string, ids: string[]): void {
    const tracks = buildSelectedWorkspaceTracks(getState().libraryItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'toggle-favorite') {
      toggleFavoriteTracks(tracks);
    } else if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));
      if (addedItems.length > 0) {
        handlers.selectTrack('playlist', addedItems[0].id);
      }
    } else if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));
      cleanupRemovedItems(removedItems);
      playerController.unload();
      if (addedItems.length > 0) {
        handlers.selectTrack('playlist', addedItems[0].id);
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

    if (actionId === 'track-details') {
      handlers.showTrackDetails();
    } else if (actionId === 'track-lyrics') {
      handlers.showTrackLyrics();
    } else if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));
      if (addedItems.length > 0) handlers.selectTrack('playlist', addedItems[0].id);
    } else if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));
      cleanupRemovedItems(removedItems);
      playerController.unload();
      if (addedItems.length > 0) handlers.selectTrack('playlist', addedItems[0].id);
    } else if (actionId === 'remove-favorite') {
      cleanupRemovedItems(favoritesStore.remove(ids));
    }
  }

  return {
    cleanupRemovedItems,
    handleAddFiles,
    removePlaylistItems,
    removeLibraryItems,
    getPlaylistContextActions,
    getLibraryContextActions,
    getFavoriteContextActions,
    incrementLibraryPlayCount,
    handlePlaylistContextAction,
    handleLibraryContextAction,
    handleFavoriteContextAction,
    toggleFavoriteTracks
  };
}
