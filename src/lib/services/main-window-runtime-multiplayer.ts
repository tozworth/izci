/**
 * Main-window multiplayer bundle: fabricates the multiplayer window controller,
 * the multiplayer session, and the freeplay UI actions in dependency order.
 * Pure move from `main-window-runtime.ts` — construction order, subscription
 * wiring, and teardown collection are unchanged.
 */

import { translate } from '$lib/i18n';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { multiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { multiplayerPairings } from '$lib/stores/multiplayer-pairings';
import { createMultiplayerSession } from '$lib/services/multiplayer-session';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';
import { createMultiplayerWindowController } from '$lib/services/multiplayer-window-controller';
import { createFreeplayUiActions } from '$lib/services/freeplay-ui-actions';
import { playerController } from '$lib/services/player-controller';
import type { MainWindowRuntimeState } from '$lib/services/main-window-runtime-state';
import type { TrackLibraryNavigationTarget } from '$lib/services/library-navigation';
import type { LibraryViewId, TrackItem, WorkspaceTab } from '$lib/types';
import type { RemoteSelectionSnapshot } from './main-window-selection';

export interface MainWindowRuntimeMultiplayerDeps {
  getState(): MainWindowRuntimeState;
  publish(updates: Partial<MainWindowRuntimeState>): void;
  getPlaybackCommands(): {
    togglePlayback(): void | Promise<void>;
    play(): void | Promise<void>;
    pause(): void;
    stop(): void;
    stepTrack(direction: -1 | 1): void | Promise<void>;
    activateQueueTrack(id: string): void | Promise<void>;
    activateLibraryTrack(id: string): void | Promise<void>;
    activateFavoriteTrack(track: TrackItem): void | Promise<void>;
  };
  getSeek(): (seconds: number) => void;
  getToggleQueueShuffle(): () => void;
  getCycleQueueRepeat(): () => void;
  getSetActiveWorkspaceTab(): (tab: WorkspaceTab) => void;
  getRemoteSelections(): RemoteSelectionSnapshot;
  setRemoteSelections(selections: RemoteSelectionSnapshot): void;
  getShowLibraryGroup(): (target: TrackLibraryNavigationTarget) => void;
  getShowTrackDetails(): () => void;
  getActiveView(): LibraryViewId;
}

export interface MainWindowRuntimeMultiplayerBundle {
  multiplayerController: ReturnType<typeof createMultiplayerWindowController>;
  multiplayerSession: MultiplayerSessionController;
  freeplayActions: ReturnType<typeof createFreeplayUiActions>;
  unsubscribe(): void;
}

/** Fabricates the multiplayer/freeplay controller cluster in dependency order. */
export function createMainWindowRuntimeMultiplayerBundle(
  deps: MainWindowRuntimeMultiplayerDeps
): MainWindowRuntimeMultiplayerBundle {
  const state = deps.getState();
  let multiplayerSession: MultiplayerSessionController;
  const multiplayerController = createMultiplayerWindowController({
    getSession: () => multiplayerSession,
    getPlaybackCommands: () => deps.getPlaybackCommands(),
    getPlayingTrack: () => state.playingTrack,
    getPlaybackSnapshot: () => state.playbackSnapshot,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    seek: (seconds) => deps.getSeek()(seconds),
    toggleQueueShuffle: () => deps.getToggleQueueShuffle()(),
    cycleQueueRepeat: () => deps.getCycleQueueRepeat()(),
    getExperimentalSettings: () => experimentalSettings.getSnapshot(),
    getLastSession: () => multiplayerLastSession.getSnapshot(),
    getPairings: () => multiplayerPairings.getSnapshot(),
    pausePlayer: () => playerController.pause(),
    setActiveWorkspaceTab: (tab) => deps.getSetActiveWorkspaceTab()(tab),
    getRemoteSelections: deps.getRemoteSelections,
    setRemoteSelections: deps.setRemoteSelections,
    translate,
  });
  multiplayerSession = createMultiplayerSession({
    handleHostCommand: (command) => multiplayerController.handleHostCommand(command),
    pauseHostPlayback: () => deps.getPlaybackCommands().pause(),
    resumeHostPlayback: () => { void deps.getPlaybackCommands().play(); }
  });
  multiplayerController.prepareLaunchDialog();
  deps.publish({ multiplayerState: multiplayerSession.getSnapshot() });
  const unsubscribeMultiplayerUi = multiplayerController.subscribe((ui) => {
    deps.publish({
      multiplayerConnectionDialogOpen: ui.dialog.open,
      multiplayerConnectionDialogError: ui.dialog.error,
      multiplayerConnectionOperation: ui.dialog.operation,
      multiplayerConnectionTargetName: ui.dialog.targetName,
      multiplayerToastMessage: ui.toastMessage
    });
  });
  const unsubscribeMultiplayer = multiplayerSession.subscribe((value) => {
    const isClient = value.mode === 'client';
    deps.publish({
      multiplayerState: value,
      isMultiplayerClient: isClient,
      isFreeplayClient: isClient && value.freeplay,
      isSourceFileFreeplayClient: isClient && value.freeplay && value.remoteDelivery.mode === 'source-file',
      videoTrackActive: !isClient && state.playingTrack?.kind === 'video'
    });
    const update = multiplayerController.syncFromSession(value);
    if (update.enteredFreeplay) deps.getSetActiveWorkspaceTab()('library');
    if (update.remoteSelections) deps.setRemoteSelections(update.remoteSelections);
  });
  const freeplayActions = createFreeplayUiActions({
    getIsFreeplayClient: () => state.isFreeplayClient,
    getFreeplayQueue: () => state.multiplayerState.freeplayQueue,
    setFreeplayQueue: (ids) => multiplayerSession.setFreeplayQueue(ids),
    sendCommand: (command) => multiplayerSession.sendCommand(command),
    getShuffleEnabled: () => state.multiplayerState.remoteCatalog.shuffleEnabled,
    getQueueItems: () => state.queueItems,
    getLibraryItems: () => state.libraryItems,
    getFavoriteItems: () => state.favoriteItems,
    getActiveView: () => deps.getActiveView(),
    showLibraryGroup: (target) => deps.getShowLibraryGroup()(target),
    showTrackDetails: () => deps.getShowTrackDetails()(),
    activateTrack: (collection, id) => multiplayerController.activateTrack(collection, id)
  });

  return {
    multiplayerController,
    multiplayerSession,
    freeplayActions,
    unsubscribe() {
      unsubscribeMultiplayerUi();
      unsubscribeMultiplayer();
    }
  };
}
