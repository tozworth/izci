<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import type { Readable } from 'svelte/store';
  import { WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE } from '$lib/components/playlist-panel/actions/window-dismiss';
  import {
    buildTheaterLyricRows,
    findActiveLyricIndex,
    findActiveTimelineIndex,
    loadTrackLyrics,
    stripLrcTimestamps,
    type LoadedLyrics
  } from '$lib/services/lyrics';
  import type { LyricsDisplayStyle, PlaybackSnapshot, PlaylistItem } from '$lib/types';

  export let track: PlaylistItem | null = null;
  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let playbackSnapshot: PlaybackSnapshot | null = null;
  export let displayStyle: LyricsDisplayStyle = 'timestamped';
  export let autoScroll = true;
  export let fontSize = 1;
  export let theaterDowntimeDots = true;
  export let theaterDowntimeThresholdSeconds = 10;
  export let theaterSmoothScroll = true;
  export let resumeAutoScrollToken = 0;
  export let forceAutoScroll = false;
  export let hideEyebrow = false;
  export let isTabbedLayout = false;
  export let fillParent = false;
  export let showCloseButton = false;
  export let onClose: () => void = () => {};

  const dispatch = createEventDispatcher<{
    seek: number;
  }>();

  const USER_SCROLL_RESUME_MS = 5000;
  const SEEK_RESUME_THRESHOLD_SECONDS = 1.25;
  const PROGRAMMATIC_SCROLL_MS = 720;
  const FORCED_SCROLL_MAX_ATTEMPTS = 45;

  let snapshot: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0,
    muted: false,
    backend: null
  };
  let effectiveSnapshot: PlaybackSnapshot = snapshot;
  let lyrics: LoadedLyrics | null = null;
  let loading = false;
  let loadError = '';
  let loadToken = 0;
  let loadedTrackKey = '';
  let scroller: HTMLDivElement | null = null;
  let scrollerHeight = 0;
  let lastAutoScrollSignature = '';
  let userScrollPaused = false;
  let lastUserScrollAt = 0;
  let userScrollResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let isProgrammaticScroll = false;
  let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSnapshotAt = Date.now();
  let lastResumeAutoScrollToken = resumeAutoScrollToken;
  let lastForceAutoScroll = false;
  const rowElements = new Map<string, HTMLElement>();

  const unsubscribeSnapshot = snapshotStore.subscribe(handleSnapshotUpdate);

  onDestroy(() => {
    unsubscribeSnapshot();
    clearUserScrollResumeTimer();
    clearProgrammaticScrollTimer();
  });

  function registerRow(node: HTMLElement, key: string) {
    rowElements.set(key, node);

    return {
      update(nextKey: string) {
        rowElements.delete(key);
        key = nextKey;
        rowElements.set(key, node);
      },
      destroy() {
        rowElements.delete(key);
      }
    };
  }

  function measureScroller(node: HTMLDivElement) {
    scroller = node;

    const updateScrollerHeight = () => {
      scrollerHeight = node.clientHeight;
    };

    updateScrollerHeight();

    let observer: ResizeObserver | null = null;

    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateScrollerHeight);
      observer.observe(node);
    }

    return {
      destroy() {
        observer?.disconnect();

        if (scroller === node) {
          scroller = null;
          scrollerHeight = 0;
        }
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

  function getLyricRowKey(index: number): string {
    return `lyric-${index}`;
  }

  function getScrollBehavior(): ScrollBehavior {
    return displayStyle === 'theater' && !theaterSmoothScroll ? 'auto' : 'smooth';
  }

  function waitForNextFrame(): Promise<void> {
    if (typeof requestAnimationFrame === 'undefined') {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }

  function clearUserScrollResumeTimer(): void {
    if (userScrollResumeTimer === null) {
      return;
    }

    clearTimeout(userScrollResumeTimer);
    userScrollResumeTimer = null;
  }

  function clearProgrammaticScrollTimer(): void {
    if (programmaticScrollTimer === null) {
      scroller?.removeAttribute(WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE);
      return;
    }

    clearTimeout(programmaticScrollTimer);
    programmaticScrollTimer = null;
    scroller?.removeAttribute(WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE);
  }

  function markProgrammaticScroll(): void {
    isProgrammaticScroll = true;
    clearProgrammaticScrollTimer();
    scroller?.setAttribute(WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE, '');

    programmaticScrollTimer = setTimeout(() => {
      isProgrammaticScroll = false;
      programmaticScrollTimer = null;
      scroller?.removeAttribute(WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE);
    }, PROGRAMMATIC_SCROLL_MS);
  }

  function getRowTopWithinScroller(row: HTMLElement): number {
    if (!scroller) {
      return row.offsetTop;
    }

    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();

    return rowRect.top - scrollerRect.top + scroller.scrollTop;
  }

  function isRowVisible(rowKey: string): boolean {
    const row = rowElements.get(rowKey);

    if (!row || !scroller) {
      return false;
    }

    const rowRect = row.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();

    return rowRect.bottom > scrollerRect.top && rowRect.top < scrollerRect.bottom;
  }

  function scrollRowToCenter(rowKey: string, behavior: ScrollBehavior): boolean {
    const row = rowElements.get(rowKey);

    if (!row || !scroller) {
      return false;
    }

    if (row.offsetHeight <= 0 || scroller.clientHeight <= 0 || scroller.scrollHeight <= 0) {
      return false;
    }

    const rowTop = getRowTopWithinScroller(row);
    const maxScrollTop = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
    const nextScrollTop = clamp(
      rowTop + row.offsetHeight / 2 - scroller.clientHeight / 2,
      0,
      maxScrollTop
    );

    markProgrammaticScroll();
    scroller.scrollTo({
      top: nextScrollTop,
      behavior
    });
    return true;
  }

  function requestScrollToActiveRow(force = false): void {
    const initialRowKey = activeScrollRowKey;

    if ((!initialRowKey && !force) || !resolvedAutoScroll || (!force && userScrollPaused)) {
      return;
    }

    void (async () => {
      const maxAttempts = force ? FORCED_SCROLL_MAX_ATTEMPTS : 1;
      let lastScrolledRowKey = '';

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await tick();

        const rowKey = force ? activeScrollRowKey : initialRowKey;

        if (!rowKey) {
          await waitForNextFrame();
          continue;
        }

        if (!force && rowKey !== activeScrollRowKey) {
          return;
        }

        if (force && rowKey === lastScrolledRowKey) {
          await waitForNextFrame();
          continue;
        }

        if (scrollRowToCenter(rowKey, getScrollBehavior())) {
          lastScrolledRowKey = rowKey;

          if (!force) {
            return;
          }
        } else if (!force) {
          return;
        }

        await waitForNextFrame();
      }
    })();
  }

  function forceResumeAutoScroll(): void {
    userScrollPaused = false;
    clearUserScrollResumeTimer();
    lastAutoScrollSignature = '';
    requestScrollToActiveRow(true);
  }

  function maybeResumeAutoScroll(): void {
    if (!userScrollPaused || Date.now() - lastUserScrollAt < USER_SCROLL_RESUME_MS) {
      return;
    }

    if (!activeScrollRowKey || !isRowVisible(activeScrollRowKey)) {
      return;
    }

    forceResumeAutoScroll();
  }

  function scheduleUserScrollResumeCheck(): void {
    clearUserScrollResumeTimer();

    userScrollResumeTimer = setTimeout(() => {
      userScrollResumeTimer = null;
      maybeResumeAutoScroll();
    }, USER_SCROLL_RESUME_MS);
  }

  function pauseAutoScrollForUser(): void {
    if (!resolvedAutoScroll) {
      return;
    }

    clearProgrammaticScrollTimer();
    isProgrammaticScroll = false;
    userScrollPaused = true;
    lastUserScrollAt = Date.now();
    scheduleUserScrollResumeCheck();
  }

  function handleScrollerScroll(): void {
    if (isProgrammaticScroll) {
      return;
    }

    pauseAutoScrollForUser();
  }

  function handleSnapshotUpdate(nextSnapshot: PlaybackSnapshot): void {
    const now = Date.now();
    const previousSnapshot = snapshot;
    const elapsedSeconds = Math.max((now - lastSnapshotAt) / 1000, 0);
    const expectedDelta =
      previousSnapshot.state === 'playing' && nextSnapshot.state === 'playing' ? elapsedSeconds : 0;
    const actualDelta = nextSnapshot.currentTime - previousSnapshot.currentTime;
    const resumedPlayback = previousSnapshot.state === 'paused' && nextSnapshot.state === 'playing';
    const seeked =
      Number.isFinite(actualDelta) &&
      Math.abs(actualDelta - expectedDelta) > SEEK_RESUME_THRESHOLD_SECONDS;

    lastSnapshotAt = now;
    snapshot = nextSnapshot;

    if (resumedPlayback || seeked) {
      forceResumeAutoScroll();
    }
  }

  function resetScrollState(): void {
    rowElements.clear();
    lastAutoScrollSignature = '';
    userScrollPaused = false;
    clearUserScrollResumeTimer();
    clearProgrammaticScrollTimer();
    isProgrammaticScroll = false;
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
      resetScrollState();
      return;
    }

    const currentToken = ++loadToken;
    loading = true;
    loadError = '';
    lyrics = null;
    resetScrollState();

    void loadTrackLyrics(nextTrack)
      .then((nextLyrics) => {
        if (currentToken === loadToken) {
          lyrics = nextLyrics;
          forceResumeAutoScroll();
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

  function handleLyricLineClick(time: number): void {
    forceResumeAutoScroll();
    dispatch('seek', time);
  }

  $: normalizedFontSize = clamp(fontSize, 0.72, 2.8);
  $: panelStyle = `--lyrics-font-size: ${normalizedFontSize}em; --lyrics-scroller-height: ${scrollerHeight}px;`;
  $: effectiveSnapshot = playbackSnapshot ?? snapshot;
  $: trackLoadKey = track ? `${track.id}:${track.lastModified}:${track.size}` : '';
  $: loadLyricsForTrack(trackLoadKey, track);
  $: lyricLines = lyrics?.lines ?? [];
  $: theaterRows = buildTheaterLyricRows(
    lyricLines,
    effectiveSnapshot.duration,
    theaterDowntimeDots,
    theaterDowntimeThresholdSeconds
  );
  $: activeLyricIndex = findActiveLyricIndex(lyricLines, effectiveSnapshot.currentTime);
  $: activeTheaterRowIndex = findActiveTimelineIndex(theaterRows, effectiveSnapshot.currentTime);
  $: activeTheaterRow = activeTheaterRowIndex >= 0 ? theaterRows[activeTheaterRowIndex] : null;
  $: isPlaybackPositionVisible =
    effectiveSnapshot.state === 'playing' || effectiveSnapshot.state === 'paused';
  $: activeIndex =
    displayStyle === 'theater'
      ? activeTheaterRow?.type === 'lyric'
        ? activeTheaterRow.lyricIndex
        : -1
      : activeLyricIndex;
  $: activeScrollRowKey =
    displayStyle === 'theater'
      ? activeTheaterRow?.id ?? ''
      : activeLyricIndex >= 0
        ? getLyricRowKey(activeLyricIndex)
        : '';
  $: plainText = lyrics ? stripLrcTimestamps(lyrics.raw) : '';
  $: resolvedAutoScroll = displayStyle === 'theater' || autoScroll;
  $: autoScrollSignature = `${trackLoadKey}:${displayStyle}:${activeScrollRowKey}:${normalizedFontSize}:${theaterDowntimeDots}:${theaterDowntimeThresholdSeconds}:${theaterSmoothScroll}`;
  $: if (resumeAutoScrollToken !== lastResumeAutoScrollToken) {
    lastResumeAutoScrollToken = resumeAutoScrollToken;
    forceResumeAutoScroll();
  }
  $: if (forceAutoScroll !== lastForceAutoScroll) {
    lastForceAutoScroll = forceAutoScroll;

    if (forceAutoScroll) {
      forceResumeAutoScroll();
    }
  }
  $: if (
    resolvedAutoScroll &&
    !userScrollPaused &&
    activeScrollRowKey &&
    autoScrollSignature !== lastAutoScrollSignature
  ) {
    lastAutoScrollSignature = autoScrollSignature;
    requestScrollToActiveRow();
  }
  $: {
    activeScrollRowKey;
    maybeResumeAutoScroll();
  }
</script>

<section
  class="panel lyrics-panel"
  class:fill-parent={fillParent}
  class:theater-mode={displayStyle === 'theater'}
  style={panelStyle}
>
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
      <p>Play a track to view lyrics.</p>
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
    <div
      class="lyrics-content plain-layout"
      class:tabbed-layout={isTabbedLayout}
      use:measureScroller
      on:wheel={pauseAutoScrollForUser}
      on:scroll={handleScrollerScroll}
    >
      {#if lyricLines.length === 0}
        <pre>{plainText}</pre>
      {:else}
        <ol class="lyrics-list" aria-label="Lyrics">
          {#each lyricLines as line, index (getLyricRowKey(index))}
            <li
              use:registerRow={getLyricRowKey(index)}
              class:active={index === activeIndex}
              class:past={index < activeIndex}
            >
              <button
                type="button"
                class="lyric-line-button"
                on:click={() => handleLyricLineClick(line.time)}
              >
                <span class="lyric-text">{line.text || '\u00a0'}</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else if displayStyle === 'timestamped'}
    <div
      class="lyrics-content timestamped-layout"
      class:tabbed-layout={isTabbedLayout}
      use:measureScroller
      on:wheel={pauseAutoScrollForUser}
      on:scroll={handleScrollerScroll}
    >
      {#if lyricLines.length === 0}
        <pre class="untimed-fallback">{plainText}</pre>
      {:else}
        <ol class="lyrics-list" aria-label="Synced lyrics">
          {#each lyricLines as line, index (getLyricRowKey(index))}
            <li
              use:registerRow={getLyricRowKey(index)}
              class:active={index === activeIndex}
              class:past={index < activeIndex}
            >
              <button
                type="button"
                class="lyric-line-button"
                on:click={() => handleLyricLineClick(line.time)}
              >
                <span class="lyric-time">{formatTimestamp(line.time)}</span>
                <span class="lyric-text">{line.text || '\u00a0'}</span>
              </button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else}
    <div
      class="lyrics-content theater-layout"
      class:tabbed-layout={isTabbedLayout}
      use:measureScroller
      on:wheel={pauseAutoScrollForUser}
      on:scroll={handleScrollerScroll}
    >
      {#if lyricLines.length === 0}
        <pre class="untimed-fallback">{plainText}</pre>
      {:else}
        <ol class="lyrics-list" aria-label="Synced lyrics">
          {#each theaterRows as row, index (row.id)}
            {#if row.type === 'downtime'}
              <li
                use:registerRow={row.id}
                class="downtime-row"
                class:active={index === activeTheaterRowIndex}
                aria-hidden={index !== activeTheaterRowIndex}
                style={`--lyric-opacity: ${lyricOpacity(index, activeTheaterRowIndex)}; --lyric-scale: ${lyricScale(index, activeTheaterRowIndex)};`}
              >
                {#if index === activeTheaterRowIndex && isPlaybackPositionVisible}
                  <span
                    class="downtime-dots"
                    class:is-playing={effectiveSnapshot.state === 'playing'}
                    aria-label="Instrumental break"
                  >
                    <span></span>
                    <span></span>
                    <span></span>
                  </span>
                {/if}
              </li>
            {:else}
              <li
                use:registerRow={row.id}
                class:active={row.lyricIndex === activeIndex}
                class:past={row.time < effectiveSnapshot.currentTime}
                style={`--lyric-opacity: ${lyricOpacity(index, activeTheaterRowIndex)}; --lyric-scale: ${lyricScale(index, activeTheaterRowIndex)};`}
              >
                <button
                  type="button"
                  class="lyric-line-button"
                  on:click={() => handleLyricLineClick(row.time)}
                >
                  <span class="lyric-text">{row.text || '\u00a0'}</span>
                </button>
              </li>
            {/if}
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

  .lyrics-close-button:focus-visible,
  .lyric-line-button:focus-visible {
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
    scroll-behavior: auto;
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
    font-size: var(--lyrics-font-size);
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .lyrics-list {
    list-style: none;
    margin: 0;
    padding: 0 0 max(1rem, calc(var(--lyrics-scroller-height, 0px) * 0.45));
    display: grid;
    gap: 0.16rem;
  }

  .lyric-line-button {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    margin: 0;
    border: 0;
    padding: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .lyric-line-button:hover {
    color: var(--text-strong);
  }

  .plain-layout .lyrics-list li {
    color: var(--text);
    font-size: var(--lyrics-font-size);
    line-height: 1.55;
  }

  .plain-layout .lyric-line-button {
    padding: 0.2rem 0;
  }

  .plain-layout .lyrics-list li.active {
    color: var(--text-strong);
    font-weight: 700;
  }

  .timestamped-layout .lyrics-list li {
    border-radius: 4px;
    color: var(--text);
    font-size: var(--lyrics-font-size);
    line-height: 1.35;
  }

  .lyrics-content.timestamped-layout {
    padding-top: 0.1rem;
    padding-inline: 0.45rem;
  }

  .timestamped-layout .lyric-line-button {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: baseline;
    gap: 0.65rem;
    padding: 0.16rem 0.25rem;
    border-radius: inherit;
    line-height: inherit;
  }

  .timestamped-layout .lyrics-list li.active .lyric-line-button {
    background: var(--selection-bg);
    color: var(--text-strong);
    font-weight: 700;
  }

  .lyric-time {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    font-size: 0.86em;
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
    overflow: auto;
    mask-image: linear-gradient(transparent, black 14%, black 86%, transparent);
  }

  .theater-layout .lyrics-list {
    width: 100%;
    min-height: 100%;
    gap: 0.8rem;
    align-content: start;
    padding: max(1rem, calc(var(--lyrics-scroller-height, 0px) * 0.45)) 0;
  }

  .theater-layout .lyrics-list li {
    padding: 0.15rem 0;
    color: color-mix(in srgb, var(--text-strong) 72%, transparent);
    font-size: var(--lyrics-font-size);
    font-weight: 650;
    line-height: 1.12;
    opacity: var(--lyric-opacity, 0.58);
    transform: scale(var(--lyric-scale, 0.95));
    transform-origin: left center;
    transition:
      opacity 160ms ease,
      transform 180ms ease,
      color 160ms ease;
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

  .theater-layout .lyric-line-button {
    line-height: inherit;
  }

  .theater-layout .lyric-text {
    overflow-wrap: break-word;
  }

  .downtime-row {
    display: flex;
    justify-content: center;
    min-height: calc(var(--lyrics-font-size) * 1.05);
    transform-origin: center;
    text-align: center;
  }

  .downtime-dots {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.42em;
    padding: 0.18em 0;
    color: currentColor;
  }

  .downtime-dots span {
    width: 0.32em;
    height: 0.32em;
    border-radius: 999px;
    background: currentColor;
    opacity: 0.28;
    animation: downtime-dot-fade 1.35s ease-in-out infinite;
    animation-play-state: paused;
  }

  .downtime-dots.is-playing span {
    animation-play-state: running;
  }

  .downtime-dots span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .downtime-dots span:nth-child(3) {
    animation-delay: 0.32s;
  }

  @keyframes downtime-dot-fade {
    0%,
    70%,
    100% {
      opacity: 0.25;
    }

    25% {
      opacity: 0.95;
    }
  }

  @media (max-width: 520px) {
    .timestamped-layout .lyric-line-button {
      grid-template-columns: 4.1rem minmax(0, 1fr);
      gap: 0.45rem;
      padding-inline: 0.1rem;
    }
  }
</style>
