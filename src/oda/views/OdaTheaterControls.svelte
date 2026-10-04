<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { PlaybackSnapshot, RepeatMode, TrackItem, VideoFitMode } from '$lib/types';
  import { formatDuration, getTrackDisplaySubtitle, getTrackDisplayTitle } from '$lib/utils/files';
  import {
    ODA_THEATER_FIT,
    ODA_THEATER_NEXT,
    ODA_THEATER_PLAY_PAUSE,
    ODA_THEATER_PREVIOUS,
    ODA_THEATER_PROGRESS,
    resolveOdaTheaterControlIds,
    type OdaTheaterKind
  } from '../oda-theater';
  import { ODA_NP_QUEUE, ODA_NP_REPEAT, ODA_NP_SHUFFLE } from '../oda-now-playing';
  import type { OdaTranslate } from '../oda-translate';

  export let kind: OdaTheaterKind;
  export let track: TrackItem | null = null;
  export let focusId: string | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let fitMode: VideoFitMode = 'contain';
  export let translate: OdaTranslate;

  export let onFocus: (focusId: string) => void = () => {};
  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onToggleQueue: () => void = () => {};

  $: playing = snapshot?.state === 'playing';
  $: currentTime = snapshot?.currentTime ?? 0;
  $: duration = snapshot?.duration ?? 0;
  $: progressPercent = duration > 0 ? Math.min(100, Math.max(0, currentTime / duration * 100)) : 0;
  $: title = track ? getTrackDisplayTitle(track) || track.name : '';
  $: subtitle = track ? getTrackDisplaySubtitle(track) || track.path || track.name : '';
  $: fitLabel = fitMode === 'cover'
    ? translate('oda.theater.fit', 'Fit')
    : translate('oda.theater.fill', 'Fill');

  const CHROME_HIDE_DELAY_MS = 2400;
  let chromeHidden = false;
  let chromeHideTimer: number | null = null;

  function repeatLabel(): string {
    if (repeatMode === 'one') return translate('oda.nowPlaying.repeatOne', 'Repeat one');
    if (repeatMode === 'all') return translate('oda.nowPlaying.repeatAll', 'Repeat all');
    return translate('oda.nowPlaying.repeatOff', 'Repeat off');
  }

  function setChromeHidden(hidden: boolean): void {
    chromeHidden = hidden;
    document.documentElement.classList.toggle('oda-theater-cursor-hidden', hidden);
  }

  function clearChromeHideTimer(): void {
    if (chromeHideTimer === null) return;
    window.clearTimeout(chromeHideTimer);
    chromeHideTimer = null;
  }

  function hasTheaterFocus(id: string | null): boolean {
    return id === null || resolveOdaTheaterControlIds(kind).includes(id);
  }

  function scheduleChromeHide(): void {
    clearChromeHideTimer();
    if (!hasTheaterFocus(focusId)) {
      setChromeHidden(false);
      return;
    }
    chromeHideTimer = window.setTimeout(() => {
      setChromeHidden(true);
      chromeHideTimer = null;
    }, CHROME_HIDE_DELAY_MS);
  }

  function revealChrome(): void {
    setChromeHidden(false);
    scheduleChromeHide();
  }

  function hideChrome(): void {
    clearChromeHideTimer();
    setChromeHidden(true);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    const transportIds = resolveOdaTheaterControlIds(kind).filter((id) => id !== ODA_THEATER_PROGRESS);
    if (chromeHidden && event.key === 'ArrowDown' && focusId !== null && transportIds.includes(focusId)) {
      revealChrome();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (event.key === 'ArrowUp' && focusId !== null && transportIds.includes(focusId)) {
      hideChrome();
      return;
    }
    revealChrome();
  }

  function focused(id: string): boolean {
    return focusId === id;
  }

  function activate(id: string, action: () => void): void {
    onFocus(id);
    action();
  }

  function handleSeekClick(event: MouseEvent): void {
    if (duration <= 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onSeek(Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * duration);
  }

  onMount(scheduleChromeHide);
  onDestroy(() => {
    clearChromeHideTimer();
    document.documentElement.classList.remove('oda-theater-cursor-hidden');
  });

  $: {
    focusId;
    kind;
    if (!hasTheaterFocus(focusId)) revealChrome();
  }
</script>

<svelte:window on:pointermove={revealChrome} on:pointerdown={revealChrome} on:keydown|capture={handleWindowKeydown} />

<div class="oda-theater-chrome" class:is-hidden={chromeHidden}>
  <div class="oda-theater-top-shadow" aria-hidden="true"></div>
  <header class="oda-theater-heading">
  <h1>{title}</h1>
  {#if subtitle && subtitle !== title}<p>{subtitle}</p>{/if}
</header>

  <div class="oda-theater-bottom-shadow" aria-hidden="true"></div>
  <div class="oda-theater-transport" role="toolbar" aria-label={translate('oda.theater.controls', 'Playback controls')}>
  <div class="oda-theater-transport-edge oda-theater-transport-left">
    <button
      type="button"
      class="oda-theater-edge-control"
      class:is-focused={focused(ODA_THEATER_FIT)}
      aria-label={fitLabel}
      on:click={() => activate(ODA_THEATER_FIT, () => onSetFit(fitMode === 'contain' ? 'cover' : 'contain'))}
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {fitMode === 'cover' ? 'fit_screen' : 'crop_free'}
      </span>
    </button>
  </div>

  <div class="oda-theater-transport-center">
    <button
      type="button"
      class:is-active={shuffleEnabled}
      class:is-focused={focused(ODA_NP_SHUFFLE)}
      aria-label={translate('oda.nowPlaying.shuffle', 'Shuffle')}
      aria-pressed={shuffleEnabled}
      on:click={() => activate(ODA_NP_SHUFFLE, onToggleShuffle)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
    </button>
    <button
      type="button"
      class:is-focused={focused(ODA_THEATER_PREVIOUS)}
      aria-label={translate('oda.nowPlaying.previous', 'Previous')}
      on:click={() => activate(ODA_THEATER_PREVIOUS, () => onStepTrack(-1))}
    >
      <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
    </button>
    {#if kind === 'video'}
      <button
        type="button"
        class="oda-theater-primary-control"
        class:is-focused={focused(ODA_THEATER_PLAY_PAUSE)}
        aria-label={translate('oda.nowPlaying.playPause', 'Play or pause')}
        on:click={() => activate(ODA_THEATER_PLAY_PAUSE, onTogglePlayback)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
      </button>
    {/if}
    <button
      type="button"
      class:is-focused={focused(ODA_THEATER_NEXT)}
      aria-label={translate('oda.nowPlaying.next', 'Next')}
      on:click={() => activate(ODA_THEATER_NEXT, () => onStepTrack(1))}
    >
      <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
    </button>
    <button
      type="button"
      class:is-active={repeatMode !== 'off'}
      class:is-focused={focused(ODA_NP_REPEAT)}
      aria-label={repeatLabel()}
      aria-pressed={repeatMode !== 'off'}
      on:click={() => activate(ODA_NP_REPEAT, onCycleRepeat)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">
        {repeatMode === 'one' ? 'repeat_one' : 'repeat'}
      </span>
    </button>
  </div>

  {#if kind === 'video'}
  <div class="oda-theater-transport-edge oda-theater-transport-right">
    <button
      type="button"
      class="oda-theater-edge-control"
      class:is-focused={focused(ODA_NP_QUEUE)}
      aria-label={translate('oda.queue.open', 'Queue')}
      on:click={() => activate(ODA_NP_QUEUE, onToggleQueue)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">queue_music</span>
    </button>
  </div>
  {/if}
  </div>

{#if kind === 'video'}
  <div class="oda-theater-timeline">
    <div class="oda-theater-time" aria-hidden="true">
      <span>{formatDuration(currentTime)}</span>
      <span>{duration > 0 ? formatDuration(duration) : '--:--'}</span>
    </div>
    <button
      type="button"
      class="oda-theater-progress"
      class:is-focused={focused(ODA_THEATER_PROGRESS)}
      role="slider"
      aria-label={translate('oda.nowPlaying.seek', 'Seek')}
      aria-valuemin="0"
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatDuration(currentTime)} / ${duration > 0 ? formatDuration(duration) : '--:--'}`}
      on:click={(event) => { onFocus(ODA_THEATER_PROGRESS); handleSeekClick(event); }}
    >
      <span class="oda-theater-progress-fill" style={`width: ${progressPercent}%`}></span>
    </button>
  </div>
{/if}
</div>
