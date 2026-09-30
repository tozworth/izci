<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import MiniPlayer from '$lib/components/mini-player/MiniPlayer.svelte';
  import type { PlaybackSnapshot, TrackItem } from '$lib/types';
  import { MINI_PLAYER_COMMAND_EVENT, MINI_PLAYER_REQUEST_EVENT, MINI_PLAYER_STATE_EVENT, type MiniPlayerCommand, type MiniPlayerView } from './mini-player-protocol';

  const snapshot = writable<PlaybackSnapshot>({ state: 'idle', currentTime: 0, duration: 0, volume: 1, muted: false, backend: null });
  const track = writable<TrackItem | null>(null);
  const selectedTrack = writable<TrackItem | null>(null);
  const artwork = writable<string | null>(null);
  let pinned = localStorage.getItem('izci.desktop.miniPlayerPinned') !== 'false';

  function command(command: MiniPlayerCommand): void {
    void emitTo('main', MINI_PLAYER_COMMAND_EVENT, command).catch(console.error);
  }

  async function togglePin(): Promise<void> {
    const next = !pinned;
    await invoke('pin_mini_player', { pinned: next });
    pinned = next;
    localStorage.setItem('izci.desktop.miniPlayerPinned', String(pinned));
  }

  function drag(event: PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest('button, input, a, select, textarea, [role="button"]')) return;
    void getCurrentWindow().startDragging().catch(console.error);
  }

  onMount(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<MiniPlayerView>(MINI_PLAYER_STATE_EVENT, ({ payload }) => {
      snapshot.set(payload.snapshot);
      track.set(payload.track);
      selectedTrack.set(payload.selectedTrack);
      artwork.set(payload.artworkUrl);
    }).then(async (release) => {
      if (disposed) { release(); return; }
      unlisten = release;
      await invoke('pin_mini_player', { pinned });
      await emitTo('main', MINI_PLAYER_REQUEST_EVENT);
    }).catch(console.error);
    return () => { disposed = true; unlisten?.(); };
  });
</script>

<div class="desktop-mini-player" role="presentation" onpointerdown={drag}>
  <div class="window-controls">
    <button class:active={pinned} title={$t('main.miniPlayer.alwaysOnTop')} aria-label={$t('main.miniPlayer.alwaysOnTop')} aria-pressed={pinned} onclick={() => void togglePin().catch(console.error)}><span class="material-symbols-outlined">keep</span></button>
    <button title={$t('main.miniPlayer.restoreWindow')} aria-label={$t('main.miniPlayer.restoreWindow')} onclick={() => void invoke('restore_main_window').catch(console.error)}><span class="material-symbols-outlined">open_in_full</span></button>
    <button title={$t('main.miniPlayer.close')} aria-label={$t('main.miniPlayer.close')} onclick={() => void invoke('close_mini_player').catch(console.error)}><span class="material-symbols-outlined">close</span></button>
  </div>
  <MiniPlayer snapshotStore={snapshot} trackStore={track} selectedTrackStore={selectedTrack} artworkUrlStore={artwork}
    onTogglePlayback={() => command({ action: 'togglePlayback' })}
    onPreviousTrack={() => command({ action: 'previousTrack' })}
    onNextTrack={() => command({ action: 'nextTrack' })}
    onSeek={(value) => command({ action: 'seek', value })}
    onVolume={(value) => command({ action: 'setVolume', value })}
    onToggleMute={() => command({ action: 'toggleMute' })}
    onEnterNowPlaying={() => command({ action: 'enterNowPlaying' })} />
</div>

<style>
  :global(html), :global(body), :global(#app) { height: 100%; width: 100%; margin: 0; overflow: hidden; }
  .desktop-mini-player { position: relative; height: 100%; }
  .window-controls {
    position: absolute;
    top: 1px;
    right: 2px;
    z-index: 1;
    display: flex;
    height: 22px;
    background: var(--window-topbar-bg);
    color: var(--window-topbar-text);
    opacity: 0;
    pointer-events: none;
  }
  .desktop-mini-player:hover .window-controls,
  .window-controls:focus-within { opacity: 1; pointer-events: auto; }
  button { width: 24px; padding: 0; border: 0; border-radius: 0; background: transparent; color: inherit; }
  button:hover, button.active { background: var(--hover-control); }
  .material-symbols-outlined { font-size: 16px; }
  :global(.desktop-mini-player .mini-player) { height: 100%; min-height: 0; }
</style>
