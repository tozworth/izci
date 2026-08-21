import type {
  MultiplayerSessionController,
  MultiplayerSessionState
} from '$lib/services/multiplayer-types';
import type { MultiplayerCommand } from '$lib/services/multiplayer-protocol';
import { logError } from '$lib/services/logging';
import type { MultiplayerLastSession } from '$lib/stores/multiplayer-last-session';
import { consumeInviteLinkHash, buildInviteLink } from '$lib/services/multiplayer-invite-link';
import type { MultiplayerPairing } from '$lib/stores/multiplayer-pairings';
import type {
  ExperimentalSettings,
  PlaybackSnapshot,
  TrackItem,
  TrackSelection,
  WorkspaceCollection,
  WorkspaceTab
} from '$lib/types';
import type { RemoteSelectionSnapshot } from './main-window-selection';

export type Translate = (
  id: string,
  options?: { default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }
) => string;

export interface MultiplayerConnectionDialogState {
  open: boolean;
  error: string | null;
  operation: 'hosting' | 'joining';
  targetName: string | null;
}

export interface MultiplayerWindowUiState {
  dialog: MultiplayerConnectionDialogState;
  toastMessage: string | null;
}

export interface MultiplayerSessionSync {
  enteredFreeplay: boolean;
  remoteSelections: RemoteSelectionSnapshot | null;
}

interface PlaybackCommandFacade {
  togglePlayback(): void | Promise<void>;
  play(): void | Promise<void>;
  pause(): void;
  stop(): void;
  stepTrack(direction: -1 | 1): void | Promise<void>;
  activateQueueTrack(id: string): void | Promise<void>;
  activateLibraryTrack(id: string): void | Promise<void>;
  activateFavoriteTrack(track: TrackItem): void | Promise<void>;
}

export interface MultiplayerWindowControllerDeps {
  getSession(): MultiplayerSessionController;
  getPlaybackCommands(): PlaybackCommandFacade;
  getPlayingTrack(): TrackItem | null;
  getPlaybackSnapshot(): PlaybackSnapshot;
  getQueueItems(): TrackItem[];
  getLibraryItems(): TrackItem[];
  getFavoriteItems(): TrackItem[];
  seek(seconds: number): void;
  toggleQueueShuffle(): void;
  cycleQueueRepeat(): void;
  getExperimentalSettings(): ExperimentalSettings;
  getLastSession(): MultiplayerLastSession | null;
  getPairings(): MultiplayerPairing[];
  pausePlayer(): void;
  setActiveWorkspaceTab(tab: WorkspaceTab): void;
  getRemoteSelections(): RemoteSelectionSnapshot;
  setRemoteSelections(selections: RemoteSelectionSnapshot): void;
  translate: Translate;
}

/**
 * Main-window multiplayer orchestration: coordinates the multiplayer session
 * (host/client sides live in multiplayer-host.ts / multiplayer-client.ts via
 * multiplayer-session.ts), the connection dialog state, toasts, and the
 * host/join/invite handlers. The component subscribes and applies the pushed
 * UI state to its reactive lets; this controller owns the decisions.
 */
export function createMultiplayerWindowController(deps: MultiplayerWindowControllerDeps) {
  let state: MultiplayerSessionState | null = null;
  let dialog: MultiplayerConnectionDialogState = {
    open: false,
    error: null,
    operation: 'joining',
    targetName: null
  };
  let toastMessage: string | null = null;
  let toastTimer: number | null = null;
  let lastToastMessage: string | null = null;
  let lastPrunedRemoteCatalog: MultiplayerSessionState['remoteCatalog'] | null = null;
  let inviteLinkListenerAttached = false;
  const listeners = new Set<(ui: MultiplayerWindowUiState) => void>();

  function publish(): void {
    const ui: MultiplayerWindowUiState = {
      dialog: { ...dialog },
      toastMessage
    };
    for (const listener of listeners) listener(ui);
  }

  function subscribe(listener: (ui: MultiplayerWindowUiState) => void): () => void {
    listeners.add(listener);
    listener({ dialog: { ...dialog }, toastMessage });
    return () => {
      listeners.delete(listener);
    };
  }

  function showToast(message: string): void {
    lastToastMessage = message;
    toastMessage = message;
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      toastMessage = null;
      publish();
    }, 9_000);
    publish();
  }

  function dismissToast(): void {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = null;
    toastMessage = null;
    publish();
  }

  function beginConnection(operation: 'hosting' | 'joining', targetName: string | null = null): void {
    dialog.operation = operation;
    dialog.targetName = targetName;
    dialog.error = null;
    dialog.open = true;
    publish();
  }

  function failConnection(error: unknown, fallback: string): void {
    dialog.error = error instanceof Error ? error.message : fallback;
    dialog.open = true;
    publish();
  }

  function isConnectionReady(value: MultiplayerSessionState): boolean {
    if (value.connectionStatus !== 'connected' || value.message !== null) return false;
    if (value.mode === 'hosting') return true;
    if (value.mode !== 'client'
      || value.remoteCatalog.revision <= 0
      || value.remoteDelivery.generationId === 'idle') return false;
    if (!value.receiveAudio || value.remoteDelivery.mode === 'none') return true;
    return value.audioStatus === 'playing'
      || value.audioStatus === 'ready'
      || value.audioStatus === 'refused'
      || value.audioStatus === 'disabled';
  }

  function pruneSelection(selection: TrackSelection, ids: Set<string>): TrackSelection {
    const retained = selection.ids.filter((id) => ids.has(id));
    return {
      ids: retained,
      anchorId: selection.anchorId && ids.has(selection.anchorId) ? selection.anchorId : retained[0] ?? null,
      focusId: selection.focusId && ids.has(selection.focusId) ? selection.focusId : retained.at(-1) ?? null
    };
  }

  async function handleHostCommand(command: MultiplayerCommand): Promise<boolean> {
    if (state?.mode !== 'hosting') return false;

    switch (command.type) {
      case 'transport.toggle':
        if (deps.getSession().cancelPendingPlayback()) return true;
        await deps.getPlaybackCommands().togglePlayback();
        return true;
      case 'transport.play':
        await deps.getPlaybackCommands().play();
        return true;
      case 'transport.pause':
        deps.getSession().cancelPendingPlayback();
        deps.getPlaybackCommands().pause();
        return true;
      case 'transport.stop':
        deps.getSession().cancelPendingPlayback();
        deps.getPlaybackCommands().stop();
        return true;
      case 'transport.previous':
        await deps.getPlaybackCommands().stepTrack(-1);
        return true;
      case 'transport.next':
        await deps.getPlaybackCommands().stepTrack(1);
        return true;
      case 'transport.seek':
        if (!deps.getPlayingTrack() || command.seconds > deps.getPlaybackSnapshot().duration + 1) {
          return false;
        }
        deps.seek(command.seconds);
        return true;
      case 'queue.shuffle':
        deps.toggleQueueShuffle();
        return true;
      case 'queue.repeat':
        deps.cycleQueueRepeat();
        return true;
      case 'collection.activate': {
        const items = command.collection === 'queue'
          ? deps.getQueueItems()
          : command.collection === 'favorites'
            ? deps.getFavoriteItems()
            : deps.getLibraryItems();
        if (!items.some((item) => item.id === command.itemId)) return false;
        if (command.collection === 'queue') {
          await deps.getPlaybackCommands().activateQueueTrack(command.itemId);
        } else if (command.collection === 'favorites') {
          const track = deps.getFavoriteItems().find((item) => item.id === command.itemId);
          if (!track) return false;
          await deps.getPlaybackCommands().activateFavoriteTrack(track);
        } else {
          await deps.getPlaybackCommands().activateLibraryTrack(command.itemId);
        }
        return true;
      }
    }
  }

  function activateTrack(collection: WorkspaceCollection | 'favorites', id: string): boolean {
    if (state?.mode !== 'client') return false;
    deps.getSession().sendCommand({ type: 'collection.activate', collection, itemId: id });
    return true;
  }

  function syncFromSession(value: MultiplayerSessionState): MultiplayerSessionSync {
    const enteredFreeplay = value.freeplay && !(state?.freeplay ?? false);
    state = value;

    if (value.mode === 'client' && value.reconnecting) {
      dialog.open = true;
      dialog.error = null;
    }
    if (dialog.open
      && (value.connectionStatus === 'error' || value.connectionStatus === 'disconnected')
      && !value.reconnecting
      && value.message
      && value.message !== 'Reconnecting to the host...') {
      dialog.error = value.message;
    }
    if (dialog.open && value.reconnecting) {
      dialog.error = null;
    }
    if (isConnectionReady(value)) {
      lastToastMessage = null;
      dialog.open = false;
      dialog.error = null;
    }
    if (value.message
      && value.message !== lastToastMessage
      && value.message !== 'Reconnecting to the host...'
      && !dialog.open) {
      showToast(value.message);
    }
    publish();

    if (value.mode !== 'client') {
      lastPrunedRemoteCatalog = null;
      return { enteredFreeplay, remoteSelections: null };
    }
    if (value.remoteCatalog === lastPrunedRemoteCatalog) {
      return { enteredFreeplay, remoteSelections: null };
    }
    lastPrunedRemoteCatalog = value.remoteCatalog;

    const queueIds = new Set(value.remoteCatalog.queue.map((item) => item.id));
    const libraryIds = new Set(value.remoteCatalog.library.map((item) => item.id));
    const favoriteIds = new Set(value.remoteCatalog.favorites.map((item) => item.id));
    const current = deps.getRemoteSelections();
    return {
      enteredFreeplay,
      remoteSelections: {
        track: pruneSelection(current.track, queueIds),
        library: pruneSelection(current.library, libraryIds),
        favorites: pruneSelection(current.favorites, favoriteIds)
      }
    };
  }

  function prepareLaunchDialog(): void {
    const settings = deps.getExperimentalSettings();
    if (!settings.multiplayer) return;
    const last = settings.multiplayerRestoreLastSession
      ? deps.getLastSession()
      : null;
    if (!last && !settings.multiplayerAutoHost) return;
    if (last?.mode === 'client') {
      beginConnection('joining', last.hostName);
      return;
    }
    beginConnection('hosting');
  }

  async function host(): Promise<void> {
    beginConnection('hosting');
    try {
      await deps.getSession().startHosting();
    } catch (error) {
      failConnection(error, 'Could not start multiplayer hosting.');
    }
  }

  async function join(inviteCode: string): Promise<void> {
    beginConnection('joining');
    deps.pausePlayer();
    try {
      await deps.getSession().join(inviteCode);
    } catch (error) {
      failConnection(error, 'Could not join that multiplayer session.');
    }
  }

  async function joinWithPrompt(): Promise<void> {
    const inviteCode = window.prompt(
      deps.translate('main.multiplayer.enterInvite', { default: 'Enter the host invite code' })
    );
    if (!inviteCode) return;
    await join(inviteCode);
  }

  async function joinPaired(hostId: string): Promise<void> {
    const pairing = deps.getPairings().find((candidate) => candidate.hostId === hostId);
    beginConnection('joining', pairing?.name ?? null);
    deps.pausePlayer();
    try {
      await deps.getSession().joinPaired(hostId);
    } catch (error) {
      failConnection(error, 'Could not join that paired host.');
    }
  }

  async function copyInvite(): Promise<void> {
    const inviteCode = state?.inviteCode ?? null;
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(buildInviteLink(inviteCode));
    } catch {
      window.prompt(
        deps.translate('main.multiplayer.copyInviteFallback', { default: 'Copy this invite code' }),
        buildInviteLink(inviteCode)
      );
    }
  }

  function ensureInviteLinkListener(): void {
    if (inviteLinkListenerAttached || typeof window === 'undefined') return;
    inviteLinkListenerAttached = true;
    window.addEventListener('hashchange', () => {
      const code = consumeInviteLinkHash();
      if (code) void join(code);
    });
  }

  async function startLaunch(): Promise<void> {
    const settings = deps.getExperimentalSettings();
    if (!settings.multiplayer) return;
    const inviteCode = consumeInviteLinkHash();
    if (inviteCode) {
      await join(inviteCode);
    }
    ensureInviteLinkListener();
    if (inviteCode) return;
    if (settings.multiplayerRestoreLastSession) {
      const restored = await deps.getSession().restoreLastSession().catch((error) => {
        logError('multiplayer', 'Last session restore could not start', error);
        return null;
      });
      if (restored === 'client') {
        deps.pausePlayer();
        return;
      }
      if (restored === 'hosting') return;
    }
    if (!settings.multiplayerAutoHost) return;
    try {
      await deps.getSession().startHosting({ silent: true });
    } catch (error) {
      logError('multiplayer', 'Persistent peer hosting could not start', error);
    }
  }

  function dismissConnectionDialog(): void {
    dialog.open = false;
    dialog.error = null;
    if (state?.mode === 'client') {
      void deps.getSession().leave();
    } else if (state?.mode === 'hosting' && state.connectionStatus !== 'connected') {
      void deps.getSession().stopHosting();
    }
    publish();
  }

  function destroy(): void {
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = null;
    listeners.clear();
  }

  return {
    handleHostCommand,
    activateTrack,
    syncFromSession,
    subscribe,
    prepareLaunchDialog,
    host,
    join,
    joinWithPrompt,
    joinPaired,
    copyInvite,
    startLaunch,
    dismissConnectionDialog,
    dismissToast,
    destroy
  };
}
