<script lang="ts">
  import { t } from 'svelte-i18n';
  import type { Readable } from 'svelte/store';
  import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let trackStore: Readable<PlaylistItem | null>;
  export let selectedTrackStore: Readable<PlaylistItem | null>;
  export let artworkUrlStore: Readable<string | null>;
  export let onTogglePlayback: () => void;
  export let onPreviousTrack: () => void;
  export let onNextTrack: () => void;
  export let onSeek: (seconds: number) => void;
  export let onVolume: (volume: number) => void;
  export let onToggleMute: () => void;

  let seekPreview = 0;
  let seekPointerActive = false;

  $: snapshot = $snapshotStore;
  $: track = $trackStore;
  $: selectedTrack = $selectedTrackStore;
  $: artworkUrl = $artworkUrlStore;
  $: displayTrack = track ?? selectedTrack;
  $: displayedSeekTime = seekPointerActive ? seekPreview : snapshot.currentTime;
  $: if (!seekPointerActive) seekPreview = snapshot.currentTime;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function toProgressStyle(value: number, max: number): string {
    const progress = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
    return `--pip-progress: ${progress}%;`;
  }

  function beginSeek(): void {
    seekPointerActive = true;
    seekPreview = snapshot.currentTime;
  }

  function previewSeek(event: Event): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    seekPreview = seconds;

    if (!seekPointerActive) {
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

  function getVolumeIcon(): string {
    if (snapshot.muted || snapshot.volume <= 0) {
      return 'volume_off';
    }

    return snapshot.volume < 0.5 ? 'volume_down' : 'volume_up';
  }
</script>

<main class="document-pip-player" aria-label={$t('main.documentPip.heading', { default: 'Mini player' })}>
  <div class="pip-track-row">
    <div class="pip-artwork" aria-hidden="true">
      {#if artworkUrl}
        <img src={artworkUrl} alt="" />
      {:else}
        <span class="material-symbols-outlined">
          {displayTrack?.kind === 'module' ? 'graphic_eq' : displayTrack?.kind === 'video' ? 'movie' : 'music_note'}
        </span>
      {/if}
    </div>

    <div class="pip-track-copy">
      <strong title={displayTrack ? getTrackDisplayTitle(displayTrack) : undefined}>
        {displayTrack
          ? getTrackDisplayTitle(displayTrack)
          : $t('main.documentPip.nothingPlaying', { default: 'Nothing playing' })}
      </strong>
      <span title={displayTrack ? getTrackDisplaySubtitle(displayTrack) : undefined}>
        {displayTrack
          ? getTrackDisplaySubtitle(displayTrack) || displayTrack.path || displayTrack.name
          : $t('main.documentPip.ready', { default: 'Ready when you are' })}
      </span>
    </div>

    <div class="pip-transport">
      <button
        type="button"
        aria-label={$t('main.player.previousTrack', { default: 'Previous track' })}
        disabled={!displayTrack}
        on:click={onPreviousTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
      </button>
      <button
        type="button"
        class="pip-primary-button"
        aria-label={snapshot.state === 'playing'
          ? $t('main.player.pausePlayback', { default: 'Pause playback' })
          : $t('main.player.playPlayback', { default: 'Play playback' })}
        disabled={!displayTrack}
        on:click={onTogglePlayback}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <button
        type="button"
        aria-label={$t('main.player.nextTrack', { default: 'Next track' })}
        disabled={!displayTrack}
        on:click={onNextTrack}
      >
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
      </button>
    </div>
  </div>

  <div class="pip-control-row">
    <span class="pip-time">{formatDuration(displayedSeekTime)}</span>
    <div class="pip-range" style={toProgressStyle(displayedSeekTime, Math.max(snapshot.duration, 1))}>
      <input
        aria-label={$t('main.documentPip.seek', { default: 'Seek' })}
        type="range"
        min="0"
        max={Math.max(snapshot.duration, 1)}
        step="0.01"
        value={displayedSeekTime}
        disabled={!track || snapshot.duration <= 0}
        on:pointerdown={beginSeek}
        on:input={previewSeek}
        on:pointerup={commitSeek}
        on:pointercancel={cancelSeek}
      />
    </div>
    <span class="pip-time">{formatDuration(track ? snapshot.duration : 0)}</span>
    <button
      type="button"
      class="pip-volume-button"
      aria-label={snapshot.muted
        ? $t('main.player.unmute', { default: 'Unmute' })
        : $t('main.player.mute', { default: 'Mute' })}
      aria-pressed={snapshot.muted}
      on:click={onToggleMute}
    >
      <span class="material-symbols-outlined" aria-hidden="true">{getVolumeIcon()}</span>
    </button>
    <div class="pip-range pip-volume-range" style={toProgressStyle(snapshot.volume, 1)}>
      <input
        aria-label={$t('main.player.volume', { default: 'Volume' })}
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={snapshot.volume}
        disabled={snapshot.muted}
        on:input={(event) => onVolume(Number((event.currentTarget as HTMLInputElement).value))}
      />
    </div>
  </div>
</main>

<style>
  .document-pip-player {
    display: grid;
    min-width: 0;
    height: 100vh;
    min-height: 7rem;
    padding: 0.62rem;
    gap: 0.58rem;
    align-content: center;
    background: var(--body-background);
    color: var(--text);
    font-size: 0.85rem;
    overflow: hidden;
  }

  .pip-track-row,
  .pip-control-row,
  .pip-transport {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .pip-track-row {
    gap: 0.58rem;
  }

  .pip-artwork {
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
  }

  .pip-artwork img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .pip-artwork .material-symbols-outlined {
    font-size: 1.55rem;
  }

  .pip-track-copy {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 0.18rem;
  }

  .pip-track-copy strong,
  .pip-track-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pip-track-copy strong {
    color: var(--text-strong);
    font-size: 0.94rem;
  }

  .pip-track-copy span {
    color: var(--muted);
    font-size: 0.78rem;
  }

  .pip-transport {
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
    cursor: pointer;
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
    cursor: default;
    opacity: 0.44;
  }

  .pip-transport button {
    width: 2.2rem;
    height: 2.2rem;
    border-radius: 0;
    transition:
      color 120ms ease,
      filter 120ms ease-out;
  }

  .pip-transport button:hover:not(:disabled) {
    background: transparent;
    filter:
      drop-shadow(0 0 0.38rem color-mix(in srgb, currentColor 68%, transparent))
      drop-shadow(0 0 0.95rem color-mix(in srgb, var(--accent-strong) 46%, transparent));
  }

  .pip-transport button .material-symbols-outlined {
    font-size: 1.6rem;
  }

  .pip-transport .pip-primary-button {
    width: 2.7rem;
    height: 2.7rem;
  }

  .pip-transport .pip-primary-button .material-symbols-outlined {
    font-size: 2rem;
  }

  .pip-control-row {
    display: grid;
    grid-template-columns: 2.9rem minmax(5rem, 1fr) 2.9rem 1.75rem 4.8rem;
    gap: 0.38rem;
  }

  .pip-time {
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

  .pip-range {
    --pip-progress: 0%;
    position: relative;
    display: flex;
    height: 0.82rem;
    align-items: center;
    min-width: 3.5rem;
  }

  .pip-range::before {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 0.3rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--accent-strong) 0 var(--pip-progress),
      color-mix(in srgb, var(--bg-soft) 82%, black) var(--pip-progress) 100%
    );
    content: '';
    pointer-events: none;
    transform: translateY(-50%);
  }

  .pip-range input {
    appearance: none;
    position: relative;
    z-index: 1;
    width: 100%;
    height: 0.82rem;
    margin: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .pip-range input::-webkit-slider-runnable-track {
    height: 0.3rem;
    border-radius: 999px;
    background: transparent;
  }

  .pip-range input::-webkit-slider-thumb {
    appearance: none;
    width: 0.78rem;
    height: 0.78rem;
    margin-top: -0.24rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--accent-strong);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.32);
  }

  .pip-range input:disabled {
    cursor: default;
    opacity: 0.42;
  }

  .pip-range:has(input:disabled)::before {
    opacity: 0.42;
  }

  .pip-volume-button {
    width: 1.75rem;
    height: 1.75rem;
  }

  .pip-volume-button .material-symbols-outlined {
    font-size: 1.2rem;
  }

  .pip-volume-range {
    min-width: 0;
  }

  @media (max-width: 360px) {
    .document-pip-player {
      padding: 0.48rem;
    }

    .pip-artwork {
      width: 2.7rem;
      height: 2.7rem;
      flex-basis: 2.7rem;
    }

    .pip-volume-range {
      display: none;
    }

    .pip-control-row {
      grid-template-columns: 2.9rem minmax(3rem, 1fr) 2.9rem 1.75rem;
    }
  }
</style>
