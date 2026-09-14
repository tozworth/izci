<script lang="ts">
  import { tick } from 'svelte';
  import type { PlaybackSnapshot, RepeatMode, TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import {
    buildTheaterLyricRows,
    findActiveTimelineIndex,
    loadTrackLyrics,
    stripLrcTimestamps,
    type LoadedLyrics
  } from '$lib/services/lyrics';
  import {
    ODA_NP_LYRICS,
    ODA_NP_NEXT,
    ODA_NP_PLAY_PAUSE,
    ODA_NP_PREVIOUS,
    ODA_NP_PROGRESS,
    ODA_NP_QUEUE,
    ODA_NP_REPEAT,
    ODA_NP_SHUFFLE,
    ODA_NP_VOLUME
  } from '../oda-now-playing';
  import type { OdaTranslate } from '../oda-translate';

  export let track: TrackItem | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let artworkUrl: string | null = null;
  export let focusId: string | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let translate: OdaTranslate;
  export let hasLyrics = false;
  export let lyricsOpen = false;

  export let onFocus: (focusId: string) => void = () => {};
  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onToggleQueue: () => void = () => {};
  export let onToggleLyrics: () => void = () => {};

  $: currentTime = snapshot?.currentTime ?? 0;
  $: duration = snapshot?.duration ?? 0;
  $: progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  $: volumePercent = Math.round((snapshot?.volume ?? 0) * 100);
  $: title = track ? (getTrackDisplayTitle(track) || track.name) : translate('oda.nowPlaying.idleTitle', 'Nothing playing');
  $: artist = track?.metadata?.artist?.trim() || '';
  $: album = track?.metadata?.album?.trim() || '';
  $: playbackPlaying = snapshot?.state === 'playing';

  let lyrics: LoadedLyrics | null = null;
  let lyricsLoading = false;
  let lyricsLoadToken = 0;
  let lyricsLoadedKey = '';
  let lyricsScroller: HTMLDivElement | null = null;
  let lyricsUserPaused = false;
  let lyricsUserResumeTimer: ReturnType<typeof setTimeout> | null = null;
  const lyricRowNodes = new Map<string, HTMLElement>();

  function resetLyricsScroll(): void {
    lyricRowNodes.clear();
    lyricsUserPaused = false;
    if (lyricsUserResumeTimer !== null) {
      clearTimeout(lyricsUserResumeTimer);
      lyricsUserResumeTimer = null;
    }
    lyricsScroller?.scrollTo({ top: 0, behavior: 'auto' });
  }

  function loadLyricsForTrack(key: string, nextTrack: TrackItem | null): void {
    if (key === lyricsLoadedKey) return;
    lyricsLoadedKey = key;
    if (!key || !nextTrack) {
      lyricsLoadToken += 1;
      lyrics = null;
      lyricsLoading = false;
      resetLyricsScroll();
      return;
    }
    const token = ++lyricsLoadToken;
    lyricsLoading = true;
    lyrics = null;
    resetLyricsScroll();
    void loadTrackLyrics(nextTrack)
      .then((next) => {
        if (token === lyricsLoadToken) {
          lyrics = next;
          void tick().then(() => scrollLyricsToActive(true));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (token === lyricsLoadToken) lyricsLoading = false;
      });
  }

  function registerLyricRow(node: HTMLElement, key: string) {
    lyricRowNodes.set(key, node);
    return {
      update(nextKey: string) {
        lyricRowNodes.delete(key);
        key = nextKey;
        lyricRowNodes.set(key, node);
      },
      destroy() {
        lyricRowNodes.delete(key);
      }
    };
  }

  function scrollLyricsToActive(immediate = false): void {
    const row = activeTheaterRowIndex >= 0 ? theaterRows[activeTheaterRowIndex] : null;
    if (!row || !lyricsScroller) return;
    const element = lyricRowNodes.get(row.id);
    if (!element) return;
    const scrollerRect = lyricsScroller.getBoundingClientRect();
    const rowRect = element.getBoundingClientRect();
    const delta = rowRect.top + rowRect.height / 2 - (scrollerRect.top + scrollerRect.height / 2);
    lyricsScroller.scrollBy({ top: delta, behavior: immediate ? 'auto' : 'smooth' });
  }

  function pauseLyricsFollow(): void {
    lyricsUserPaused = true;
    if (lyricsUserResumeTimer !== null) clearTimeout(lyricsUserResumeTimer);
    lyricsUserResumeTimer = setTimeout(() => {
      lyricsUserPaused = false;
      lyricsUserResumeTimer = null;
      scrollLyricsToActive();
    }, 5000);
  }

  function lyricDistance(index: number, activeIndex: number): number {
    return activeIndex < 0 ? Math.min(index, 4) : Math.min(Math.abs(index - activeIndex), 4);
  }

  function lyricOpacity(index: number, activeIndex: number): number {
    if (index === activeIndex) return 1;
    return Math.max(0.24, 0.72 - lyricDistance(index, activeIndex) * 0.12);
  }

  function lyricScale(index: number, activeIndex: number): number {
    if (index === activeIndex) return 1;
    return Math.max(0.9, 1 - lyricDistance(index, activeIndex) * 0.025);
  }

  function focused(id: string): boolean {
    return focusId === id;
  }

  function repeatLabel(): string {
    if (repeatMode === 'one') return translate('oda.nowPlaying.repeatOne', 'Repeat one');
    if (repeatMode === 'all') return translate('oda.nowPlaying.repeatAll', 'Repeat all');
    return translate('oda.nowPlaying.repeatOff', 'Repeat off');
  }

  function lyricsLabel(): string {
    if (!hasLyrics) return translate('oda.nowPlaying.noLyrics', 'No lyrics');
    return translate('oda.nowPlaying.lyrics', 'Lyrics');
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

  $: trackLyricsKey = track ? `${track.id}:${track.lastModified}:${track.size}` : '';
  $: loadLyricsForTrack(trackLyricsKey, track);
  $: lyricLines = lyrics?.lines ?? [];
  $: theaterRows = buildTheaterLyricRows(lyricLines, duration, true, 10);
  $: activeTheaterRowIndex = findActiveTimelineIndex(theaterRows, currentTime);
  $: activeLyricIndex = activeTheaterRowIndex >= 0 && theaterRows[activeTheaterRowIndex]?.type === 'lyric'
    ? theaterRows[activeTheaterRowIndex].lyricIndex
    : -1;
  $: plainLyricsText = lyrics ? stripLrcTimestamps(lyrics.raw) : '';
  $: activeLyricsRowId = lyricsOpen && activeTheaterRowIndex >= 0
    ? theaterRows[activeTheaterRowIndex]?.id ?? ''
    : '';
  $: if (lyricsOpen && !lyricsUserPaused && activeLyricsRowId) {
    void tick().then(() => scrollLyricsToActive());
  }
  $: lyricsEmptyMessage = !track
    ? translate('main.lyrics.playTrack', 'Play a track to view lyrics.')
    : lyricsLoading
      ? translate('main.lyrics.reading', 'Reading embedded lyrics...')
      : !lyrics
        ? translate('main.lyrics.notFound', 'No embedded lyrics found.')
        : '';
</script>

<div class="oda-now-playing" class:has-lyrics={lyricsOpen}>
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
        <span class="oda-transport-left">
          <button
            type="button"
            class="oda-queue-toggle"
            class:is-focused={focused(ODA_NP_QUEUE)}
            title={translate('oda.queue.open', 'Queue')}
            aria-label={translate('oda.queue.open', 'Queue')}
            on:click={() => activate(ODA_NP_QUEUE, onToggleQueue)}
          >
            <span class="material-symbols-outlined">queue_music</span>
          </button>
          <button
            type="button"
            class="oda-lyrics-toggle"
            class:is-active={lyricsOpen}
            class:is-focused={focused(ODA_NP_LYRICS)}
            title={lyricsLabel()}
            aria-label={lyricsLabel()}
            aria-pressed={lyricsOpen}
            disabled={!hasLyrics}
            on:click={() => activate(ODA_NP_LYRICS, onToggleLyrics)}
          >
            <span class="material-symbols-outlined">lyrics</span>
          </button>
        </span>
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

  {#if lyricsOpen}
    <aside class="oda-lyrics" aria-label={translate('oda.nowPlaying.lyrics', 'Lyrics')}>
      {#if lyricsEmptyMessage}
        <div class="oda-lyrics-empty">
          <p>{lyricsEmptyMessage}</p>
        </div>
      {:else if lyricLines.length === 0}
        <div
          class="oda-lyrics-scroller"
          bind:this={lyricsScroller}
          on:wheel={pauseLyricsFollow}
        >
          <pre class="oda-lyrics-plain">{plainLyricsText}</pre>
        </div>
      {:else}
        <div
          class="oda-lyrics-scroller"
          bind:this={lyricsScroller}
          on:wheel={pauseLyricsFollow}
        >
          <ol class="oda-lyrics-list">
            {#each theaterRows as row, index (row.id)}
              {#if row.type === 'downtime'}
                <li
                  use:registerLyricRow={row.id}
                  class="oda-lyrics-downtime"
                  class:active={index === activeTheaterRowIndex}
                  aria-hidden={index !== activeTheaterRowIndex}
                  style={`--lyric-opacity: ${lyricOpacity(index, activeTheaterRowIndex)}; --lyric-scale: ${lyricScale(index, activeTheaterRowIndex)};`}
                >
                  {#if index === activeTheaterRowIndex && (snapshot?.state === 'playing' || snapshot?.state === 'paused')}
                    <span
                      class="oda-lyrics-dots"
                      class:is-playing={playbackPlaying}
                      aria-label={translate('main.lyrics.instrumentalBreak', 'Instrumental break')}
                    >
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  {/if}
                </li>
              {:else}
                <li
                  use:registerLyricRow={row.id}
                  class:active={row.lyricIndex === activeLyricIndex}
                  class:past={row.time < currentTime}
                  style={`--lyric-opacity: ${lyricOpacity(index, activeTheaterRowIndex)}; --lyric-scale: ${lyricScale(index, activeTheaterRowIndex)};`}
                >
                  <button
                    type="button"
                    class="oda-lyric-line"
                    on:click={() => onSeek(row.time)}
                  >
                    <span>{row.text || ' '}</span>
                  </button>
                </li>
              {/if}
            {/each}
          </ol>
        </div>
      {/if}
    </aside>
  {/if}
</div>
