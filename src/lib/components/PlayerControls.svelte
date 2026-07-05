<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import {
    extractArtworkPalette,
    type PlayerArtworkColorSet,
    type PlayerArtworkPalette
  } from '$lib/services/artwork-palette';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import {
    appearanceSettings,
    hasArtworkBackdrop,
    hasVisualizerBackdrop,
    toBackdropZoneArtworkStyle
  } from '$lib/stores/appearance-settings';
  import type { Readable } from 'svelte/store';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import type {
    BackdropZoneArtworkSettings,
    BackdropZoneEffect,
    PlaybackSnapshot,
    PlaylistItem
  } from '$lib/types';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let track: PlaylistItem | null = null;
  export let selectedTrack: PlaylistItem | null = null;
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let backdropEffect: BackdropZoneEffect = 'visualizer';
  export let backdropArtworkSettings: BackdropZoneArtworkSettings | null = null;
  export let presentation: 'bar' | 'now-playing' = 'bar';
  export let useArtworkColorsOverride: boolean | null = null;
  export let artworkColorSurfaceBright = false;

  const dispatch = createEventDispatcher<{
    toggle: void;
    previous: void;
    next: void;
    seek: number;
    volume: number;
    mute: void;
    showTrack: string;
  }>();

  const COMPACT_VOLUME_QUERY = '(max-width: 349px)';
  const COMPACT_VOLUME_OPEN_DELAY_MS = 120;
  const RANGE_THUMB_SIZE_REM = 1.05;
  const PLAYER_BAR_RESERVE_PROPERTY = '--player-bar-measured-reserve';

  let playerBarElement: HTMLElement | null = null;
  let playerBarResizeObserver: ResizeObserver | null = null;
  let playerBarReserveFrame: number | null = null;
  let isCompactVolume = false;
  let isVolumePopupOpen = false;
  let volumePopupTimer: ReturnType<typeof window.setTimeout> | null = null;
  let playerArtworkPalette: PlayerArtworkPalette | null = null;
  let playerArtworkPaletteUrl: string | undefined = undefined;
  let playerArtworkPaletteToken = 0;
  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    muted: false,
    backend: null,
    error: undefined
  };
  $: containerElement = presentation === 'bar' ? 'footer' : 'section';

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function handleSeekWheel(event: WheelEvent) {
    if (!track || snapshot.duration <= 0) {
      return;
    }

    const delta = event.deltaY < 0 ? 1 : -1;
    const step = Math.max(snapshot.duration / 100, 1);
    dispatch('seek', clamp(snapshot.currentTime + delta * step, 0, snapshot.duration));
  }

  function handleVolumeWheel(event: WheelEvent) {
    if (snapshot.muted) {
      return;
    }

    const delta = event.deltaY < 0 ? 1 : -1;
    dispatch('volume', clamp(snapshot.volume + delta * 0.05, 0, 1));
  }

  function clearVolumePopupTimer() {
    if (volumePopupTimer !== null) {
      window.clearTimeout(volumePopupTimer);
      volumePopupTimer = null;
    }
  }

  function openVolumePopup() {
    if (!isCompactVolume) {
      return;
    }

    clearVolumePopupTimer();
    volumePopupTimer = window.setTimeout(() => {
      isVolumePopupOpen = true;
      volumePopupTimer = null;
    }, COMPACT_VOLUME_OPEN_DELAY_MS);
  }

  function closeVolumePopup() {
    clearVolumePopupTimer();
    isVolumePopupOpen = false;
  }

  async function syncPlayerArtworkPalette(url: string | undefined): Promise<void> {
    const token = ++playerArtworkPaletteToken;
    playerArtworkPaletteUrl = url;
    playerArtworkPalette = null;

    if (!url) {
      return;
    }

    try {
      const palette = await extractArtworkPalette(url);

      if (token === playerArtworkPaletteToken && playerArtworkPaletteUrl === url) {
        playerArtworkPalette = palette.player;
      }
    } catch {
      if (token === playerArtworkPaletteToken) {
        playerArtworkPalette = null;
      }
    }
  }

  function toPlayerArtworkStyle(palette: PlayerArtworkColorSet | null): string {
    if (!palette) {
      return '';
    }

    return [
      `--text: ${palette.text}`,
      `--text-strong: ${palette.textStrong}`,
      `--muted: ${palette.muted}`,
      `--player-range-fill: ${palette.rangeFill}`,
      `--player-range-track: ${palette.rangeTrack}`,
      `--player-range-border: ${palette.rangeBorder}`,
      `--player-range-thumb: ${palette.rangeThumb}`
    ].join('; ');
  }

  function toRangeProgressStyle(value: number, max: number): string {
    const percent = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
    let fillEnd = '0px';

    if (percent >= 100) {
      fillEnd = '100%';
    } else if (percent > 0) {
      const thumbCenterOffsetRem = RANGE_THUMB_SIZE_REM * (0.5 - percent / 100);
      const offsetSign = thumbCenterOffsetRem < 0 ? '-' : '+';
      fillEnd = `calc(${percent}% ${offsetSign} ${Math.abs(thumbCenterOffsetRem).toFixed(4)}rem)`;
    }

    return `--player-range-progress: ${percent}%; --player-range-fill-end: ${fillEnd};`;
  }

  function getVolumeIcon(volume: number, muted: boolean): string {
    if (muted || volume <= 0) {
      return 'volume_off';
    }

    return volume < 0.5 ? 'volume_down' : 'volume_up';
  }

  function getAppShell(): HTMLElement | null {
    return playerBarElement?.closest('.app-shell') as HTMLElement | null;
  }

  function clearPlayerBarReserve() {
    getAppShell()?.style.removeProperty(PLAYER_BAR_RESERVE_PROPERTY);
  }

  function syncPlayerBarReserve() {
    playerBarReserveFrame = null;

    if (presentation !== 'bar') {
      clearPlayerBarReserve();
      return;
    }

    if (!playerBarElement) {
      clearPlayerBarReserve();
      return;
    }

    const height = Math.ceil(playerBarElement.getBoundingClientRect().height);

    if (height <= 0) {
      clearPlayerBarReserve();
      return;
    }

    getAppShell()?.style.setProperty(PLAYER_BAR_RESERVE_PROPERTY, `${height}px`);
  }

  function schedulePlayerBarReserveSync() {
    if (typeof window === 'undefined' || playerBarReserveFrame !== null) {
      return;
    }

    playerBarReserveFrame = window.requestAnimationFrame(syncPlayerBarReserve);
  }

  onMount(() => {
    const mediaQuery = window.matchMedia(COMPACT_VOLUME_QUERY);

    const syncCompactVolume = () => {
      isCompactVolume = mediaQuery.matches;
      closeVolumePopup();
    };

    syncCompactVolume();
    mediaQuery.addEventListener('change', syncCompactVolume);
    schedulePlayerBarReserveSync();

    if (presentation === 'bar' && typeof ResizeObserver !== 'undefined' && playerBarElement) {
      playerBarResizeObserver = new ResizeObserver(schedulePlayerBarReserveSync);
      playerBarResizeObserver.observe(playerBarElement);
    }

    return () => {
      closeVolumePopup();
      mediaQuery.removeEventListener('change', syncCompactVolume);
      playerBarResizeObserver?.disconnect();
      playerBarResizeObserver = null;

      if (playerBarReserveFrame !== null) {
        window.cancelAnimationFrame(playerBarReserveFrame);
        playerBarReserveFrame = null;
      }

      clearPlayerBarReserve();
    };
  });

  $: snapshot = $snapshotStore;
  $: displayTrack = track;
  $: displayDuration = track ? snapshot.duration : 0;
  $: artworkBackgroundActive = hasArtworkBackdrop(backdropEffect) && Boolean(artwork);
  $: visualizerBackdropActive = hasVisualizerBackdrop(backdropEffect);
  $: playerArtworkPaletteActive =
    (useArtworkColorsOverride ?? $appearanceSettings.useArtworkPlayerColors) &&
    playerArtworkPalette !== null;
  $: playerArtworkColors = (artworkColorSurfaceBright || (artworkBackgroundActive && artworkBackgroundBright))
    ? playerArtworkPalette?.onLightBackground ?? null
    : playerArtworkPalette;
  $: playerArtworkStyle = playerArtworkPaletteActive
    ? toPlayerArtworkStyle(playerArtworkColors)
    : '';
  $: backdropArtworkStyle = backdropArtworkSettings
    ? toBackdropZoneArtworkStyle(backdropArtworkSettings)
    : '';
  $: rootStyle = [backdropArtworkStyle, playerArtworkStyle].filter(Boolean).join('; ');
  $: if (artwork?.url !== playerArtworkPaletteUrl) {
    void syncPlayerArtworkPalette(artwork?.url);
  }
  $: if (presentation !== 'bar') {
    clearPlayerBarReserve();
  }

  function handleShowTrack() {
    if (!displayTrack) {
      return;
    }

    dispatch('showTrack', displayTrack.id);
  }
</script>

<svelte:element
  this={containerElement}
  bind:this={playerBarElement}
  class="player-bar"
  class:now-playing-player={presentation === 'now-playing'}
  class:artwork-background-active={artworkBackgroundActive}
  class:artwork-background-bright={artworkBackgroundActive && artworkBackgroundBright}
  class:visualizer-backdrop-active={visualizerBackdropActive}
  aria-label={presentation === 'now-playing' ? 'Now Playing controls' : undefined}
  data-artwork-zone={artworkBackgroundActive ? 'true' : null}
  data-visualizer-zone={visualizerBackdropActive ? 'true' : null}
  data-backdrop-zone-id={presentation === 'bar' ? 'player' : null}
  style={rootStyle}
>
  <div class="player-track-group">
    {#if displayTrack || presentation === 'now-playing'}
      <button
        type="button"
        class="player-artwork-button"
        aria-label="Show current track details"
        disabled={!displayTrack}
        on:click={handleShowTrack}
      >
        <div class="player-artwork" aria-hidden="true">
          {#if artwork}
            <img class="player-artwork-image" src={artwork.url} alt="" />
          {:else}
            <div class="player-artwork-placeholder"></div>
          {/if}
        </div>
      </button>
    {/if}

    <div class="player-track">
      {#if displayTrack}
        <button type="button" class="player-track-link player-track-title" on:click={handleShowTrack}>
          <strong>{getTrackDisplayTitle(displayTrack)}</strong>
        </button>
      {:else}
        <strong>Welcome to izci!</strong>
      {/if}
      {#if displayTrack}
        {#if getTrackDisplaySubtitle(displayTrack)}
          <button
            type="button"
            class="player-track-link player-track-subtitle"
            on:click={handleShowTrack}
          >
            {getTrackDisplaySubtitle(displayTrack)}
          </button>
        {/if}
      {:else}
        <span>Drop files to begin</span>
      {/if}
    </div>
  </div>

  <div class="player-actions">
    <button
      type="button"
      class="transport-button transport-button-previous"
      aria-label="Previous track"
      on:click={() => dispatch('previous')}
      disabled={!track && !selectedTrack}
    >
      <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
    </button>
    <button
      type="button"
      class="transport-button transport-button-primary"
      aria-label={snapshot.state === 'playing' ? 'Pause playback' : 'Play playback'}
      on:click={() => dispatch('toggle')}
      disabled={!track && !selectedTrack}
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
      </span>
    </button>
    <button
      type="button"
      class="transport-button transport-button-next"
      aria-label="Next track"
      on:click={() => dispatch('next')}
      disabled={!track && !selectedTrack}
    >
      <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
    </button>
  </div>

  <div class="player-range">
    <span>{formatDuration(snapshot.currentTime)}</span>
    <div class="range-control" style={toRangeProgressStyle(snapshot.currentTime, Math.max(displayDuration, 1))}>
      <span class="range-control-fill" aria-hidden="true"></span>
      <input
        type="range"
        min="0"
        max={Math.max(displayDuration, 1)}
        step="0.01"
        value={snapshot.currentTime}
        disabled={!track || snapshot.duration <= 0}
        on:input={(event) => dispatch('seek', Number((event.currentTarget as HTMLInputElement).value))}
        on:wheel|preventDefault={handleSeekWheel}
      />
    </div>
    <span>{formatDuration(displayDuration)}</span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="volume"
    data-muted={snapshot.muted ? 'true' : 'false'}
    data-popup-open={isCompactVolume && isVolumePopupOpen ? 'true' : 'false'}
    on:mouseleave={closeVolumePopup}
  >
    <button
      type="button"
      class="volume-label"
      aria-label={snapshot.muted || snapshot.volume <= 0 ? 'Unmute' : 'Mute'}
      aria-expanded={isCompactVolume ? isVolumePopupOpen : undefined}
      aria-pressed={snapshot.muted}
      on:click={() => dispatch('mute')}
      on:mouseenter={openVolumePopup}
      on:focus={openVolumePopup}
      on:blur={closeVolumePopup}
      on:wheel|preventDefault={handleVolumeWheel}
    >
      <span class="material-symbols-outlined" aria-hidden="true">{getVolumeIcon(snapshot.volume, snapshot.muted)}</span>
      <span class="sr-only">{snapshot.muted || snapshot.volume <= 0 ? 'Unmute' : 'Mute'}</span>
    </button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="volume-popup" on:mouseenter={openVolumePopup}>
      <div class="volume-popup-track">
        <div class="range-control volume-range" style={toRangeProgressStyle(snapshot.volume, 1)}>
          <span class="range-control-fill" aria-hidden="true"></span>
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={snapshot.volume}
            disabled={snapshot.muted}
            on:input={(event) => dispatch('volume', Number((event.currentTarget as HTMLInputElement).value))}
            on:wheel|preventDefault={handleVolumeWheel}
          />
        </div>
      </div>
    </div>
  </div>
</svelte:element>

<style>
  .player-artwork-button,
  .player-track-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .player-track-title,
  .player-track-subtitle {
    text-align: left;
  }
</style>
