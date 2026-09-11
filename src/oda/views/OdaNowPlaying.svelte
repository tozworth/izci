<script lang="ts">
  import type { PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import { odaBrowseTrackId } from '../oda-browse';
  import { buildOdaTrackDisplayRows } from '../oda-rows';
  import {
    ODA_NP_NEXT,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_PREVIOUS,
    ODA_NP_REPEAT,
    ODA_NP_SEEK_BACK,
    ODA_NP_SEEK_FORWARD,
    ODA_NP_SEEK_STEP_SECONDS,
    ODA_NP_SHUFFLE
  } from '../oda-now-playing';
  import type { OdaTranslate } from '../oda-translate';
  import OdaRouteList from './OdaRouteList.svelte';

  export let track: TrackItem | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let artworkUrl: string | null = null;
  export let queueItems: TrackItem[] = [];
  export let focusId: string | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let canMutateQueue = true;
  export let canReorderQueue = true;
  export let translate: OdaTranslate;

  export let onActivateQueueItem: (id: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};
  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onRemoveQueueItem: (id: string) => void = () => {};
  export let onMoveQueueItem: (id: string, direction: -1 | 1) => void = () => {};

  $: currentTime = snapshot?.currentTime ?? 0;
  $: duration = snapshot?.duration ?? 0;
  $: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  $: queueRows = buildOdaTrackDisplayRows(queueItems, track?.id ?? null);

  function focusClass(id: string): boolean {
    return focusId === id;
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

  function handleSeekDelta(seconds: number): void {
    const target = duration > 0
      ? Math.min(Math.max(currentTime + seconds, 0), duration)
      : currentTime + seconds;
    onSeek(target);
  }

  function handleQueueActivate(rowFocusId: string): void {
    const id = odaBrowseTrackId(rowFocusId);
    if (id) onActivateQueueItem(id);
  }

  function handleQueueRemove(rowFocusId: string): void {
    const id = odaBrowseTrackId(rowFocusId);
    if (id) onRemoveQueueItem(id);
  }

  function handleQueueMove(rowFocusId: string, direction: -1 | 1): void {
    const id = odaBrowseTrackId(rowFocusId);
    if (id) onMoveQueueItem(id, direction);
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
      {/if}

      <div class="oda-transport">
        <button
          type="button"
          class:is-focused={focusClass(ODA_NP_PREVIOUS)}
          on:click={() => onStepTrack(-1)}
        >
          <span class="material-symbols-outlined">skip_previous</span>
        </button>
        <button
          type="button"
          class="oda-transport-primary"
          class:is-focused={focusClass(ODA_NP_PLAY_PAUSE)}
          on:click={onTogglePlayback}
        >
          <span class="material-symbols-outlined">
            {snapshot?.state === 'playing' ? 'pause' : 'play_arrow'}
          </span>
        </button>
        <button
          type="button"
          class:is-focused={focusClass(ODA_NP_NEXT)}
          on:click={() => onStepTrack(1)}
        >
          <span class="material-symbols-outlined">skip_next</span>
        </button>
        <button
          type="button"
          class:is-focused={focusClass(ODA_NP_SEEK_BACK)}
          on:click={() => handleSeekDelta(-ODA_NP_SEEK_STEP_SECONDS)}
        >
          <span class="material-symbols-outlined">replay_10</span>
        </button>
        <button
          type="button"
          class:is-focused={focusClass(ODA_NP_SEEK_FORWARD)}
          on:click={() => handleSeekDelta(ODA_NP_SEEK_STEP_SECONDS)}
        >
          <span class="material-symbols-outlined">forward_10</span>
        </button>
        <button
          type="button"
          class:is-active={shuffleEnabled}
          class:is-focused={focusClass(ODA_NP_SHUFFLE)}
          on:click={onToggleShuffle}
        >
          <span class="material-symbols-outlined">shuffle</span>
        </button>
        <button
          type="button"
          class:is-active={repeatMode !== 'off'}
          class:is-focused={focusClass(ODA_NP_REPEAT)}
          title={repeatLabel()}
          on:click={onCycleRepeat}
        >
          <span class="material-symbols-outlined">
            {repeatMode === 'one' ? 'repeat_one' : 'repeat'}
          </span>
        </button>
      </div>
    </div>
  </div>

  <div class="oda-now-playing-rail">
    <div class="oda-route-header">
      <h2>{translate('oda.cards.queue', 'Queue')}</h2>
      <p>{queueItems.length}</p>
    </div>
    {#if queueRows.length === 0}
      <p class="oda-row-meta">{translate('oda.nowPlaying.queueEmpty', 'The queue is empty.')}</p>
    {:else}
      <OdaRouteList
        rows={queueRows}
        {focusId}
        listKey="now-playing-queue"
        canRemove={canMutateQueue}
        canMove={canReorderQueue}
        onActivate={handleQueueActivate}
        onFocus={(nextFocusId) => onFocus(nextFocusId)}
        onRemove={handleQueueRemove}
        onMove={handleQueueMove}
        {translate}
      />
    {/if}
  </div>
</div>
