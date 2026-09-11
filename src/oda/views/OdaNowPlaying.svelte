<script lang="ts">
  import type { PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import type { OdaTranslate } from '../oda-translate';

  export let track: TrackItem | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let artworkUrl: string | null = null;
  export let queueItems: TrackItem[] = [];
  export let focusId: string | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let canMutateQueue = true;
  export let translate: OdaTranslate;

  export let onActivateQueueItem: (id: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};
  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onRemoveQueueItem: (id: string) => void = () => {};

  $: currentTime = snapshot?.currentTime ?? 0;
  $: duration = snapshot?.duration ?? 0;
  $: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  function focusIdFor(id: string): string {
    return `item:${id}`;
  }

  function repeatLabel(): string {
    if (repeatMode === 'one') return translate('oda.nowPlaying.repeatOne', 'Repeat one');
    if (repeatMode === 'all') return translate('oda.nowPlaying.repeatAll', 'Repeat all');
    return translate('oda.nowPlaying.repeatOff', 'Repeat off');
  }

  function handleSeekClick(event: MouseEvent): void {
    if (duration <= 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * duration);
  }
</script>

<div class="oda-now-playing">
  <div class="oda-now-playing-primary">
    <div
      class="oda-artwork"
      style={artworkUrl ? `background-image: url("${artworkUrl}")` : ''}
    >
      {#if !artworkUrl}
        <span class="material-symbols-outlined" aria-hidden="true">album</span>
      {/if}
    </div>

    <div class="oda-now-playing-info">
      <h2>{track ? (getTrackDisplayTitle(track) || track.name) : translate('oda.nowPlaying.idleTitle', 'Nothing playing')}</h2>
      <p>
        {track
          ? [track.metadata?.artist, track.metadata?.album].filter(Boolean).join(' · ') || track.name
          : translate('oda.nowPlaying.idleHint', 'Choose something from the library.')}
      </p>

      {#if track}
        <div class="oda-progress" on:click={handleSeekClick} role="presentation">
          <div class="oda-progress-fill" style={`width: ${progressPercent}%`}></div>
        </div>
        <p class="oda-progress-time">
          {formatDuration(currentTime)} / {duration > 0 ? formatDuration(duration) : '--:--'}
        </p>

        <div class="oda-transport">
          <button type="button" on:click={() => onStepTrack(-1)}>
            <span class="material-symbols-outlined">skip_previous</span>
          </button>
          <button
            type="button"
            class="oda-transport-primary"
            on:click={onTogglePlayback}
          >
            <span class="material-symbols-outlined">
              {snapshot?.state === 'playing' ? 'pause' : 'play_arrow'}
            </span>
          </button>
          <button type="button" on:click={() => onStepTrack(1)}>
            <span class="material-symbols-outlined">skip_next</span>
          </button>
          <button
            type="button"
            class:is-active={shuffleEnabled}
            on:click={onToggleShuffle}
          >
            <span class="material-symbols-outlined">shuffle</span>
          </button>
          <button
            type="button"
            class:is-active={repeatMode !== 'off'}
            title={repeatLabel()}
            on:click={onCycleRepeat}
          >
            <span class="material-symbols-outlined">
              {repeatMode === 'one' ? 'repeat_one' : 'repeat'}
            </span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="oda-now-playing-rail">
    <div class="oda-route-header">
      <h2>{translate('oda.cards.queue', 'Queue')}</h2>
      <p>{queueItems.length}</p>
    </div>
    <div class="oda-rows">
      {#each queueItems as item (item.id)}
        {@const itemFocusId = focusIdFor(item.id)}
        <div class="oda-row-wrap">
          <button
            type="button"
            class="oda-row"
            class:is-focused={focusId === itemFocusId}
            on:click={() => { onFocus(itemFocusId); onActivateQueueItem(item.id); }}
          >
            <span class="oda-row-title">
              {getTrackDisplayTitle(item) || item.name}
              {#if track?.id === item.id}
                <span class="material-symbols-outlined" aria-hidden="true">graphic_eq</span>
              {/if}
            </span>
          </button>
          {#if canMutateQueue}
            <button
              type="button"
              class="oda-row-remove"
              title={translate('oda.nowPlaying.remove', 'Remove from queue')}
              on:click={() => onRemoveQueueItem(item.id)}
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          {/if}
        </div>
      {:else}
        <p class="oda-row-meta">{translate('oda.nowPlaying.queueEmpty', 'The queue is empty.')}</p>
      {/each}
    </div>
  </div>
</div>
