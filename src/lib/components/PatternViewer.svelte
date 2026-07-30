<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { isPatternCellEmpty, splitPatternCell } from '$lib/services/pattern-presentation';
  import { SCROLLBAR_VISIBILITY_IGNORE_SCROLL_ATTRIBUTE } from '$lib/services/scrollbar-visibility';
  import { patternViewerSettings } from '$lib/stores/pattern-viewer-settings';
  import type {
    ModulePatternSnapshot,
    ModulePatternSong,
    PlaybackSnapshot,
    PlaylistItem
  } from '$lib/types';

  export let track: PlaylistItem | null = null;
  export let snapshot: ModulePatternSnapshot;
  export let playbackSnapshot: PlaybackSnapshot | null = null;

  let viewport: HTMLDivElement | null = null;
  let viewportHeight = 0;
  let channelHeaderHeight = 0;
  let song: ModulePatternSong | null = null;
  let lastFollowKey = '';
  let followRequest = 0;
  let ignoredScrollElement: HTMLElement | null = null;
  let ignoredScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;

  const PROGRAMMATIC_SCROLL_MS = 720;

  $: isCurrentModule = track?.kind === 'module' && snapshot.trackId === track.id;
  $: syncSong(isCurrentModule ? snapshot.song : null);
  $: patternIndex = song
    ? Math.min(Math.max(snapshot.pattern, 0), Math.max(song.patterns.length - 1, 0))
    : 0;
  $: pattern = song?.patterns[patternIndex] ?? null;
  $: channelCount = Math.max(song?.channels.length ?? 0, pattern?.rows[0]?.length ?? 0);
  $: channels = Array.from({ length: channelCount }, (_, index) => ({
    index,
    name: song?.channels[index]?.trim() ?? ''
  }));
  $: orderCount = song?.orders.length ?? 0;
  $: rowCount = pattern?.rows.length ?? 0;
  $: activeRow = Math.min(Math.max(snapshot.row, 0), Math.max(rowCount - 1, 0));
  $: followKey = `${snapshot.trackId ?? ''}:${snapshot.order}:${patternIndex}:${activeRow}:${$patternViewerSettings.rowHeight}:${$patternViewerSettings.alwaysCenterActiveRow}`;
  $: centerSpacerHeight = $patternViewerSettings.followPlayback && $patternViewerSettings.alwaysCenterActiveRow
    ? Math.max((viewportHeight - channelHeaderHeight - $patternViewerSettings.rowHeight) / 2, 0)
    : 0;
  $: patternGridStyle = [
    `--pattern-channel-count: ${Math.max(channelCount, 1)}`,
    `--pattern-font-size: ${$patternViewerSettings.fontSize}px`,
    `--pattern-row-height: ${$patternViewerSettings.rowHeight}px`,
    `--pattern-channel-width: ${$patternViewerSettings.channelWidth}px`,
    `--pattern-center-spacer-height: ${centerSpacerHeight}px`
  ].join('; ');
  $: if ($patternViewerSettings.followPlayback && pattern && followKey !== lastFollowKey) {
    lastFollowKey = followKey;
    void centerActiveRow();
  }

  function formatIndex(value: number, minimumWidth = 2): string {
    if ($patternViewerSettings.rowNumberBase === 'decimal') {
      return String(value).padStart(minimumWidth, '0');
    }

    return value.toString(16).toUpperCase().padStart(minimumWidth, '0');
  }

  function formatPosition(value: number, total: number): string {
    const width = Math.max(2, formatIndex(Math.max(total - 1, 0)).length);
    return formatIndex(value, width);
  }

  function syncSong(nextSong: ModulePatternSong | null): void {
    // Row-only snapshots arrive frequently during playback. Keep the song object
    // stable so those updates do not rebuild the channel model and dirty every
    // pattern cell.
    if (song !== nextSong) {
      song = nextSong;
    }
  }

  function measurePatternViewport(node: HTMLDivElement) {
    const channelHeader = node.querySelector<HTMLElement>('.pattern-channel-header');

    const updateMeasurements = () => {
      const nextViewportHeight = node.clientHeight;
      const nextChannelHeaderHeight = channelHeader?.getBoundingClientRect().height ?? 0;

      if (nextViewportHeight === viewportHeight && nextChannelHeaderHeight === channelHeaderHeight) {
        return;
      }

      viewportHeight = nextViewportHeight;
      channelHeaderHeight = nextChannelHeaderHeight;

      if ($patternViewerSettings.followPlayback && pattern) {
        void centerActiveRow();
      }
    };

    updateMeasurements();

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateMeasurements);
    observer?.observe(node);

    if (channelHeader) {
      observer?.observe(channelHeader);
    }

    return {
      destroy() {
        observer?.disconnect();
        viewportHeight = 0;
        channelHeaderHeight = 0;
      }
    };
  }

  async function centerActiveRow(): Promise<void> {
    const request = ++followRequest;
    await tick();

    if (destroyed || request !== followRequest || !viewport) {
      return;
    }

    const activeRowElement = viewport.querySelector<HTMLElement>('[data-pattern-active-row="true"]');

    if (!activeRowElement) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const activeRowRect = activeRowElement.getBoundingClientRect();
    const stickyHeaderHeight = $patternViewerSettings.alwaysCenterActiveRow
      ? channelHeaderHeight
      : 0;
    const rowTop = viewport.scrollTop + activeRowRect.top - viewportRect.top;
    const top = Math.max(
      rowTop
        - stickyHeaderHeight
        - (viewport.clientHeight - stickyHeaderHeight - activeRowRect.height) / 2,
      0
    );

    markProgrammaticScroll(viewport);

    if ($patternViewerSettings.smoothScroll && playbackSnapshot?.state === 'playing') {
      viewport.scrollTo({ top, behavior: 'smooth' });
      return;
    }

    // Apply the row correction in the same update turn. Deferring it to a new
    // animation frame lets the active style paint one row away from center.
    viewport.scrollTop = top;
  }

  function clearProgrammaticScroll(): void {
    if (ignoredScrollTimer !== null) {
      clearTimeout(ignoredScrollTimer);
      ignoredScrollTimer = null;
    }

    ignoredScrollElement?.removeAttribute(SCROLLBAR_VISIBILITY_IGNORE_SCROLL_ATTRIBUTE);
    ignoredScrollElement = null;
  }

  function markProgrammaticScroll(element: HTMLElement): void {
    clearProgrammaticScroll();
    ignoredScrollElement = element;
    element.setAttribute(SCROLLBAR_VISIBILITY_IGNORE_SCROLL_ATTRIBUTE, '');
    ignoredScrollTimer = setTimeout(clearProgrammaticScroll, PROGRAMMATIC_SCROLL_MS);
  }

  onDestroy(() => {
    destroyed = true;
    followRequest += 1;
    clearProgrammaticScroll();
  });
</script>

<section
  class="pattern-viewer colors-{$patternViewerSettings.colorScheme}"
  aria-label={$t('main.patterns.modulePatterns', { default: 'Module patterns' })}
>
  {#if track?.kind === 'module' && song && pattern}
    <header class="pattern-toolbar">
      <span class="pattern-channel-count">{$t('main.patterns.channelCount', {
        default: '{count, plural, one {# channel} other {# channels}}',
        values: { count: channelCount }
      })}</span>

      <div class="pattern-position" aria-label={$t('main.patterns.playbackPosition', { default: 'Pattern playback position' })}>
        <span><small>{$t('main.patterns.orderAbbreviation', { default: 'ORD' })}</small><b>{formatPosition(snapshot.order, orderCount)}</b></span>
        <span><small>{$t('main.patterns.patternAbbreviation', { default: 'PAT' })}</small><b>{formatPosition(patternIndex, song.patterns.length)}</b></span>
        <span><small>{$t('main.patterns.rowAbbreviation', { default: 'ROW' })}</small><b>{formatPosition(activeRow, rowCount)}</b></span>
      </div>
    </header>

    <div
      class="pattern-scroll"
      bind:this={viewport}
      use:measurePatternViewport
      style={patternGridStyle}
      data-window-dismiss-ignore-scroll
      role="table"
      aria-label={$t('main.patterns.patternLabel', {
        default: 'Pattern {position}',
        values: { position: formatPosition(patternIndex, song.patterns.length) }
      })}
      aria-rowcount={rowCount + 1}
      aria-colcount={channelCount + 1}
    >
      <div class="pattern-grid pattern-channel-header" role="row">
        <span class="pattern-row-heading" role="columnheader">{$t('main.patterns.rowAbbreviation', { default: 'ROW' })}</span>
        {#each channels as channel}
          <span
            class="pattern-channel-heading"
            role="columnheader"
            title={channel.name || $t('main.patterns.channelLabel', {
              default: 'Channel {number}',
              values: { number: channel.index + 1 }
            })}
          >
            <b>{$t('main.patterns.channelAbbreviation', { default: 'CH' })} {String(channel.index + 1).padStart(2, '0')}</b>
            {#if $patternViewerSettings.showChannelNames && channel.name}
              <small>{channel.name}</small>
            {/if}
          </span>
        {/each}
      </div>

      <div class="pattern-body" role="rowgroup">
        {#each pattern.rows as row, rowIndex}
          <div
            class="pattern-grid pattern-row"
            class:active={rowIndex === activeRow}
            class:beat={$patternViewerSettings.highlightBeatRows && rowIndex % 4 === 0}
            data-pattern-active-row={rowIndex === activeRow ? 'true' : undefined}
            role="row"
            aria-rowindex={rowIndex + 2}
          >
            <span class="pattern-row-number" role="rowheader">{formatPosition(rowIndex, rowCount)}</span>
            {#each channels as channel}
              {@const cell = row[channel.index] ?? ''}
              {@const parts = splitPatternCell(cell)}
              <span
                class="pattern-cell"
                class:empty={isPatternCellEmpty(cell)}
                role="cell"
                title={$t('main.patterns.cellDescription', {
                  default: 'Channel {number}: {value}',
                  values: {
                    number: channel.index + 1,
                    value: cell.trim() || $t('main.patterns.emptyCell', { default: 'empty' })
                  }
                })}
              >
                <span class="pattern-token pattern-note">{parts.note}</span>
                <span class="pattern-token pattern-instrument">{parts.instrument}</span>
                <span class="pattern-token pattern-volume">{parts.volume}</span>
                <span class="pattern-token pattern-effect">{parts.effect}</span>
              </span>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {:else if track?.kind !== 'module'}
    <div class="pattern-empty-state">
      <p>{$t('main.patterns.noModule', { default: 'Play a tracker module to view its patterns.' })}</p>
    </div>
  {:else}
    <div class="pattern-empty-state">
      <p>{$t('main.patterns.unsupported', { default: 'Pattern data is not available for this tracker module.' })}</p>
    </div>
  {/if}
</section>

<style>
  .pattern-viewer {
    position: relative;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg-base);
  }

  .pattern-empty-state {
    display: grid;
    grid-row: 1 / -1;
    place-items: center;
    min-width: 0;
    min-height: 0;
    padding: 1rem;
    color: var(--muted);
    font-size: 0.72rem;
    text-align: center;
  }

  .pattern-empty-state p {
    margin: 0;
  }

  .pattern-toolbar {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-width: 0;
    min-height: 2rem;
    padding: 0.28rem 0.64rem;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
    backdrop-filter: blur(14px);
  }

  .pattern-channel-count {
    overflow: hidden;
    color: var(--muted);
    font: 600 0.64rem/1 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.055em;
  }

  .pattern-position {
    flex: 0 0 auto;
    display: flex;
    gap: 0.62rem;
    font: 650 0.76rem/1 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  }

  .pattern-position > span {
    display: flex;
    align-items: baseline;
    gap: 0.22rem;
  }

  .pattern-position small {
    color: var(--muted);
    font: 600 0.55rem/1 inherit;
    letter-spacing: 0.06em;
  }

  .pattern-position b {
    color: var(--text-strong);
    font: inherit;
  }

  .pattern-scroll {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
  }

  .pattern-grid {
    display: grid;
    grid-template-columns: 2.8rem repeat(var(--pattern-channel-count), var(--pattern-channel-width));
    width: max-content;
    min-width: 100%;
  }

  .pattern-channel-header {
    position: sticky;
    top: 0;
    z-index: 2;
    min-height: 1.8rem;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
    backdrop-filter: blur(12px);
  }

  .pattern-row-heading,
  .pattern-channel-heading {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 0.3rem;
    border-right: 1px solid var(--border-faint);
    color: var(--muted);
    font: 650 0.62rem/1 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
    letter-spacing: 0.055em;
  }

  .pattern-row-heading {
    position: sticky;
    left: 0;
    z-index: 3;
    justify-content: center;
    background: color-mix(in srgb, var(--bg-elevated) 96%, transparent);
  }

  .pattern-channel-heading {
    gap: 0.25rem;
  }

  .pattern-channel-heading b {
    flex: 0 0 auto;
    color: color-mix(in srgb, var(--accent) 76%, var(--text));
    font: inherit;
  }

  .pattern-channel-heading small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font: 500 0.58rem/1 inherit;
  }

  .pattern-row {
    height: var(--pattern-row-height);
    min-height: 0;
  }

  .pattern-body {
    padding-block: var(--pattern-center-spacer-height);
  }

  .pattern-row-number,
  .pattern-cell {
    display: flex;
    align-items: center;
    height: var(--pattern-row-height);
    box-sizing: border-box;
    border-right: 1px solid var(--border-faint);
    border-bottom: 1px solid color-mix(in srgb, var(--border-faint) 48%, transparent);
    font: 500 var(--pattern-font-size)/1 'IBM Plex Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    font-synthesis: none;
    font-variant-ligatures: none;
    font-variant-numeric: tabular-nums;
  }

  .pattern-row-number {
    position: sticky;
    left: 0;
    z-index: 1;
    justify-content: center;
    color: color-mix(in srgb, var(--muted) 82%, transparent);
    background: color-mix(in srgb, var(--bg-base) 97%, transparent);
  }

  .pattern-cell {
    display: grid;
    grid-template-columns: 3ch 2ch 3ch minmax(3ch, 1fr);
    column-gap: 1ch;
    overflow: hidden;
    padding: 0 0.62rem;
    white-space: nowrap;
  }

  .pattern-cell.empty {
    color: color-mix(in srgb, var(--muted) 38%, transparent);
  }

  .pattern-cell.empty .pattern-token {
    color: inherit;
  }

  .pattern-token {
    overflow: hidden;
  }

  .colors-conventional .pattern-note { color: #8eafff; }
  .colors-conventional .pattern-instrument { color: #69cbcb; }
  .colors-conventional .pattern-volume { color: #72d58a; }
  .colors-conventional .pattern-effect { color: #d2d7df; }

  .colors-theme .pattern-note { color: var(--accent); }
  .colors-theme .pattern-instrument { color: color-mix(in srgb, var(--accent) 70%, var(--text-strong)); }
  .colors-theme .pattern-volume { color: color-mix(in srgb, var(--accent) 46%, var(--text-strong)); }
  .colors-theme .pattern-effect { color: color-mix(in srgb, var(--accent) 20%, var(--text)); }

  .colors-monochrome .pattern-token { color: var(--text); }

  .pattern-row.beat:not(.active) .pattern-cell,
  .pattern-row.beat:not(.active) .pattern-row-number {
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }

  .pattern-row.active .pattern-cell,
  .pattern-row.active .pattern-row-number {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-base));
  }

  .pattern-row.active .pattern-row-number {
    color: var(--accent);
  }

  @media (max-width: 520px) {
    .pattern-position {
      gap: 0.42rem;
    }
  }
</style>
