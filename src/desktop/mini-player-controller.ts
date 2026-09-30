import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import type { MiniPlayerController, MiniPlayerControllerOptions, MiniPlayerState } from '$lib/services/mini-player-types';
import {
  MINI_PLAYER_CLOSED_EVENT, MINI_PLAYER_COMMAND_EVENT, MINI_PLAYER_REQUEST_EVENT,
  MINI_PLAYER_STATE_EVENT, miniPlayerTrackView, parseMiniPlayerCommand
} from './mini-player-protocol';

export function createDesktopMiniPlayerController(options: MiniPlayerControllerOptions): MiniPlayerController {
  let state: MiniPlayerState = { supported: true, active: false, opening: false };
  const store = writable(state);
  let destroyed = false;
  let operation = 0;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let artworkSource: string | null = null;
  let artworkData: string | null = null;
  let artworkRevision = 0;
  const listeners: UnlistenFn[] = [];

  function setState(patch: Partial<MiniPlayerState>): void {
    state = { ...state, ...patch };
    store.set(state);
  }

  async function publish(): Promise<void> {
    if (destroyed || !state.active) return;
    await emitTo('mini-player', MINI_PLAYER_STATE_EVENT, {
      snapshot: get(options.snapshot),
      track: miniPlayerTrackView(get(options.track)),
      selectedTrack: miniPlayerTrackView(get(options.selectedTrack)),
      artworkUrl: artworkData
    });
  }

  function schedulePublish(): void {
    if (destroyed || !state.active || publishTimer !== undefined) return;
    // Use a timer rather than rAF: the playback window may be minimized.
    publishTimer = setTimeout(() => {
      publishTimer = undefined;
      void publish().catch(reportError);
    }, 100);
  }

  function reportError(error: unknown): void {
    console.error('Desktop mini player failed.', error);
  }

  async function refreshArtwork(): Promise<void> {
    const source = get(options.artworkUrl);
    if (source === artworkSource) return;
    artworkSource = source;
    artworkData = null;
    const revision = ++artworkRevision;
    schedulePublish();
    if (!source || !state.active) return;
    try {
      const response = await fetch(source);
      if (!response.ok) return;
      const blob = await response.blob();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      if (destroyed || revision !== artworkRevision) return;
      artworkData = data;
      schedulePublish();
    } catch {
      // Revoked/loading artwork is optional; the playback owner will publish its replacement.
    }
  }

  const unsubscribers = [
    options.snapshot.subscribe(schedulePublish),
    options.track.subscribe(schedulePublish),
    options.selectedTrack.subscribe(schedulePublish),
    options.artworkUrl.subscribe(() => { void refreshArtwork(); })
  ];

  const ready = Promise.all([
    listen(MINI_PLAYER_REQUEST_EVENT, () => { void publish().catch(reportError); }),
    listen(MINI_PLAYER_CLOSED_EVENT, () => setState({ active: false, opening: false })),
    listen<unknown>(MINI_PLAYER_COMMAND_EVENT, ({ payload }) => {
      if (destroyed || !state.active) return;
      const command = parseMiniPlayerCommand(payload);
      if (!command) return;
      if (command.action === 'seek') {
        options.handlers.seek(Math.min(command.value, get(options.snapshot).duration));
      } else if (command.action === 'setVolume') {
        options.handlers.setVolume(command.value);
      } else if (command.action === 'enterNowPlaying') {
        void invoke('restore_main_window').then(() => options.handlers.enterNowPlaying()).catch(reportError);
      } else {
        options.handlers[command.action]();
      }
    })
  ].map((registration) => registration.then((unlisten) => {
    if (destroyed) unlisten();
    else listeners.push(unlisten);
  })));
  void ready.catch(reportError);

  async function open(): Promise<void> {
    if (destroyed || state.opening) return;
    const currentOperation = ++operation;
    setState({ opening: true });
    try {
      await ready;
      if (destroyed || currentOperation !== operation) return;
      setState({ active: true });
      artworkSource = null;
      void refreshArtwork();
      await publish();
      if (destroyed || !state.active || currentOperation !== operation) return;
      await invoke('open_mini_player');
      if (destroyed || !state.active) await invoke('close_mini_player');
    } catch (error) {
      if (currentOperation === operation) setState({ active: false });
      reportError(error);
    } finally {
      if (currentOperation === operation) setState({ opening: false });
    }
  }

  function close(): void {
    ++operation;
    setState({ active: false, opening: false });
    void invoke('close_mini_player').catch(reportError);
  }

  return {
    subscribe: store.subscribe,
    getSnapshot: () => state,
    open,
    close,
    toggle: () => { if (state.active || state.opening) close(); else void open(); },
    destroy: () => {
      destroyed = true;
      ++artworkRevision;
      if (publishTimer !== undefined) clearTimeout(publishTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      listeners.forEach((unlisten) => unlisten());
      if (state.active || state.opening) close();
    }
  };
}
