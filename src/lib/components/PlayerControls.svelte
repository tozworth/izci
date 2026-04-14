<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Readable } from 'svelte/store';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let track: PlaylistItem | null = null;
  export let selectedTrack: PlaylistItem | null = null;
  export let isTabbedLayout = false;

  const dispatch = createEventDispatcher<{
    toggle: void;
    stop: void;
    previous: void;
    next: void;
    seek: number;
    volume: number;
    showTrack: string;
  }>();

  const COMPACT_VOLUME_QUERY = '(max-width: 349px)';
  const COMPACT_VOLUME_OPEN_DELAY_MS = 120;

  let isCompactVolume = false;
  let isVolumePopupOpen = false;
  let volumePopupTimer: ReturnType<typeof window.setTimeout> | null = null;
  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    backend: null,
    error: undefined
  };

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

  onMount(() => {
    const mediaQuery = window.matchMedia(COMPACT_VOLUME_QUERY);

    const syncCompactVolume = () => {
      isCompactVolume = mediaQuery.matches;
      closeVolumePopup();
    };

    syncCompactVolume();
    mediaQuery.addEventListener('change', syncCompactVolume);

    return () => {
      closeVolumePopup();
      mediaQuery.removeEventListener('change', syncCompactVolume);
    };
  });

  $: snapshot = $snapshotStore;
  $: displayTrack = track ?? selectedTrack;
  $: displayDuration = track ? snapshot.duration : selectedTrack?.metadata?.duration ?? snapshot.duration;
</script>

<footer class="player-bar">
  <div class="player-track">
    {#if displayTrack}
      <button type="button" class="player-track-title" on:click={() => dispatch('showTrack', displayTrack.id)}>
        <strong>{getTrackDisplayTitle(displayTrack)}</strong>
      </button>
    {:else}
      <strong>Welcome to izci!</strong>
    {/if}
    {#if displayTrack}
      {#if getTrackDisplaySubtitle(displayTrack)}
        <span>{getTrackDisplaySubtitle(displayTrack)}</span>
      {/if}
    {:else}
      <span>Drop files to begin</span>
    {/if}
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
    {#if !isTabbedLayout}
      <button type="button" class="transport-button" aria-label="Stop playback" on:click={() => dispatch('stop')} disabled={!track}>
        <span class="material-symbols-outlined" aria-hidden="true">stop</span>
      </button>
    {/if}
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
    <span>{formatDuration(displayDuration)}</span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="volume" data-popup-open={isCompactVolume && isVolumePopupOpen ? 'true' : 'false'} on:mouseleave={closeVolumePopup}>
    <button
      type="button"
      class="volume-label"
      aria-label="Volume"
      aria-expanded={isCompactVolume ? isVolumePopupOpen : undefined}
      on:mouseenter={openVolumePopup}
      on:focus={openVolumePopup}
      on:blur={closeVolumePopup}
      on:wheel|preventDefault={handleVolumeWheel}
    >
      <span class="material-symbols-outlined" aria-hidden="true">volume_up</span>
      <span class="sr-only">Volume</span>
    </button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="volume-popup" on:mouseenter={openVolumePopup}>
      <div class="volume-popup-track">
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={snapshot.volume}
          on:input={(event) => dispatch('volume', Number((event.currentTarget as HTMLInputElement).value))}
          on:wheel|preventDefault={handleVolumeWheel}
        />
      </div>
    </div>
  </div>
</footer>

<style>
  .player-track-title {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
</style>
