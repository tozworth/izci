import {
  buildSelectedWorkspaceTracks,
  resolveTrackLibraryNavigationAction
} from '$lib/services/workspace-actions';
import type { TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
import type { MultiplayerCommandInput } from '$lib/services/multiplayer-protocol';
import type { LibraryViewId, TrackItem, WorkspaceCollection } from '$lib/types';

interface FreeplayUiActionsDeps {
  getIsFreeplayClient(): boolean;
  getFreeplayQueue(): string[];
  setFreeplayQueue(ids: string[]): void;
  sendCommand(command: MultiplayerCommandInput): void;
  getShuffleEnabled(): boolean;
  getQueueItems(): TrackItem[];
  getLibraryItems(): TrackItem[];
  getFavoriteItems(): TrackItem[];
  getActiveView(): LibraryViewId;
  copyTrackFilenames(tracks: TrackItem[]): Promise<void>;
  showLibraryGroup(target: TrackLibraryNavigationTarget): void;
  showTrackDetails(): void;
  activateTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean;
}

/**
 * Freeplay UI actions: handlers that turn freeplay-client panel events into
 * freeplay queue mutations and host commands. The server side of freeplay
 * lives in multiplayer-host.ts; this module only coordinates the client-side
 * UI surface.
 */
export function createFreeplayUiActions(deps: FreeplayUiActionsDeps) {
  function addToFreeplayQueue(ids: string[]): void {
    const playableIds = new Set([...deps.getLibraryItems(), ...deps.getFavoriteItems()].filter((item) => item.kind !== 'image').map((item) => item.id));
    ids = ids.filter((id) => playableIds.has(id));
    if (!deps.getIsFreeplayClient() || ids.length === 0) return;
    const current = deps.getFreeplayQueue();
    deps.setFreeplayQueue([
      ...current,
      ...ids.filter((id) => !current.includes(id))
    ]);
  }

  function removeFromFreeplayQueue(ids: string[]): void {
    if (!deps.getIsFreeplayClient() || ids.length === 0) return;
    const removed = new Set(ids);
    deps.setFreeplayQueue(
      deps.getFreeplayQueue().filter((id) => !removed.has(id))
    );
  }

  function handleNavigationAction(actionId: string, tracks: TrackItem[]): boolean {
    if (tracks.length !== 1) return false;
    const target = resolveTrackLibraryNavigationAction(actionId, tracks[0], deps.getLibraryItems());
    if (!target) return false;
    deps.showLibraryGroup(target);
    return true;
  }

  function handleQueueContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'remove' && deps.getIsFreeplayClient()) {
      removeFromFreeplayQueue(ids);
      return;
    }
    const tracks = buildSelectedWorkspaceTracks(deps.getQueueItems(), ids);
    if (handleNavigationAction(actionId, tracks)) return;
    if (!deps.getIsFreeplayClient()) {
      if (actionId === 'randomize-queue') deps.sendCommand({ type: 'queue.randomize' });
      else if (actionId === 'remove' && tracks.length) deps.sendCommand({ type: 'queue.remove', itemIds: tracks.map((track) => track.id) });
    }
    if (actionId === 'track-details') {
      deps.showTrackDetails();
    } else if (actionId === 'copy-filename') {
      void deps.copyTrackFilenames(tracks);
    } else if (actionId === 'play-next' && tracks.length > 0) {
      deps.sendCommand({ type: 'queue.play-next', collection: 'queue', itemIds: tracks.map((track) => track.id) });
    }
  }

  function handleLibraryContextAction(actionId: string, ids: string[]): void {
    const source = deps.getActiveView() === 'favorites' ? deps.getFavoriteItems() : deps.getLibraryItems();
    const selected = buildSelectedWorkspaceTracks(source, ids);
    const tracks = ['add-to-queue', 'replace-queue', 'play-next', 'shuffle-play'].includes(actionId)
      ? selected.filter((item) => item.kind !== 'image') : selected;
    ids = tracks.map((item) => item.id);
    if (handleNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') {
      deps.showTrackDetails();
      return;
    }
    if (actionId === 'copy-filename') {
      void deps.copyTrackFilenames(tracks);
      return;
    }
    if (!deps.getIsFreeplayClient()) {
      if (tracks.length === 0) return;
      const itemIds = tracks.map((track) => track.id);
      if (actionId === 'add-to-queue') deps.sendCommand({ type: 'queue.add', itemIds });
      else if (actionId === 'replace-queue') deps.sendCommand({ type: 'queue.replace', itemIds });
      else if (actionId === 'play-next') deps.sendCommand({ type: 'queue.play-next', collection: deps.getActiveView() === 'favorites' ? 'favorites' : 'library', itemIds });
      else if (actionId === 'shuffle-play') {
        deps.sendCommand({ type: 'queue.replace', itemIds });
        if (!deps.getShuffleEnabled()) deps.sendCommand({ type: 'queue.shuffle' });
        deps.activateTrack(deps.getActiveView() === 'favorites' ? 'favorites' : 'library', itemIds[0]);
      }
      return;
    }
    if (actionId === 'add-to-queue') {
      addToFreeplayQueue(ids);
      return;
    }
    if (actionId === 'play-next') {
      if (tracks.length === 0) return;
      addToFreeplayQueue(ids);
      deps.sendCommand({ type: 'queue.play-next', collection: 'queue', itemIds: tracks.map((track) => track.id) });
      return;
    }
    if (actionId === 'replace-queue' || actionId === 'shuffle-play') {
      if (ids.length === 0) return;
      deps.setFreeplayQueue(ids);
      if (actionId === 'shuffle-play' && !deps.getShuffleEnabled()) {
        deps.sendCommand({ type: 'queue.shuffle' });
      }
      deps.activateTrack('queue', ids[0]);
      return;
    }
  }

  return {
    addToFreeplayQueue,
    removeFromFreeplayQueue,
    handleQueueContextAction,
    handleLibraryContextAction
  };
}
