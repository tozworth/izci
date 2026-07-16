<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { isPatternCellEmpty, splitPatternCell } from '$lib/services/pattern-presentation';
  import { patternViewerSettings } from '$lib/stores/pattern-viewer-settings';
  import type { ModulePatternSnapshot, PlaybackSnapshot, PlaylistItem } from '$lib/types';

  export let track: PlaylistItem | null = null;
  export let snapshot: ModulePatternSnapshot;
  export let playbackSnapshot: PlaybackSnapshot | null = null;

  let viewport: HTMLDivElement | null = null;
  let lastFollowKey = '';
  let followFrame = 0;

  $: isCurrentModule = track?.kind === 'module' && snapshot.trackId === track.id;
  $: song = isCurrentModule ? snapshot.song : null;
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
  $: followKey = `${snapshot.trackId ?? ''}:${snapshot.order}:${patternIndex}:${activeRow}`;
  $: patternGridStyle = [
    `--pattern-channel-count: ${Math.max(channelCount, 1)}`,
    `--pattern-font-size: ${$patternViewerSettings.fontSize}px`,
    `--pattern-row-height: ${$patternViewerSettings.rowHeight}px`,
    `--pattern-channel-width: ${$patternViewerSettings.channelWidth}px`
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

  async function centerActiveRow(): Promise<void> {
    await tick();
    window.cancelAnimationFrame(followFrame);
    followFrame = window.requestAnimationFrame(() => {
      const activeRowElement = viewport?.querySelector<HTMLElement>('[data-pattern-active-row="true"]');

      if (!viewport || !activeRowElement) {
        return;
      }

      const top = Math.max(
        activeRowElement.offsetTop - (viewport.clientHeight - activeRowElement.offsetHeight) / 2,
        0
      );
      viewport.scrollTo({
        top,
        behavior:
          $patternViewerSettings.smoothScroll && playbackSnapshot?.state === 'playing'
            ? 'smooth'
            : 'auto'
      });
    });
  }

  onDestroy(() => {
    window.cancelAnimationFrame(followFrame);
  });
</script>

<section class="pattern-viewer colors-{$patternViewerSettings.colorScheme}" aria-label="Module patterns">
  {#if track?.kind === 'module' && song && pattern}
    <header class="pattern-toolbar">
      <span class="pattern-channel-count">{channelCount} channels</span>

      <div class="pattern-position" aria-label="Pattern playback position">
        <span><small>ORD</small><b>{formatPosition(snapshot.order, orderCount)}</b></span>
        <span><small>PAT</small><b>{formatPosition(patternIndex, song.patterns.length)}</b></span>
        <span><small>ROW</small><b>{formatPosition(activeRow, rowCount)}</b></span>
      </div>
    </header>

    <div
      class="pattern-scroll"
      bind:this={viewport}
      style={patternGridStyle}
      data-window-dismiss-ignore-scroll
      role="table"
      aria-label={`Pattern ${formatPosition(patternIndex, song.patterns.length)}`}
      aria-rowcount={rowCount + 1}
      aria-colcount={channelCount + 1}
    >
      <div class="pattern-grid pattern-channel-header" role="row">
        <span class="pattern-row-heading" role="columnheader">ROW</span>
        {#each channels as channel}
          <span class="pattern-channel-heading" role="columnheader" title={channel.name || `Channel ${channel.index + 1}`}>
            <b>CH {String(channel.index + 1).padStart(2, '0')}</b>
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
                title={`Channel ${channel.index + 1}: ${cell.trim() || 'empty'}`}
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
    background:
      radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 44%),
      color-mix(in srgb, var(--bg-base) 93%, transparent);
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
    scrollbar-color: color-mix(in srgb, var(--accent) 40%, var(--border-soft)) transparent;
  }

  .pattern-grid {
    display: grid;
    grid-template-columns: 3.35rem repeat(var(--pattern-channel-count), var(--pattern-channel-width));
    width: max-content;
    min-width: 100%;
  }

  .pattern-channel-header {
    position: sticky;
    top: 0;
    z-index: 2;
    min-height: 2.35rem;
    border-bottom: 1px solid var(--border-soft);
    background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
    backdrop-filter: blur(12px);
  }

  .pattern-row-heading,
  .pattern-channel-heading {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0 0.55rem;
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
    gap: 0.4rem;
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
    min-height: var(--pattern-row-height);
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
    font-variant-ligatures: none;
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
    background-color: color-mix(in srgb, var(--accent) 3.5%, transparent);
  }

  .pattern-row.active .pattern-cell,
  .pattern-row.active .pattern-row-number {
    border-bottom-color: color-mix(in srgb, var(--accent) 44%, transparent);
    color: var(--text);
    background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 17%, var(--bg-elevated)), color-mix(in srgb, var(--accent) 8%, var(--bg-base)));
    box-shadow: inset 0 1px color-mix(in srgb, var(--accent) 22%, transparent), inset 0 -1px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .pattern-row.active .pattern-row-number {
    color: var(--accent);
    font-weight: 750;
  }

  @media (max-width: 520px) {
    .pattern-position {
      gap: 0.42rem;
    }
  }
</style>
