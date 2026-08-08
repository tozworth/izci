import type { TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
import type { MultiplayerCommandInput } from '$lib/services/multiplayer-protocol';
import {
  buildSelectedWorkspaceTracks,
  resolveTrackLibraryNavigationAction
} from '$lib/services/workspace-actions';
import type { PlaylistItem, WorkspaceCollection } from '$lib/types';

export interface FreeplayControllerOptions {
  getState: () => {
    isMultiplayerClient: boolean;
    isFreeplayClient: boolean;
    freeplayQueue: string[];
    remoteShuffleEnabled: boolean;
    playlistItems: PlaylistItem[];
    libraryItems: PlaylistItem[];
    favoriteItems: PlaylistItem[];
    activeViewIsFavorites: boolean;
  };
  session: {
    sendCommand(command: MultiplayerCommandInput): boolean;
    setFreeplayQueue(itemIds: string[]): void;
  };
  handlers: {
    showTrackDetails: () => void;
    showLibraryGroup: (target: TrackLibraryNavigationTarget) => void;
  };
}

export interface FreeplayController {
  activateTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean;
  addToQueue(ids: string[]): void;
  removeFromQueue(ids: string[]): void;
  handlePlaylistContextAction(actionId: string, ids: string[]): void;
  handleLibraryContextAction(actionId: string, ids: string[]): void;
  replaceQueueAndPlay(ids: string[], shuffle: boolean): void;
}

export function createFreeplayController(options: FreeplayControllerOptions): FreeplayController {
  function activateTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean {
    if (!options.getState().isMultiplayerClient) return false;
    options.session.sendCommand({ type: 'collection.activate', collection, itemId: id });
    return true;
  }

  function addToQueue(ids: string[]): void {
    const state = options.getState();
    if (!state.isFreeplayClient || ids.length === 0) return;
    const queue = state.freeplayQueue;
    const next = [...queue, ...ids.filter((id) => !queue.includes(id))];
    options.session.setFreeplayQueue(next);
  }

  function removeFromQueue(ids: string[]): void {
    const state = options.getState();
    if (!state.isFreeplayClient || ids.length === 0) return;
    const removed = new Set(ids);
    options.session.setFreeplayQueue(
      state.freeplayQueue.filter((id) => !removed.has(id))
    );
  }

  function handleLibraryNavigationAction(actionId: string, tracks: PlaylistItem[]): boolean {
    if (tracks.length !== 1) return false;
    const target = resolveTrackLibraryNavigationAction(actionId, tracks[0], options.getState().libraryItems);
    if (!target) return false;
    options.handlers.showLibraryGroup(target);
    return true;
  }

  function handlePlaylistContextAction(actionId: string, ids: string[]): void {
    // 'remove' mutates the client-owned queue; the queue is the client's
    // playlist, so it stays. Favorites/ratings/library actions never appear in
    // the Freeplay menu (buildFreeplayPlaylistContextActions), so the remaining
    // actions are purely presentational or navigate the client's own library.
    if (actionId === 'remove') {
      removeFromQueue(ids);
      return;
    }
    const tracks = buildSelectedWorkspaceTracks(options.getState().playlistItems, ids);
    if (tracks.length === 0) return;
    if (handleLibraryNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') options.handlers.showTrackDetails();
  }

  function handleLibraryContextAction(actionId: string, ids: string[]): void {
    const state = options.getState();
    if (actionId === 'add-to-playlist') {
      addToQueue(ids);
      return;
    }
    if (actionId === 'replace-playlist' || actionId === 'shuffle-play') {
      replaceQueueAndPlay(ids, actionId === 'shuffle-play');
      return;
    }
    const sourceItems = state.activeViewIsFavorites ? state.favoriteItems : state.libraryItems;
    const tracks = buildSelectedWorkspaceTracks(sourceItems, ids);
    if (tracks.length === 0) return;
    if (handleLibraryNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') options.handlers.showTrackDetails();
  }

  function replaceQueueAndPlay(ids: string[], shuffle: boolean): void {
    const state = options.getState();
    if (!state.isFreeplayClient || ids.length === 0) return;
    // Ordered data channel: the queue replacement lands before the shuffle
    // toggle and the activate, so the host resolves the new queue first.
    options.session.setFreeplayQueue(ids);
    if (shuffle && !state.remoteShuffleEnabled) {
      options.session.sendCommand({ type: 'playlist.shuffle' });
    }
    activateTrack('playlist', ids[0]);
  }

  return {
    activateTrack,
    addToQueue,
    removeFromQueue,
    handlePlaylistContextAction,
    handleLibraryContextAction,
    replaceQueueAndPlay
  };
}
