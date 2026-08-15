<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { Readable } from 'svelte/store';
  import type { PlaybackSnapshot, TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import { createWheelSeekController } from '$lib/services/wheel-seek';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let trackStore: Readable<TrackItem | null>;
  export let selectedTrackStore: Readable<TrackItem | null>;
  export let artworkUrlStore: Readable<string | null>;
  export let onTogglePlayback: () => void;
  export let onPreviousTrack: () => void;
  export let onNextTrack: () => void;
  export let onSeek: (seconds: number) => void;
  export let onVolume: (volume: number) => void;
  export let onToggleMute: () => void;
  export let onEnterNowPlaying: () => void;

  const RANGE_THUMB_SIZE_REM = 0.78;
  const SEEK_STEP_SECONDS = 5;
  const VOLUME_STEP = 0.05;

  let rootElement: HTMLElement | null = null;
  let seekPreview = 0;
  let seekPointerActive = false;
  let seekWheelActive = false;

  $: snapshot = $snapshotStore;
  $: isLoading = snapshot.state === 'loading';
  $: track = $trackStore;
  $: selectedTrack = $selectedTrackStore;
  $: artworkUrl = $artworkUrlStore;
  $: displayTrack = track ?? selectedTrack;
  $: displayedSeekTime = seekPointerActive || seekWheelActive ? seekPreview : snapshot.currentTime;
  $: if (!seekPointerActive && !seekWheelActive) seekPreview = snapshot.currentTime;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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

    return `--mini-player-range-progress: ${percent}%; --mini-player-range-fill-end: ${fillEnd};`;
  }

  function handleSeekWheel(event: WheelEvent): void {
    wheelSeek.step(event.deltaY);
  }

  const wheelSeek = createWheelSeekController({
    getCurrentTime: () => snapshot.currentTime,
    getDuration: () => snapshot.duration,
    getContextKey: () => track?.id ?? null,
    onPreview: (seconds) => {
      seekWheelActive = seconds !== null;
      if (seconds !== null) seekPreview = seconds;
    },
    onCommit: onSeek
  });

  function handleVolumeWheel(event: WheelEvent): void {
    if (snapshot.muted) {
      return;
    }

    const direction = event.deltaY < 0 ? 1 : -1;
    onVolume(clamp(snapshot.volume + direction * VOLUME_STEP, 0, 1));
  }

  function shouldIgnoreSeekKeyTarget(target: EventTarget | null): boolean {
    if (!target || typeof (target as HTMLElement).tagName !== 'string') {
      return false;
    }

    const element = target as HTMLElement;
    return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      event.metaKey ||
      shouldIgnoreSeekKeyTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();

    if (!track || snapshot.duration <= 0) {
      return;
    }

    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    onSeek(clamp(snapshot.currentTime + direction * SEEK_STEP_SECONDS, 0, snapshot.duration));
  }

  function beginSeek(): void {
    wheelSeek.cancel();
    seekPointerActive = true;
    seekPreview = snapshot.currentTime;
  }

  function previewSeek(event: Event): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;

    if (!seekPointerActive) {
      wheelSeek.cancel();
      onSeek(seconds);
    }
  }

  function commitSeek(event: PointerEvent): void {
    if (!seekPointerActive) {
      return;
    }

    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;
    seekPointerActive = false;
    onSeek(seconds);
  }

  function cancelSeek(): void {
    seekPointerActive = false;
    seekPreview = snapshot.currentTime;
  }

  onDestroy(wheelSeek.cancel);

  function getVolumeIcon(): string {
    if (snapshot.muted || snapshot.volume <= 0) {
      return 'volume_off';
    }

    return snapshot.volume < 0.5 ? 'volume_down' : 'volume_up';
  }

  onMount(() => {
    const miniPlayerWindow = rootElement?.ownerDocument.defaultView;
    miniPlayerWindow?.addEventListener('keydown', handleWindowKeydown);

    return () => miniPlayerWindow?.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<main
  bind:this={rootElement}
  class="mini-player"
  class:mini-player-loading={isLoading}
  aria-label={$t('main.miniPlayer.heading', { default: 'Mini player' })}
>
  <div class="mini-player-track-row">
    <button
      type="button"
      class="mini-player-artwork"
      aria-label={$t('main.player.enterNowPlaying', { default: 'Enter Now Playing' })}
      disabled={!displayTrack}
      on:click={onEnterNowPlaying}
    >
      {#if artworkUrl}
        <img src={artworkUrl} alt="" />
      {:else}
        <span class="material-symbols-outlined">
          {displayTrack?.kind === 'module' ? 'graphic_eq' : displayTrack?.kind === 'video' ? 'movie' : 'music_note'}
        </span>
      {/if}
      <span class="mini-player-artwork-fullscreen material-symbols-outlined" aria-hidden="true">fullscreen</span>
    </button>

    <div class="mini-player-track-copy">
      <strong title={displayTrack ? getTrackDisplayTitle(displayTrack) : undefined}>
        {displayTrack
          ? getTrackDisplayTitle(displayTrack)
          : $t('main.miniPlayer.nothingPlaying', { default: 'Nothing playing' })}
      </strong>
      <span title={displayTrack ? getTrackDisplaySubtitle(displayTrack) : undefined}>
        {displayTrack
          ? getTrackDisplaySubtitle(displayTrack) || displayTrack.path || displayTrack.name
          : $t('main.miniPlayer.ready', { default: 'Ready when you are' })}
      </span>
    </div>

    <div class="mini-player-transport">
      <button
        type="button"
        aria-label={$t('main.player.previousTrack', { default: 'Previous track' })}
        disabled={!displayTrack || isLoading}
        on:click={onPreviousTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
      </button>
      <button
        type="button"
        class="mini-player-primary-button"
        aria-label={isLoading
          ? $t('main.player.loadingTrack', { default: 'Loading track…' })
          : snapshot.state === 'playing'
            ? $t('main.player.pausePlayback', { default: 'Pause playback' })
            : $t('main.player.playPlayback', { default: 'Play playback' })}
        disabled={!displayTrack || isLoading}
        on:click={onTogglePlayback}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {isLoading ? 'progress_activity' : snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <button
        type="button"
        aria-label={$t('main.player.nextTrack', { default: 'Next track' })}
        disabled={!displayTrack || isLoading}
        on:click={onNextTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
      </button>
    </div>
  </div>

  <div class="mini-player-control-row">
    <span class="mini-player-time">{formatDuration(displayedSeekTime)}</span>
    <div class="mini-player-range" style={toRangeProgressStyle(displayedSeekTime, Math.max(snapshot.duration, 1))}>
      <span class="mini-player-range-fill" aria-hidden="true"></span>
      <input
        aria-label={$t('main.miniPlayer.seek', { default: 'Seek' })}
        type="range"
        min="0"
        max={Math.max(snapshot.duration, 1)}
        step="0.01"
        value={displayedSeekTime}
        disabled={!track || snapshot.duration <= 0 || isLoading}
        on:pointerdown={beginSeek}
        on:input={previewSeek}
        on:pointerup={commitSeek}
        on:pointercancel={cancelSeek}
        on:wheel|preventDefault={handleSeekWheel}
      />
    </div>
    <span class="mini-player-time">{formatDuration(track ? snapshot.duration : 0)}</span>
    <button
      type="button"
      class="mini-player-volume-button"
      aria-label={snapshot.muted || snapshot.volume <= 0
        ? $t('main.player.unmute', { default: 'Unmute' })
        : $t('main.player.mute', { default: 'Mute' })}
      aria-pressed={snapshot.muted}
      on:click={onToggleMute}
      on:wheel|preventDefault={handleVolumeWheel}
    >
      <span class="material-symbols-outlined" aria-hidden="true">{getVolumeIcon()}</span>
    </button>
    <div
      class="mini-player-range mini-player-volume-range"
      data-muted={snapshot.muted ? 'true' : 'false'}
      style={toRangeProgressStyle(snapshot.volume, 1)}
    >
      <span class="mini-player-range-fill" aria-hidden="true"></span>
      <input
        aria-label={$t('main.player.volume', { default: 'Volume' })}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={snapshot.volume}
        disabled={snapshot.muted}
        on:input={(event) => onVolume(Number((event.currentTarget as HTMLInputElement).value))}
        on:wheel|preventDefault={handleVolumeWheel}
      />
    </div>
  </div>
</main>

<style>
  .mini-player {
    display: grid;
    min-width: 0;
    height: 100vh;
    min-height: 6.25rem;
    padding: 0.36rem 0.5rem;
    gap: 0.32rem;
    align-content: center;
    background: var(--body-background);
    color: var(--text);
    font-size: 0.85rem;
    overflow: hidden;
  }

  .mini-player,
  .mini-player * {
    cursor: default;
  }

  .mini-player-track-row,
  .mini-player-control-row,
  .mini-player-transport {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .mini-player-track-row {
    gap: 0.58rem;
  }

  .mini-player-artwork {
    position: relative;
    display: grid;
    width: 3.2rem;
    height: 3.2rem;
    flex: 0 0 3.2rem;
    place-items: center;
    border: 1px solid var(--border-soft);
    border-radius: var(--track-artwork-radius);
    background: color-mix(in srgb, var(--bg-soft) 76%, transparent);
    color: var(--muted);
    overflow: hidden;
    padding: 0;
  }

  .mini-player-artwork img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .mini-player-artwork .material-symbols-outlined {
    font-size: 1.55rem;
  }

  .mini-player-artwork .mini-player-artwork-fullscreen {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    background: rgba(0, 0, 0, 0.42);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .mini-player-artwork:hover:not(:disabled) .mini-player-artwork-fullscreen,
  .mini-player-artwork:focus-visible .mini-player-artwork-fullscreen {
    opacity: 1;
  }

  .mini-player-track-copy {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 0.18rem;
  }

  .mini-player-track-copy strong,
  .mini-player-track-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mini-player-track-copy strong {
    color: var(--text-strong);
    font-size: 0.94rem;
  }

  .mini-player-track-copy span {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .mini-player-transport {
    flex: 0 0 auto;
    gap: 0.16rem;
  }

  button {
    display: inline-grid;
    width: 2rem;
    height: 2rem;
    padding: 0;
    place-items: center;
    border-radius: 999px;
    background: transparent;
    color: var(--text);
  }

  button:hover:not(:disabled) {
    background: var(--hover-control);
  }

  button:focus-visible {
    outline: 2px solid var(--accent-focus-border);
    outline-offset: 1px;
  }

  button:disabled {
    color: var(--muted);
    opacity: 0.44;
  }

  .mini-player-transport button {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0;
    transition:
      color 120ms ease,
      filter 120ms ease-out;
  }

  .mini-player.mini-player-loading .mini-player-track-copy,
  .mini-player.mini-player-loading .mini-player-control-row {
    opacity: 0.66;
    transition: opacity 120ms ease;
  }

  .mini-player.mini-player-loading .mini-player-transport button {
    opacity: 0.62;
  }

  .mini-player.mini-player-loading .mini-player-primary-button .material-symbols-outlined {
    color: transparent;
    position: relative;
  }

  .mini-player.mini-player-loading .mini-player-primary-button .material-symbols-outlined::before {
    content: "";
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0.78em;
    height: 0.78em;
    margin: -0.39em 0 0 -0.39em;
    border-radius: 50%;
    background: conic-gradient(
      from 0deg,
      var(--text) 0deg 90deg,
      transparent 90deg 180deg,
      var(--text) 180deg 270deg,
      transparent 270deg 360deg);
    -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 0.09em), #000 calc(100% - 0.06em));
    mask: radial-gradient(closest-side, transparent calc(100% - 0.09em), #000 calc(100% - 0.06em));
    animation: mini-player-loading-spin 900ms linear infinite;
  }

  @keyframes mini-player-loading-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .mini-player-transport button:hover:not(:disabled) {
    background: transparent;
    filter:
      drop-shadow(0 0 0.38rem color-mix(in srgb, currentColor 68%, transparent))
      drop-shadow(0 0 0.95rem color-mix(in srgb, var(--accent-strong) 46%, transparent));
  }

  .mini-player-transport button .material-symbols-outlined {
    font-size: 1.6rem;
  }

  .mini-player-transport .mini-player-primary-button {
    width: 2.7rem;
    height: 2.7rem;
  }

  .mini-player-transport .mini-player-primary-button .material-symbols-outlined {
    font-size: 2rem;
  }

  .mini-player-control-row {
    display: grid;
    grid-template-columns: 2.9rem minmax(5rem, 1fr) 2.9rem 1.75rem 4.8rem;
    gap: 0.38rem;
  }

  .mini-player-time {
    display: inline-flex;
    height: 0.82rem;
    align-items: center;
    justify-content: center;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    font-size: 0.73rem;
    line-height: 1;
    text-align: center;
    transform: translateY(-0.02rem);
  }

  .mini-player-range {
    --mini-player-range-progress: 0%;
    --mini-player-range-fill-end: 0px;
    position: relative;
    display: flex;
    height: 0.82rem;
    align-items: center;
    min-width: 3.5rem;
  }

  .mini-player-range::before,
  .mini-player-range-fill {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 0.3rem;
    border-radius: 999px;
    content: '';
    pointer-events: none;
    transform: translateY(-50%);
  }

  .mini-player-range::before {
    border: 1px solid var(--border-strong);
    background: color-mix(in srgb, var(--bg-soft) 82%, black);
  }

  .mini-player-range-fill {
    right: auto;
    width: var(--mini-player-range-fill-end);
    background: var(--accent-strong);
  }

  .mini-player-range input {
    appearance: none;
    position: relative;
    z-index: 1;
    width: 100%;
    height: 0.82rem;
    margin: 0;
    border: 0;
    background: transparent;
  }

  .mini-player-range input::-webkit-slider-runnable-track {
    height: 0.3rem;
    border-radius: 999px;
    background: transparent;
  }

  .mini-player-range input::-webkit-slider-thumb {
    appearance: none;
    width: 0.78rem;
    height: 0.78rem;
    margin-top: -0.24rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--accent-strong);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
  }

  .mini-player-range input:disabled {
    opacity: 0.42;
  }

  .mini-player-range:has(input:disabled)::before,
  .mini-player-range:has(input:disabled) .mini-player-range-fill {
    opacity: 0.42;
  }

  .mini-player-volume-button {
    width: 1.75rem;
    height: 1.75rem;
  }

  .mini-player-volume-button .material-symbols-outlined {
    font-size: 1.2rem;
    font-variation-settings: 'wght' 500;
  }

  .mini-player-volume-range {
    min-width: 0;
  }

  .mini-player-volume-range[data-muted='true'] .mini-player-range-fill,
  .mini-player-volume-range[data-muted='true'] input::-webkit-slider-thumb {
    background: color-mix(in srgb, var(--muted) 82%, transparent);
  }

  @media (max-width: 360px) {
    .mini-player {
      padding: 0.3rem 0.42rem;
    }

    .mini-player-artwork {
      width: 2.7rem;
      height: 2.7rem;
      flex-basis: 2.7rem;
    }

    .mini-player-volume-range {
      display: none;
    }

    .mini-player-control-row {
      grid-template-columns: 2.9rem minmax(3rem, 1fr) 2.9rem 1.75rem;
    }
  }
</style>
