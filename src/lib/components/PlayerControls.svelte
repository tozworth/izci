<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { formatDuration } from '$lib/utils/files';
  import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';

  export let snapshot: PlaybackSnapshot;
  export let track: PlaylistItem | null = null;

  const dispatch = createEventDispatcher<{
    toggle: void;
    stop: void;
    previous: void;
    next: void;
    seek: number;
    volume: number;
  }>();

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
</script>

<footer class="player-bar">
  <div class="player-track">
    <p class="eyebrow">Now Playing</p>
    <strong>{track?.metadata?.title || track?.name || 'Idle'}</strong>
    <span>{track ? `${track.kind.toUpperCase()} · ${track.extension.toUpperCase()}` : 'Drop files to begin'}</span>
  </div>

  <div class="player-main">
    <div class="player-actions">
      <button type="button" class="transport-button" aria-label="Previous track" on:click={() => dispatch('previous')} disabled={!track}>
        <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
      </button>
      <button type="button" class="transport-button" aria-label="Stop playback" on:click={() => dispatch('stop')} disabled={!track}>
        <span class="material-symbols-outlined" aria-hidden="true">stop</span>
      </button>
      <button
        type="button"
        class="transport-button transport-button-primary"
        aria-label={snapshot.state === 'playing' ? 'Pause playback' : 'Play playback'}
        on:click={() => dispatch('toggle')}
        disabled={!track}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {snapshot.state === 'playing' ? 'pause' : 'play_arrow'}
        </span>
      </button>
      <button type="button" class="transport-button" aria-label="Next track" on:click={() => dispatch('next')} disabled={!track}>
        <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
      </button>
    </div>

    <div class="player-range">
      <span>{formatDuration(snapshot.currentTime)}</span>
      <input
        type="range"
        min="0"
        max={Math.max(snapshot.duration, 1)}
        step="0.01"
        value={snapshot.currentTime}
        disabled={!track || snapshot.duration <= 0}
        on:input={(event) => dispatch('seek', Number((event.currentTarget as HTMLInputElement).value))}
        on:wheel|preventDefault={handleSeekWheel}
      />
      <span>{formatDuration(snapshot.duration)}</span>
    </div>
  </div>

  <label class="volume">
    <span class="volume-label">
      <span class="material-symbols-outlined" aria-hidden="true">volume_up</span>
      <span class="sr-only">Volume</span>
    </span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={snapshot.volume}
      on:input={(event) => dispatch('volume', Number((event.currentTarget as HTMLInputElement).value))}
      on:wheel|preventDefault={handleVolumeWheel}
    />
  </label>
</footer>
