import type {
  MultiplayerSessionController,
  MultiplayerSessionState
} from '$lib/services/multiplayer-types';
import type {
  MultiplayerChatTrackLink,
  MultiplayerCommand
} from '$lib/services/multiplayer-protocol';
import { logError } from '$lib/services/logging';
import { consumeInviteLinkHash } from '$lib/services/multiplayer-invite-link';
import {
  consumeServerInvite,
  parseServerInviteText,
  ServerInviteError
} from '$lib/services/multiplayer-server-invite';
import { serverSetup } from '$lib/services/multiplayer-server-setup';
import { hasBuiltinSignaling } from '$platform';
import { getRememberedServerHostKey } from '$lib/stores/multiplayer-server-host-keys';
import type {
  MultiplayerSettings,
  PlaybackSnapshot,
  TrackItem,
  TrackSelection,
  WorkspaceCollection,
  WorkspaceTab
} from '$lib/types';
import type { RemoteSelectionSnapshot } from './main-window-selection';

type Translate = (
  id: string,
  options?: { default?: string; values?: Record<string, string | number | boolean | Date | null | undefined> }
) => string;

interface MultiplayerConnectionDialogState {
  open: boolean;
  error: string | null;
  operation: 'hosting' | 'joining';
  targetName: string | null;
}

interface MultiplayerWindowUiState {
  dialog: MultiplayerConnectionDialogState;
  toastMessage: string | null;
}

interface MultiplayerSessionSync {
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

interface MultiplayerWindowControllerDeps {
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
  playQueueItemsNext(ids: string[]): void;
  editSharedQueue(type: 'queue.add' | 'queue.replace' | 'queue.remove' | 'queue.randomize', ids: string[]): boolean;
  playCollectionItemsNext(collection: 'library' | 'favorites', ids: string[]): boolean;
  getMultiplayerSettings(): MultiplayerSettings;
  pausePlayer(): void;
  setActiveWorkspaceTab(tab: WorkspaceTab): void;
  openMultiplayerOptions(): void;
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
  let connectionAttempt = 0;

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
    connectionAttempt += 1;
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
    if (value.mode !== 'client') return false;
    if (!value.receiveAudio || value.remoteDelivery.mode === 'none') return true;
    if (value.remoteCatalog.revision <= 0 || value.remoteDelivery.generationId === 'idle') return false;
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
      case 'queue.randomize':
      case 'queue.add':
      case 'queue.replace':
      case 'queue.remove':
        return deps.editSharedQueue(command.type, 'itemIds' in command ? command.itemIds : []);
      case 'queue.play-next': {
        if (command.collection !== 'queue') {
          return deps.playCollectionItemsNext(command.collection, command.itemIds);
        }
        const queueIds = new Set(deps.getQueueItems().map((item) => item.id));
        if (!command.itemIds.every((id) => queueIds.has(id))) {
          return false;
        }
        deps.playQueueItemsNext(command.itemIds);
        return true;
      }
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

  async function activateChatTrack(track: MultiplayerChatTrackLink): Promise<void> {
    if (!state || state.connectionStatus !== 'connected') return;
    if (state.mode === 'client') {
      if (state.freeplay
        && track.collection === 'queue'
        && !state.freeplayQueue.includes(track.itemId)) {
        deps.getSession().setFreeplayQueue([...state.freeplayQueue, track.itemId]);
      }
      deps.getSession().sendCommand({
        type: 'collection.activate',
        collection: track.collection,
        itemId: track.itemId
      });
      return;
    }
    if (state.mode !== 'hosting') return;

    const items = track.collection === 'queue'
      ? deps.getQueueItems()
      : track.collection === 'favorites'
        ? deps.getFavoriteItems()
        : deps.getLibraryItems();
    const source = items.find((item) => item.id === track.itemId);
    if (!source) return;
    if (track.collection === 'queue') {
      await deps.getPlaybackCommands().activateQueueTrack(source.id);
    } else if (track.collection === 'favorites') {
      await deps.getPlaybackCommands().activateFavoriteTrack(source);
    } else {
      await deps.getPlaybackCommands().activateLibraryTrack(source.id);
    }
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

  function isServerHostConfigured(): boolean {
    if (hasBuiltinSignaling && deps.getMultiplayerSettings().multiplayerSignaling === 'builtin') return true;
    const endpoint = deps.getMultiplayerSettings().multiplayerServerEndpoint;
    if (!endpoint) return false;
    return getRememberedServerHostKey(endpoint) !== null;
  }

  async function host(): Promise<void> {
    if (deps.getSession().getSnapshot().mode === 'hosting') {
      serverSetup.openSetup();
      return;
    }
    // No configuration popup: an unconfigured server goes straight to
    // Options > Multiplayer instead of opening a connection dialog that
    // only reports the missing setup.
    if (!isServerHostConfigured()) {
      deps.openMultiplayerOptions();
      return;
    }
    beginConnection('hosting');
    const attempt = connectionAttempt;
    try {
      await serverSetup.hostConfigured();
      if (attempt === connectionAttempt) serverSetup.openSetup();
    } catch (error) {
      if (attempt === connectionAttempt) failConnection(error, 'Could not start Server hosting.');
    }
    return;
  }

  async function joinWithPrompt(): Promise<void> {
    const invite = window.prompt(
      deps.translate('main.multiplayer.server.enterInvite', {
        default: 'Paste the Server invitation link or invite code'
      })
    );
    if (!invite) return;
    let invitation;
    try {
      invitation = parseServerInviteText(
        invite,
        deps.getMultiplayerSettings().multiplayerServerEndpoint
      );
    } catch (error) {
      if (error instanceof ServerInviteError && error.code === 'desktop-required') {
        failConnection(new Error(deps.translate('main.multiplayer.server.desktopRequired')), '');
        return;
      }
      failConnection(error, 'That Server invitation could not be read.');
      return;
    }
    beginConnection('joining', invitation.title);
    deps.pausePlayer();
    await serverSetup.joinInvitation(invitation);
    if (serverSetup.getSnapshot().dialogOpen) {
      dialog.open = false;
      publish();
    }
    return;
  }

  async function copyInvite(): Promise<void> {
    const inviteLink = serverSetup.getSnapshot().inviteLink;
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      window.prompt(
        deps.translate('main.multiplayer.copyInviteFallback', { default: 'Copy this invite link' }),
        inviteLink
      );
    }
  }

  function ensureInviteLinkListener(): void {
    if (inviteLinkListenerAttached || typeof window === 'undefined') return;
    inviteLinkListenerAttached = true;
    window.addEventListener('hashchange', () => {
      handleDeepLinkJoin();
    });
  }

  /**
   * Capture a server invitation without any network traffic: parse
   * locally, stash it as pending, and let the confirmation dialog drive
   * the explicit Join. Returns true when a party fragment was consumed.
   */
  function handleServerDeepLink(): boolean {
    let invitation: ReturnType<typeof consumeServerInvite> = null;
    try {
      invitation = consumeServerInvite();
    } catch (error) {
      logError('multiplayer', 'Server invitation link could not be parsed', error);
      if (error instanceof ServerInviteError) {
        showToast(deps.translate(error.code === 'desktop-required' ? 'main.multiplayer.server.desktopRequired' : 'main.multiplayer.server.inviteInvalid', {
          default: 'That party invitation link could not be read.'
        }));
      }
      return true;
    }
    if (!invitation) return false;
    // Deep links always confirm, even for remembered servers.
    serverSetup.captureInvitation(invitation);
    return true;
  }

  function handleDeepLinkJoin(): void {
    if (handleServerDeepLink()) return;
    const code = consumeInviteLinkHash();
    if (code) showRetiredInvite();
  }

  async function startLaunch(): Promise<void> {
    // Server invitation links are captured even with Multiplayer switched
    // off: capture is local-only and joining stays an explicit dialog
    // choice, so fresh clients can accept deeplinks without gaining the
    // menu section.
    if (handleServerDeepLink()) {
      ensureInviteLinkListener();
      return;
    }
    ensureInviteLinkListener();
    const settings = deps.getMultiplayerSettings();
    const inviteCode = consumeInviteLinkHash();
    if (inviteCode) {
      showRetiredInvite();
    }
    if (inviteCode || !settings.multiplayer) return;
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
  }

  function showRetiredInvite(): void {
    showToast(deps.translate('main.multiplayer.server.legacyRetired', {
      default: 'Legacy multiplayer invitations have been retired. Ask the host for an izci-server invitation.'
    }));
  }

  function dismissConnectionDialog(): void {
    connectionAttempt += 1;
    serverSetup.cancelCurrent();
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
    activateChatTrack,
    syncFromSession,
    subscribe,
    host,
    joinWithPrompt,
    copyInvite,
    startLaunch,
    dismissConnectionDialog,
    dismissToast,
    destroy
  };
}
