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
    if (actionId === 'remove') {
      removeFromFreeplayQueue(ids);
      return;
    }
    const tracks = buildSelectedWorkspaceTracks(deps.getQueueItems(), ids);
    if (handleNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') deps.showTrackDetails();
  }

  function handleLibraryContextAction(actionId: string, ids: string[]): void {
    if (actionId === 'add-to-queue') {
      addToFreeplayQueue(ids);
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
    const source = deps.getActiveView() === 'favorites' ? deps.getFavoriteItems() : deps.getLibraryItems();
    const tracks = buildSelectedWorkspaceTracks(source, ids);
    if (handleNavigationAction(actionId, tracks)) return;
    if (actionId === 'track-details') deps.showTrackDetails();
  }

  return {
    addToFreeplayQueue,
    removeFromFreeplayQueue,
    handleQueueContextAction,
    handleLibraryContextAction
  };
}
