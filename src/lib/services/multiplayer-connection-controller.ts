import { writable, type Readable } from 'svelte/store';
import { logError } from '$lib/services/logging';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { multiplayerPairings } from '$lib/stores/multiplayer-pairings';
import type { MultiplayerSessionController } from '$lib/services/multiplayer-types';

export interface MultiplayerConnectionState {
  dialogOpen: boolean;
  dialogError: string | null;
  operation: 'hosting' | 'joining';
  targetName: string | null;
  toastMessage: string | null;
}

export interface CreateMultiplayerConnectionControllerOptions {
  session: MultiplayerSessionController;
  pausePlayback: () => void;
}

export interface MultiplayerConnectionController extends Readable<MultiplayerConnectionState> {
  getSnapshot(): MultiplayerConnectionState;
  begin(operation: 'hosting' | 'joining', targetName?: string | null): void;
  fail(error: unknown, fallback: string): void;
  dismissDialog(): void;
  dismissToast(): void;
  host(): Promise<void>;
  join(inviteCode: string): Promise<void>;
  joinPaired(hostId: string): Promise<void>;
  startLaunch(): Promise<void>;
  destroy(): void;
}

const TOAST_DURATION_MS = 9_000;

export function createMultiplayerConnectionController(
  options: CreateMultiplayerConnectionControllerOptions
): MultiplayerConnectionController {
  const { session, pausePlayback } = options;
  const initialState: MultiplayerConnectionState = {
    dialogOpen: false,
    dialogError: null,
    operation: 'joining',
    targetName: null,
    toastMessage: null
  };
  const store = writable<MultiplayerConnectionState>(initialState);

  let state: MultiplayerConnectionState = initialState;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastToastMessage: string | null = null;

  function publish(patch: Partial<MultiplayerConnectionState>): void {
    state = { ...state, ...patch };
    store.set(state);
  }

  function showToast(message: string): void {
    lastToastMessage = message;
    publish({ toastMessage: message });
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(dismissToast, TOAST_DURATION_MS);
  }

  function dismissToast(): void {
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = null;
    publish({ toastMessage: null });
  }

  function begin(operation: 'hosting' | 'joining', targetName: string | null = null): void {
    publish({
      operation,
      targetName,
      dialogError: null,
      dialogOpen: true
    });
  }

  function fail(error: unknown, fallback: string): void {
    publish({
      dialogError: error instanceof Error ? error.message : fallback,
      dialogOpen: true
    });
  }

  function dismissDialog(): void {
    publish({ dialogOpen: false, dialogError: null });
    const current = session.getSnapshot();
    if (current.mode === 'client') void session.leave();
    else if (current.mode === 'hosting' && current.connectionStatus !== 'connected') {
      void session.stopHosting();
    }
  }

  async function host(): Promise<void> {
    begin('hosting');
    try {
      await session.startHosting();
    } catch (error) {
      fail(error, 'Could not start multiplayer hosting.');
    }
  }

  async function join(inviteCode: string): Promise<void> {
    begin('joining');
    pausePlayback();
    try {
      await session.join(inviteCode);
    } catch (error) {
      fail(error, 'Could not join that multiplayer session.');
    }
  }

  async function joinPaired(hostId: string): Promise<void> {
    const pairing = multiplayerPairings.getSnapshot().find((candidate) => candidate.hostId === hostId);
    begin('joining', pairing?.name ?? null);
    pausePlayback();
    try {
      await session.joinPaired(hostId);
    } catch (error) {
      fail(error, 'Could not join that paired host.');
    }
  }

  /**
   * Launch-time multiplayer: restores the last session ("Restore last
   * session", checked by default) and, when nothing client-side was restored,
   * silently starts hosting for paired devices ("Always host for peers").
   * Everything here is deliberately quiet: no connection dialog, and client
   * failures hand off to the reconnect loop instead of surfacing an error.
   */
  async function startLaunch(): Promise<void> {
    const settings = experimentalSettings.getSnapshot();
    if (!settings.multiplayer) return;
    if (settings.multiplayerRestoreLastSession) {
      const restored = await session.restoreLastSession().catch(() => null);
      if (restored === 'client') {
        // A client session takes over the player; local playback must not
        // keep running underneath the remote session.
        pausePlayback();
        return;
      }
      if (restored === 'hosting') return;
    }
    if (!settings.multiplayerAutoHost) return;
    try {
      await session.startHosting({ silent: true });
    } catch (error) {
      logError('multiplayer', 'Could not auto-start hosting', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const unsubscribeSession = session.subscribe((value) => {
    if (state.dialogOpen
      && (value.connectionStatus === 'error' || value.connectionStatus === 'disconnected')
      && value.message
      && value.message !== 'Reconnecting to the host...') {
      publish({ dialogError: value.message });
    }
    if (value.connectionStatus === 'connected' && value.message === null) {
      lastToastMessage = null;
      publish({ dialogOpen: false, dialogError: null });
    }
    if (value.message
      && value.message !== lastToastMessage
      && value.message !== 'Reconnecting to the host...'
      && !state.dialogOpen) {
      showToast(value.message);
    }
  });

  function destroy(): void {
    unsubscribeSession();
    if (toastTimer !== null) window.clearTimeout(toastTimer);
    toastTimer = null;
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    begin,
    fail,
    dismissDialog,
    dismissToast,
    host,
    join,
    joinPaired,
    startLaunch,
    destroy
  };
}
