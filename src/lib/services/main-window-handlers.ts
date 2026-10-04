/**
 * Main-window panel-handler factory for the composition root.
 *
 * Owns the queue / library / up-next `WorkspacePanelHandlers` objects that
 * `App.svelte` passes into `AppWorkspace` / `MobileWorkspace`. Each handler
 * is a thin forwarder resolving against the same getter bundle the rest of
 * the main window uses (multiplayer/freeplay client routing, workspace
 * collections, selection, playback commands, and transport). Pure moves from
 * `App.svelte` — no behavior changes.
 */

import type {
  UpNextPanelHandlers,
  WorkspacePanelHandlers
} from '$lib/components/workspace/types';
import type { FilesystemFolder } from '$lib/services/filesystem-folders';
import { imageSession } from './image-session';
import type {
  LibraryViewId,
  TrackSelection,
  WorkspaceCollection
} from '$lib/types';
import type { MultiplayerCollection } from '$lib/services/multiplayer-protocol';

interface MainWindowPanelHandlerDeps {
  getIsMultiplayerClient(): boolean;
  getIsFreeplayClient(): boolean;
  workspaceCollections: {
    handleAddFiles(files: FileList | File[], target: WorkspaceCollection): void;
    handleQueueContextAction(actionId: string, ids: string[]): void;
    handleLibraryContextAction(actionId: string, ids: string[]): void;
    handleFavoriteContextAction(actionId: string, ids: string[]): void;
    handleUpNextContextAction(actionId: string, ids: string[]): void;
  };
  workspaceShell: {
    clearLibraryGroupRequest(detail: number): void;
    selectTrack(
      collection: WorkspaceCollection,
      id: string,
      options: { range: boolean; toggle: boolean }
    ): void;
    setCollectionSelection(collection: WorkspaceCollection, selection: TrackSelection): void;
  };
  filesystemFolders: {
    rememberMany(handles: FileSystemDirectoryHandle[]): Promise<FilesystemFolder[]>;
  };
  importController: {
    openFiles(target: WorkspaceCollection): Promise<void>;
  };
  windowSelection: {
    handleLibraryPanelSelect(
      event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
    ): void;
    handleLibraryPanelSetSelection(event: CustomEvent<TrackSelection>): void;
  };
  getActiveView(): LibraryViewId;
  multiplayerController: {
    activateTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean;
  };
  sendTrackToChat(collection: MultiplayerCollection, id: string): void;
  freeplayActions: {
    handleQueueContextAction(actionId: string, ids: string[]): void;
    handleLibraryContextAction(actionId: string, ids: string[]): void;
  };
  upNext: {
    remove(ids: string[]): void;
  };
  playbackCommands: {
    activateQueueTrack(id: string): Promise<void>;
  };
  activateLibraryPanelTrack(id: string): Promise<void>;
  transport: {
    toggleQueueShuffle(): void;
    cycleQueueRepeat(): void;
  };
}

/**
 * Create the queue / library / up-next panel handlers for the main-window
 * workspace, routing through the same multiplayer-aware forwarders the rest
 * of the app uses.
 */
export function createMainWindowPanelHandlers(deps: MainWindowPanelHandlerDeps): {
  queuePanelHandlers: WorkspacePanelHandlers;
  libraryPanelHandlers: WorkspacePanelHandlers;
  upNextPanelHandlers: UpNextPanelHandlers;
} {
  const queuePanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => {
      if (!deps.getIsMultiplayerClient()) deps.workspaceCollections.handleAddFiles(files, 'queue');
    },
    addFolders: (handles) => {
      if (!deps.getIsMultiplayerClient()) void deps.filesystemFolders.rememberMany(handles);
    },
    openFiles: () => {
      if (!deps.getIsMultiplayerClient()) void deps.importController.openFiles('queue');
    },
    select: (event) => deps.workspaceShell.selectTrack('queue', event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    }),
    setSelection: (event) => deps.workspaceShell.setCollectionSelection('queue', event.detail),
    activate: (event) => {
      if (!deps.multiplayerController.activateTrack('queue', event.detail)) {
        void deps.playbackCommands.activateQueueTrack(event.detail);
      }
    },
    contextAction: (event) => {
      if (event.detail.actionId === 'send-to-chat') {
        deps.sendTrackToChat('queue', event.detail.ids[0] ?? '');
        return;
      }
      if (deps.getIsFreeplayClient()) {
        deps.freeplayActions.handleQueueContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      if (deps.getIsMultiplayerClient()) {
        deps.freeplayActions.handleQueueContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      deps.workspaceCollections.handleQueueContextAction(event.detail.actionId, event.detail.ids);
    },
    toggleShuffle: () => deps.transport.toggleQueueShuffle(),
    cycleRepeat: () => deps.transport.cycleQueueRepeat()
  };

  const libraryPanelHandlers: WorkspacePanelHandlers = {
    viewImage: (event) => { void imageSession.open(event.detail.item, event.detail.items); },
    addFiles: (files) => {
      if (!deps.getIsMultiplayerClient()) deps.workspaceCollections.handleAddFiles(files, 'library');
    },
    addFolders: (handles) => {
      if (!deps.getIsMultiplayerClient()) void deps.filesystemFolders.rememberMany(handles);
    },
    openFiles: () => {
      if (!deps.getIsMultiplayerClient()) void deps.importController.openFiles('library');
    },
    select: (event) => deps.windowSelection.handleLibraryPanelSelect(event),
    setSelection: (event) => deps.windowSelection.handleLibraryPanelSetSelection(event),
    activate: (event) => void deps.activateLibraryPanelTrack(event.detail),
    libraryGroupRequestHandled: (event) => deps.workspaceShell.clearLibraryGroupRequest(event.detail),
    contextAction: (event) => {
      if (event.detail.actionId === 'send-to-chat') {
        deps.sendTrackToChat(
          deps.getActiveView() === 'favorites' ? 'favorites' : 'library',
          event.detail.ids[0] ?? ''
        );
        return;
      }
      if (deps.getIsFreeplayClient()) {
        deps.freeplayActions.handleLibraryContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      if (deps.getIsMultiplayerClient()) {
        deps.freeplayActions.handleLibraryContextAction(event.detail.actionId, event.detail.ids);
        return;
      }
      deps.getActiveView() === 'favorites'
        ? deps.workspaceCollections.handleFavoriteContextAction(
            event.detail.actionId,
            event.detail.ids
          )
        : deps.workspaceCollections.handleLibraryContextAction(
            event.detail.actionId,
            event.detail.ids
          );
    }
  };

  const upNextPanelHandlers: UpNextPanelHandlers = {
    activate: (event) => {
      if (deps.getIsFreeplayClient() || deps.getIsMultiplayerClient()) return;
      deps.upNext.remove([event.detail]);
      void deps.playbackCommands.activateQueueTrack(event.detail);
    },
    contextAction: (event) => {
      if (event.detail.actionId === 'send-to-chat') {
        deps.sendTrackToChat('queue', event.detail.ids[0] ?? '');
        return;
      }
      if (deps.getIsFreeplayClient() || deps.getIsMultiplayerClient()) return;
      deps.workspaceCollections.handleUpNextContextAction(event.detail.actionId, event.detail.ids);
    }
  };

  return { queuePanelHandlers, libraryPanelHandlers, upNextPanelHandlers };
}
