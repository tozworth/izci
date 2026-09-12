<script lang="ts">
  import type { PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import { odaBrowseTrackId } from '../oda-browse';
  import { buildOdaTrackDisplayRows } from '../oda-rows';
  import {
    ODA_NP_NEXT,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_PREVIOUS,
    ODA_NP_PROGRESS,
    ODA_NP_REPEAT,
    ODA_NP_SHUFFLE,
    ODA_NP_VOLUME
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
  $: volumePercent = Math.round((snapshot?.volume ?? 0) * 100);
  $: queueRows = buildOdaTrackDisplayRows(queueItems, track?.id ?? null);
  $: title = track ? (getTrackDisplayTitle(track) || track.name) : translate('oda.nowPlaying.idleTitle', 'Nothing playing');
  $: artist = track?.metadata?.artist?.trim() || '';
  $: album = track?.metadata?.album?.trim() || '';

  function focused(id: string): boolean {
    return focusId === id;
  }

  function repeatLabel(): string {
    if (repeatMode === 'one') return translate('oda.nowPlaying.repeatOne', 'Repeat one');
    if (repeatMode === 'all') return translate('oda.nowPlaying.repeatAll', 'Repeat all');
    return translate('oda.nowPlaying.repeatOff', 'Repeat off');
  }

  function activate(id: string, action: () => void): void {
    onFocus(id);
    action();
  }

  function handleSeekClick(event: MouseEvent): void {
    if (duration <= 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * duration);
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
  {#if artworkUrl}
    <div class="oda-now-playing-ambient" style={`background-image: url("${artworkUrl}")`} aria-hidden="true"></div>
  {/if}

  <section class="oda-now-playing-hero">
    <div class="oda-artwork" class:has-art={!!artworkUrl} style={artworkUrl ? `background-image: url("${artworkUrl}")` : ''}>
      {#if !artworkUrl}
        <span class="material-symbols-outlined" aria-hidden="true">album</span>
      {/if}
    </div>

    <div class="oda-now-playing-info">
      <h1>{title}</h1>
      <p class="oda-now-playing-byline">
        {track
          ? [artist, album].filter(Boolean).join(' · ') || track.name
          : translate('oda.nowPlaying.idleHint', 'Choose something from the library.')}
      </p>

      <div class="oda-now-playing-timeline">
        <button
          class="oda-progress"
          class:is-focused={focused(ODA_NP_PROGRESS)}
          type="button"
          role="slider"
          aria-label={translate('oda.nowPlaying.seek', 'Seek')}
          aria-valuemin="0"
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatDuration(currentTime)} / ${duration > 0 ? formatDuration(duration) : '--:--'}`}
          on:click={(event) => { onFocus(ODA_NP_PROGRESS); handleSeekClick(event); }}
        >
          <span class="oda-progress-fill" style={`width: ${progressPercent}%`}></span>
        </button>
        <div class="oda-progress-time">
          <span>{formatDuration(currentTime)}</span>
          <span>{duration > 0 ? formatDuration(duration) : '--:--'}</span>
        </div>
      </div>

      <div class="oda-transport oda-transport-main">
        <span class="oda-transport-core">
          <button type="button" class:is-active={shuffleEnabled} class:is-focused={focused(ODA_NP_SHUFFLE)} title={translate('oda.nowPlaying.shuffle', 'Shuffle')} on:click={() => activate(ODA_NP_SHUFFLE, onToggleShuffle)}>
            <span class="material-symbols-outlined">shuffle</span>
          </button>
          <button type="button" class:is-focused={focused(ODA_NP_PREVIOUS)} title={translate('oda.nowPlaying.previous', 'Previous')} on:click={() => activate(ODA_NP_PREVIOUS, () => onStepTrack(-1))}>
            <span class="material-symbols-outlined">skip_previous</span>
          </button>
          <button type="button" class="oda-transport-primary" class:is-focused={focused(ODA_NP_PLAY_PAUSE)} title={translate('oda.nowPlaying.playPause', 'Play or pause')} on:click={() => activate(ODA_NP_PLAY_PAUSE, onTogglePlayback)}>
            <span class="material-symbols-outlined">{snapshot?.state === 'playing' ? 'pause' : 'play_arrow'}</span>
          </button>
          <button type="button" class:is-focused={focused(ODA_NP_NEXT)} title={translate('oda.nowPlaying.next', 'Next')} on:click={() => activate(ODA_NP_NEXT, () => onStepTrack(1))}>
            <span class="material-symbols-outlined">skip_next</span>
          </button>
          <button type="button" class:is-active={repeatMode !== 'off'} class:is-focused={focused(ODA_NP_REPEAT)} title={repeatLabel()} on:click={() => activate(ODA_NP_REPEAT, onCycleRepeat)}>
            <span class="material-symbols-outlined">{repeatMode === 'one' ? 'repeat_one' : 'repeat'}</span>
          </button>
        </span>
        <span class="oda-volume-control">
          <span class="material-symbols-outlined oda-volume-step-hint oda-volume-step-up" aria-hidden="true">expand_less</span>
          <button
            type="button"
            role="slider"
            class="oda-volume-ring"
            class:is-focused={focused(ODA_NP_VOLUME)}
            title={`${translate('oda.nowPlaying.volume', 'Volume')}: ${volumePercent}%`}
            aria-label={translate('oda.nowPlaying.volume', 'Volume')}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={volumePercent}
            on:click={() => onFocus(ODA_NP_VOLUME)}
          >
            <svg class="oda-volume-ring-svg" viewBox="0 0 44 44" aria-hidden="true">
              <circle class="oda-volume-ring-track" cx="22" cy="22" r="19" pathLength="100"></circle>
              <circle
                class="oda-volume-ring-value"
                cx="22"
                cy="22"
                r="19"
                pathLength="100"
                stroke-dasharray={`${volumePercent} ${100 - volumePercent}`}
              ></circle>
            </svg>
            <span class="material-symbols-outlined">{volumePercent === 0 ? 'volume_off' : 'volume_up'}</span>
          </button>
          <span class="material-symbols-outlined oda-volume-step-hint oda-volume-step-down" aria-hidden="true">expand_more</span>
        </span>
      </div>
    </div>
  </section>

  <section class="oda-now-playing-rail">
    <div class="oda-now-playing-queue-header">
      <h2>{translate('oda.cards.queue', 'Queue')}</h2>
      <p>{translate('oda.home.queueCount', '{count} tracks', { count: queueItems.length })}</p>
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
  </section>
</div>
