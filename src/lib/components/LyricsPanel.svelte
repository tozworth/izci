<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import {
    findActiveLyricIndex,
    loadTrackLyrics,
    stripLrcTimestamps,
    type LoadedLyrics
  } from '$lib/services/lyrics';
  import type { LyricsDisplayStyle, PlaybackSnapshot, PlaylistItem } from '$lib/types';

  export let track: PlaylistItem | null = null;
  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let displayStyle: LyricsDisplayStyle = 'timestamped';
  export let autoScroll = true;
  export let hideEyebrow = false;
  export let isTabbedLayout = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};

  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    muted: false,
    backend: null
  };
  let lyrics: LoadedLyrics | null = null;
  let loading = false;
  let loadError = '';
  let loadToken = 0;
  let loadedTrackKey = '';
  let scroller: HTMLDivElement | null = null;
  let lastScrolledIndex = -2;
  let lastScrolledStyle: LyricsDisplayStyle | '' = '';
  let theaterList: HTMLOListElement | null = null;
  let theaterOffset = 0;
  const rowElements = new Map<number, HTMLElement>();
  const THEATER_MAX_TRANSITION_SECONDS = 0.72;
  const THEATER_MIN_TRANSITION_SECONDS = 0.28;

  const unsubscribeSnapshot = snapshotStore.subscribe((value) => {
    snapshot = value;
  });

  onDestroy(() => {
    unsubscribeSnapshot();
  });

  function registerRow(node: HTMLElement, index: number) {
    rowElements.set(index, node);

    return {
      update(nextIndex: number) {
        rowElements.delete(index);
        index = nextIndex;
        rowElements.set(index, node);
      },
      destroy() {
        rowElements.delete(index);
      }
    };
  }

  function formatTimestamp(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    const centiseconds = Math.floor((seconds - Math.floor(seconds)) * 100);

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${centiseconds
      .toString()
      .padStart(2, '0')}`;
  }

  function lyricDistance(index: number, activeIndex: number): number {
    return activeIndex < 0 ? Math.min(index, 4) : Math.min(Math.abs(index - activeIndex), 4);
  }

  function lyricOpacity(index: number, activeIndex: number): number {
    if (index === activeIndex) {
      return 1;
    }

    return Math.max(0.24, 0.72 - lyricDistance(index, activeIndex) * 0.12);
  }

  function lyricScale(index: number, activeIndex: number): number {
    if (index === activeIndex) {
      return 1;
    }

    return Math.max(0.9, 1 - lyricDistance(index, activeIndex) * 0.025);
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function smoothstep(value: number): number {
    const normalized = clamp(value, 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
  }

  function getLineContentCenter(index: number): number | null {
    const row = rowElements.get(index);

    if (!row || !theaterList) {
      return null;
    }

    return theaterList.offsetTop + row.offsetTop + row.offsetHeight / 2;
  }

  function resolveTheaterContentCenter(): number | null {
    if (lyricLines.length === 0) {
      return null;
    }

    const baseIndex = activeIndex >= 0 ? activeIndex : 0;
    const baseCenter = getLineContentCenter(baseIndex);

    if (baseCenter === null || activeIndex < 0) {
      return baseCenter;
    }

    const nextIndex = activeIndex + 1;
    const nextLine = lyricLines[nextIndex];

    if (!nextLine) {
      return baseCenter;
    }

    const nextCenter = getLineContentCenter(nextIndex);

    if (nextCenter === null) {
      return baseCenter;
    }

    const interval = nextLine.time - lyricLines[activeIndex].time;
    const transitionSeconds = clamp(
      interval * 0.42,
      THEATER_MIN_TRANSITION_SECONDS,
      THEATER_MAX_TRANSITION_SECONDS
    );
    const transitionStart = nextLine.time - transitionSeconds;
    const progress = smoothstep((snapshot.currentTime - transitionStart) / transitionSeconds);

    return baseCenter + (nextCenter - baseCenter) * progress;
  }

  function updateTheaterOffset(): void {
    if (displayStyle !== 'theater' || !scroller) {
      theaterOffset = 0;
      return;
    }

    void tick().then(() => {
      if (displayStyle !== 'theater' || !scroller) {
        theaterOffset = 0;
        return;
      }

      scroller.scrollTop = 0;
      const contentCenter = resolveTheaterContentCenter();

      if (contentCenter === null) {
        theaterOffset = 0;
        return;
      }

      theaterOffset = scroller.clientHeight / 2 - contentCenter;
    });
  }

  function loadLyricsForTrack(key: string, nextTrack: PlaylistItem | null) {
    if (key === loadedTrackKey) {
      return;
    }

    loadedTrackKey = key;

    if (!key || !nextTrack) {
      loadToken += 1;
      loading = false;
      loadError = '';
      lyrics = null;
      rowElements.clear();
      lastScrolledIndex = -2;
      lastScrolledStyle = '';
      theaterOffset = 0;
      return;
    }

    const currentToken = ++loadToken;
    loading = true;
    loadError = '';
    lyrics = null;
    rowElements.clear();
    lastScrolledIndex = -2;
    lastScrolledStyle = '';
    theaterOffset = 0;

    void loadTrackLyrics(nextTrack)
      .then((nextLyrics) => {
        if (currentToken === loadToken) {
          lyrics = nextLyrics;
        }
      })
      .catch(() => {
        if (currentToken === loadToken) {
          loadError = 'Lyrics could not be read from this file.';
        }
      })
      .finally(() => {
        if (currentToken === loadToken) {
          loading = false;
        }
      });
  }

  $: trackLoadKey = track ? `${track.id}:${track.lastModified}:${track.size}` : '';
  $: loadLyricsForTrack(trackLoadKey, track);
  $: lyricLines = lyrics?.lines ?? [];
  $: activeIndex = findActiveLyricIndex(lyricLines, snapshot.currentTime);
  $: plainText = lyrics ? stripLrcTimestamps(lyrics.raw) : '';
  $: resolvedAutoScroll = displayStyle === 'theater' || autoScroll;
  $: {
    displayStyle;
    snapshot.currentTime;
    activeIndex;
    lyricLines.length;
    updateTheaterOffset();
  }
  $: if (
    resolvedAutoScroll &&
    displayStyle !== 'theater' &&
    activeIndex >= 0 &&
    (activeIndex !== lastScrolledIndex || displayStyle !== lastScrolledStyle)
  ) {
    lastScrolledIndex = activeIndex;
    lastScrolledStyle = displayStyle;
    void tick().then(() => {
      const row = rowElements.get(activeIndex);

      if (!row || !scroller) {
        return;
      }

      row.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    });
  }
</script>

<section class="panel lyrics-panel" class:fill-parent={fillParent} class:theater-mode={displayStyle === 'theater'}>
  <div class="panel-header">
    <div class="panel-heading">
      {#if !hideEyebrow}
        <p class="eyebrow">Lyrics</p>
      {/if}
    </div>

    {#if showCloseButton}
      <button
        type="button"
        class="lyrics-close-button"
        aria-label="Close Lyrics"
        title="Close"
        on:click={onClose}
      >
        <span class="lyrics-close-label" aria-hidden="true">Close</span>
        <span class="material-symbols-outlined lyrics-close-icon" aria-hidden="true">close</span>
      </button>
    {/if}
  </div>

  {#if !track}
    <div class="empty-state align-start" class:tabbed-layout={isTabbedLayout}>
      <p>Select a track to view lyrics.</p>
    </div>
  {:else if loading}
    <div class="empty-state align-start" class:tabbed-layout={isTabbedLayout}>
      <p>Reading embedded lyrics...</p>
    </div>
  {:else if loadError}
    <div class="empty-state align-start" class:tabbed-layout={isTabbedLayout}>
      <p>{loadError}</p>
    </div>
  {:else if !lyrics}
    <div class="empty-state align-start" class:tabbed-layout={isTabbedLayout}>
      <p>No embedded lyrics found.</p>
    </div>
  {:else if displayStyle === 'plain'}
    <div class="lyrics-content plain-layout" class:tabbed-layout={isTabbedLayout} bind:this={scroller}>
      {#if lyricLines.length === 0}
        <pre>{plainText}</pre>
      {:else}
        <ol class="lyrics-list" aria-label="Lyrics">
          {#each lyricLines as line, index}
            <li
              use:registerRow={index}
              class:active={index === activeIndex}
              class:past={index < activeIndex}
              class:blank-line={line.text.length === 0}
            >
              <span class="lyric-text">{line.text || '\u00a0'}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else}
    <div
      class="lyrics-content"
      class:timestamped-layout={displayStyle === 'timestamped'}
      class:theater-layout={displayStyle === 'theater'}
      class:tabbed-layout={isTabbedLayout}
      bind:this={scroller}
    >
      {#if lyricLines.length === 0}
        <pre class="untimed-fallback">{plainText}</pre>
      {:else}
        <ol
          class="lyrics-list"
          aria-label="Synced lyrics"
          bind:this={theaterList}
          style={displayStyle === 'theater' ? `--theater-offset: ${theaterOffset}px;` : ''}
        >
          {#each lyricLines as line, index}
            <li
              use:registerRow={index}
              class:active={index === activeIndex}
              class:past={index < activeIndex}
              class:blank-line={line.text.length === 0}
              style={`--lyric-opacity: ${lyricOpacity(index, activeIndex)}; --lyric-scale: ${lyricScale(index, activeIndex)};`}
            >
              {#if displayStyle === 'timestamped'}
                <span class="lyric-time">{formatTimestamp(line.time)}</span>
              {/if}
              <span class="lyric-text">{line.text || '\u00a0'}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {/if}
</section>

<style>
  .lyrics-panel {
    position: relative;
    isolation: isolate;
  }

  .lyrics-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .lyrics-close-button {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    gap: 0.22rem;
    min-width: 5.75rem;
    padding: 0;
    line-height: 1;
    color: var(--muted);
    background: transparent;
    transition: none;
  }

  .lyrics-close-button:hover,
  .lyrics-close-button:focus-visible {
    color: var(--text);
  }

  .lyrics-close-button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .lyrics-close-label {
    overflow: hidden;
    max-width: 0;
    opacity: 0;
    white-space: nowrap;
    transition: none;
  }

  .lyrics-close-button:hover .lyrics-close-label,
  .lyrics-close-button:focus-visible .lyrics-close-label {
    max-width: 3.5rem;
    opacity: 1;
  }

  .lyrics-close-icon {
    font-size: 1.1rem;
  }

  .lyrics-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0.35rem 0.9rem 1rem;
    scroll-behavior: smooth;
  }

  .lyrics-content.tabbed-layout,
  .empty-state.tabbed-layout {
    padding-bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
  }

  .plain-layout pre,
  .untimed-fallback {
    margin: 0;
    color: var(--text);
    font: inherit;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .plain-layout .lyrics-list li {
    padding: 0.2rem 0;
    color: var(--text);
    line-height: 1.55;
  }

  .plain-layout .lyrics-list li.active {
    color: var(--text-strong);
    font-weight: 700;
  }

  .lyrics-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.16rem;
  }

  .timestamped-layout .lyrics-list li {
    display: grid;
    grid-template-columns: 4.8rem minmax(0, 1fr);
    align-items: baseline;
    gap: 0.65rem;
    padding: 0.28rem 0.35rem;
    border-radius: 4px;
    color: var(--text);
    line-height: 1.35;
  }

  .timestamped-layout .lyrics-list li.active {
    background: var(--selection-bg);
    color: var(--text-strong);
    font-weight: 700;
  }

  .lyric-time {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
  }

  .lyric-text {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .theater-mode .panel-header {
    min-height: 0;
    padding-top: 0.65rem;
  }

  .theater-layout {
    display: block;
    padding: 0 1.15rem;
    overflow: hidden;
    mask-image: linear-gradient(transparent, black 14%, black 86%, transparent);
  }

  .theater-layout .lyrics-list {
    width: 100%;
    gap: 0.8rem;
    align-content: center;
    transform: translateY(var(--theater-offset, 0px));
    transition: transform 210ms cubic-bezier(0.22, 0.78, 0.32, 1);
    will-change: transform;
  }

  .theater-layout .lyrics-list li {
    padding: 0.15rem 0;
    color: color-mix(in srgb, var(--text-strong) 72%, transparent);
    font-size: 1.55rem;
    font-weight: 650;
    line-height: 1.12;
    opacity: var(--lyric-opacity, 0.58);
    transform: scale(var(--lyric-scale, 0.95));
    transform-origin: left center;
    transition:
      opacity 220ms ease,
      transform 220ms ease,
      color 220ms ease;
  }

  .theater-layout .lyrics-list li.active {
    color: var(--text-strong);
    font-weight: 700;
    opacity: 1;
    transform: scale(1);
  }

  .theater-layout .lyrics-list li:not(.active) {
    color: var(--muted);
  }

  .theater-layout .lyrics-list li.blank-line {
    min-height: 0.65rem;
  }

  .theater-layout .lyric-text {
    overflow-wrap: break-word;
  }

  @media (min-width: 980px) {
    .theater-layout .lyrics-list li {
      font-size: 1.9rem;
    }
  }

  @media (max-width: 520px) {
    .timestamped-layout .lyrics-list li {
      grid-template-columns: 4.1rem minmax(0, 1fr);
      gap: 0.45rem;
      padding-inline: 0.1rem;
    }

    .theater-layout .lyrics-list li {
      font-size: 1.35rem;
    }
  }
</style>
