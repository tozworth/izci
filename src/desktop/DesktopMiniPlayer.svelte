<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import { t } from 'svelte-i18n';
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import MiniPlayer from '$lib/components/mini-player/MiniPlayer.svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
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
    <button aria-label={$t('main.miniPlayer.alwaysOnTop')} aria-pressed={pinned} onclick={() => void togglePin().catch(console.error)}>
      <span class="material-symbols-outlined" aria-hidden="true">keep</span>
      <HoverTooltip nowrap>{$t('main.miniPlayer.alwaysOnTop')}</HoverTooltip>
    </button>
    <button aria-label={$t('main.miniPlayer.restoreWindow')} onclick={() => void invoke('restore_main_window').catch(console.error)}>
      <span class="material-symbols-outlined" aria-hidden="true">open_in_full</span>
      <HoverTooltip nowrap>{$t('main.miniPlayer.restoreWindow')}</HoverTooltip>
    </button>
    <button aria-label={$t('main.miniPlayer.close')} onclick={() => void invoke('dismiss_mini_player').catch(console.error)}>
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
      <HoverTooltip nowrap>{$t('main.miniPlayer.close')}</HoverTooltip>
    </button>
  </div>
  <MiniPlayer showTooltips snapshotStore={snapshot} trackStore={track} selectedTrackStore={selectedTrack} artworkUrlStore={artwork}
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
  button { width: 24px; padding: 0; border: 0; border-radius: 0; background: var(--window-topbar-bg); color: inherit; cursor: default; }
  button:hover { background: var(--window-topbar-hover-surface); }
  button[aria-pressed='true'] { color: var(--accent-strong); }
  button:focus-visible { outline: 1px solid var(--accent-strong); outline-offset: -2px; }
  .material-symbols-outlined { font-size: 16px; }
  :global(.desktop-mini-player .mini-player) {
    height: 100%; min-height: 0; padding: 4px; gap: 2px;
  }
  :global(.desktop-mini-player .mini-player-track-row) { gap: 6px; }
  :global(.desktop-mini-player .mini-player-track-copy) { align-self: flex-start; gap: 2px; }
  :global(.desktop-mini-player .mini-player-track-copy strong) { font-size: 0.82rem; }
  :global(.desktop-mini-player .mini-player-track-copy span) { font-size: 0.7rem; }
  :global(.desktop-mini-player .mini-player-transport button) { width: 1.9rem; height: 1.9rem; }
  :global(.desktop-mini-player .mini-player-transport button .material-symbols-outlined) { font-size: 1.4rem; }
  :global(.desktop-mini-player .mini-player-transport .mini-player-primary-button) { width: 2.3rem; height: 2.3rem; }
  :global(.desktop-mini-player .mini-player-transport .mini-player-primary-button .material-symbols-outlined) { font-size: 1.75rem; }
  :global(.desktop-mini-player .mini-player-artwork) {
    width: 2.7rem; height: 2.7rem; flex-basis: 2.7rem;
  }
  :global(.desktop-mini-player .mini-player-control-row) {
    grid-template-columns: max-content minmax(3rem, 1fr) max-content 1.4rem 4.8rem;
    gap: 2px;
  }
  :global(.desktop-mini-player .mini-player-time) { justify-content: flex-start; }
  :global(.desktop-mini-player .mini-player-time:first-child) { padding-right: 2px; }
  :global(.desktop-mini-player .mini-player-range + .mini-player-time) { padding-left: 2px; }
  :global(.desktop-mini-player .mini-player-volume-button) { width: 1.4rem; height: 1.25rem; }
  @media (max-width: 360px) {
    :global(.desktop-mini-player .mini-player-control-row) {
      grid-template-columns: max-content minmax(3rem, 1fr) max-content 1.4rem;
    }
  }
</style>
