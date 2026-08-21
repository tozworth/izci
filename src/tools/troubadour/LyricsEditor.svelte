<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { formatDuration } from '$lib/utils/files';
  import {
    formatLyricsTimestamp,
    parseLyricsForEditor,
    parseLyricsTimestamp,
    serializeLyrics,
    shiftLyricsTimestamps,
    type EditableLyricLine
  } from '$lib/utils/timestamped-lyrics';

  export let value = '';
  export let currentTime = 0;
  export let duration = 0;
  export let disabled = true;
  export let playbackDisabled = true;
  export let playing = false;
  export let trackTitle = '';
  export let previewError: '' | 'unsupported' | 'decode' = '';
  export let getCurrentTime: () => number = () => currentTime;

  $: previewErrorText = previewError === 'unsupported'
    ? $t('troubadour.lyrics.previewUnsupported', { default: 'This format has no in-window preview player.' })
    : previewError === 'decode'
      ? $t('troubadour.lyrics.previewDecode', { default: 'This track cannot be previewed.' })
      : '';

  const dispatch = createEventDispatcher<{
    change: string;
    togglePlayback: void;
    seek: number;
  }>();

  let editorElement: HTMLDivElement;
  let lines: EditableLyricLine[] = parseLyricsForEditor(value);
  let selectedIndex = 0;
  let lastValue = value;

  $: if (value !== lastValue) {
    lines = parseLyricsForEditor(value);
    selectedIndex = Math.min(selectedIndex, lines.length - 1);
    lastValue = value;
  }

  $: timedCount = lines.filter((line) => line.time !== null).length;
  $: activeIndex = findActiveIndex(lines, currentTime);
  $: rangeProgressStyle = toRangeProgressStyle(currentTime, Math.max(duration, 1));

  function toRangeProgressStyle(value: number, max: number): string {
    const percent = max > 0 ? Math.max(0, Math.min((value / max) * 100, 100)) : 0;
    const thumbCenterOffset = 0.62 * (0.5 - percent / 100);
    const sign = thumbCenterOffset < 0 ? '-' : '+';
    const fillEnd = percent >= 100
      ? '100%'
      : percent <= 0 ? '0px' : `calc(${percent}% ${sign} ${Math.abs(thumbCenterOffset).toFixed(4)}rem)`;
    return `--player-range-progress: ${percent}%; --player-range-fill-end: ${fillEnd};`;
  }

  function findActiveIndex(nextLines: EditableLyricLine[], time: number): number {
    let found = -1;
    let foundTime = -1;
    for (let index = 0; index < nextLines.length; index += 1) {
      const lineTime = nextLines[index].time;
      if (lineTime !== null && lineTime <= time && lineTime >= foundTime) {
        found = index;
        foundTime = lineTime;
      }
    }
    return found;
  }

  function commit(nextLines: EditableLyricLine[]): void {
    lines = nextLines;
    lastValue = serializeLyrics(nextLines);
    dispatch('change', lastValue);
  }

  function updateLine(index: number, patch: Partial<EditableLyricLine>): void {
    commit(lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  async function focusLine(index: number): Promise<void> {
    selectedIndex = Math.max(0, Math.min(index, lines.length - 1));
    await tick();
    const input = editorElement?.querySelector<HTMLInputElement>(`[data-line-index="${selectedIndex}"] .lyric-text-input`);
    input?.focus();
    input?.select();
    input?.scrollIntoView({ block: 'nearest' });
  }

  function stamp(step: boolean): void {
    if (disabled || selectedIndex < 0) return;
    const time = Math.max(0, Math.min(getCurrentTime(), duration || Number.POSITIVE_INFINITY));
    const nextLines = lines.map((line, index) => index === selectedIndex ? { ...line, time } : line);
    if (step && selectedIndex === nextLines.length - 1) nextLines.push({ time: null, text: '' });
    commit(nextLines);
    if (step) void focusLine(selectedIndex + 1);
  }

  function insertLine(afterIndex = selectedIndex): void {
    const nextLines = [...lines];
    nextLines.splice(afterIndex + 1, 0, { time: null, text: '' });
    commit(nextLines);
    void focusLine(afterIndex + 1);
  }

  function deleteLine(): void {
    if (lines.length <= 1) {
      commit([{ time: null, text: '' }]);
      selectedIndex = 0;
      return;
    }
    const nextLines = lines.filter((_, index) => index !== selectedIndex);
    commit(nextLines);
    void focusLine(Math.min(selectedIndex, nextLines.length - 1));
  }

  function sortLines(): void {
    const indexed = lines.map((line, index) => ({ line, index }));
    indexed.sort((left, right) => {
      if (left.line.time === null && right.line.time === null) return left.index - right.index;
      if (left.line.time === null) return 1;
      if (right.line.time === null) return -1;
      return left.line.time - right.line.time || left.index - right.index;
    });
    commit(indexed.map(({ line }) => line));
    selectedIndex = 0;
  }

  function shiftTimestamps(offsetSeconds: number): void {
    commit(shiftLyricsTimestamps(lines, offsetSeconds));
  }

  function handleTimestampChange(index: number, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    if (!input.value.trim()) {
      updateLine(index, { time: null });
      return;
    }
    const parsed = parseLyricsTimestamp(input.value);
    if (parsed === null) {
      input.value = lines[index].time === null ? '' : formatLyricsTimestamp(lines[index].time!);
      return;
    }
    updateLine(index, { time: Math.min(parsed, duration || Number.POSITIVE_INFINITY) });
  }

  function handleTextKeydown(index: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) stamp(true);
    else insertLine(index);
  }

  function selectAndSeek(index: number): void {
    selectedIndex = index;
    const time = lines[index]?.time;
    if (time !== null && time !== undefined) dispatch('seek', time);
  }
</script>

<section class="lyrics-workbench" aria-label={$t('troubadour.lyrics.tab', { default: 'Lyrics' })}>
  <div class="tool-row tool-toolbar lyrics-toolbar" role="toolbar" aria-label={$t('troubadour.lyrics.toolbar', { default: 'Lyrics tools' })}>
    <button class="text-button primary stamp-step-button hover-tooltip-anchor" type="button" disabled={disabled} on:click={() => stamp(true)}>
      <span class="material-symbols-outlined" aria-hidden="true">more_time</span>{$t('troubadour.lyrics.stampAndStep', { default: 'Stamp and step' })}
      <HoverTooltip>{$t('troubadour.lyrics.stampAndStepShortcut', { default: 'Stamp and step (Ctrl+Enter)' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('troubadour.lyrics.stamp', { default: 'Stamp selected line' })} on:click={() => stamp(false)}>
      <span class="material-symbols-outlined" aria-hidden="true">timer</span><HoverTooltip>{$t('troubadour.lyrics.stamp', { default: 'Stamp selected line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || lines[selectedIndex]?.time === null} aria-label={$t('troubadour.lyrics.clearStamp', { default: 'Clear timestamp' })} on:click={() => updateLine(selectedIndex, { time: null })}>
      <span class="material-symbols-outlined" aria-hidden="true">timer_off</span><HoverTooltip>{$t('troubadour.lyrics.clearStamp', { default: 'Clear timestamp' })}</HoverTooltip>
    </button>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('troubadour.lyrics.addLine', { default: 'Add line' })} on:click={() => insertLine()}>
      <span class="material-symbols-outlined" aria-hidden="true">add_to_queue</span><HoverTooltip>{$t('troubadour.lyrics.addLine', { default: 'Add line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('troubadour.lyrics.deleteLine', { default: 'Delete line' })} on:click={deleteLine}>
      <span class="material-symbols-outlined" aria-hidden="true">delete</span><HoverTooltip>{$t('troubadour.lyrics.deleteLine', { default: 'Delete line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || timedCount < 2} aria-label={$t('troubadour.lyrics.sort', { default: 'Sort by timestamp' })} on:click={sortLines}>
      <span class="material-symbols-outlined" aria-hidden="true">sort</span><HoverTooltip>{$t('troubadour.lyrics.sort', { default: 'Sort by timestamp' })}</HoverTooltip>
    </button>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="icon-button timestamp-shift-button hover-tooltip-anchor" type="button" disabled={disabled || timedCount === 0} aria-label={$t('troubadour.lyrics.shiftEarlier', { default: 'Shift every timestamp 0.1 seconds earlier' })} on:click={() => shiftTimestamps(-0.1)}>
      <span class="material-symbols-outlined" aria-hidden="true">keyboard_double_arrow_left</span><HoverTooltip>{$t('troubadour.lyrics.shiftEarlier', { default: 'Shift every timestamp 0.1 seconds earlier' })}</HoverTooltip>
    </button>
    <button class="icon-button timestamp-shift-button hover-tooltip-anchor" type="button" disabled={disabled || timedCount === 0} aria-label={$t('troubadour.lyrics.shiftLater', { default: 'Shift every timestamp 0.1 seconds later' })} on:click={() => shiftTimestamps(0.1)}>
      <span class="material-symbols-outlined" aria-hidden="true">keyboard_double_arrow_right</span><HoverTooltip>{$t('troubadour.lyrics.shiftLater', { default: 'Shift every timestamp 0.1 seconds later' })}</HoverTooltip>
    </button>
    <div class="toolbar-spacer"></div>
    <span class="lyrics-count">{$t('troubadour.lyrics.stampedCount', { default: '{stamped}/{total} stamped', values: { stamped: timedCount, total: lines.length } })}</span>
  </div>

  <div bind:this={editorElement} class="lyrics-editor" class:is-disabled={disabled} role="grid" aria-label={$t('troubadour.lyrics.editor', { default: 'Timestamped lyrics editor' })}>
    <div class="lyrics-grid-header" role="row">
      <span role="columnheader">#</span>
      <span role="columnheader">{$t('troubadour.lyrics.timestamp', { default: 'Timestamp' })}</span>
      <span role="columnheader">{$t('troubadour.lyrics.line', { default: 'Lyric line' })}</span>
    </div>
    {#each lines as line, index}
      <div class="lyric-editor-row" class:selected={selectedIndex === index} class:active={activeIndex === index} data-line-index={index} role="row">
        <button class="line-number" type="button" disabled={disabled} aria-label={line.time === null ? $t('troubadour.lyrics.selectLine', { default: 'Select line {number}', values: { number: index + 1 } }) : $t('troubadour.lyrics.seekToLine', { default: 'Seek to line {number}', values: { number: index + 1 } })} on:click={() => selectAndSeek(index)}>{index + 1}</button>
        <input class="lyric-time-input" type="text" inputmode="decimal" value={line.time === null ? '' : formatLyricsTimestamp(line.time)} placeholder="--:--.---" disabled={disabled} aria-label={$t('troubadour.lyrics.timestampForLine', { default: 'Timestamp for line {number}', values: { number: index + 1 } })} on:focus={() => (selectedIndex = index)} on:change={(event) => handleTimestampChange(index, event)} />
        <input class="lyric-text-input" type="text" value={line.text} placeholder={$t('troubadour.lyrics.linePlaceholder', { default: 'Enter lyric line' })} disabled={disabled} aria-label={$t('troubadour.lyrics.textForLine', { default: 'Lyrics for line {number}', values: { number: index + 1 } })} on:focus={() => (selectedIndex = index)} on:input={(event) => updateLine(index, { text: event.currentTarget.value })} on:keydown={(event) => handleTextKeydown(index, event)} />
      </div>
    {/each}
  </div>

  <div class="lyrics-player-bar player-bar compact-player-bar">
    <div class="player-track-group">
      <div class="player-track">
        <strong>{trackTitle || $t('troubadour.lyrics.noTrack', { default: 'Select one track' })}</strong>
        <span>{previewErrorText || $t('troubadour.lyrics.stampedCount', { default: '{stamped}/{total} stamped', values: { stamped: timedCount, total: lines.length } })}</span>
      </div>
    </div>
    <div class="player-range">
      <span>{formatDuration(currentTime)}</span>
      <div class="range-control" style={rangeProgressStyle}>
        <span class="range-control-fill" aria-hidden="true"></span>
        <input type="range" min="0" max={Math.max(duration, 0.001)} step="0.001" value={Math.min(currentTime, duration)} disabled={disabled || playbackDisabled} aria-label={$t('troubadour.lyrics.position', { default: 'Playback position' })} on:input={(event) => dispatch('seek', Number(event.currentTarget.value))} />
      </div>
      <span>{formatDuration(duration)}</span>
    </div>
    <div class="player-control-strip">
      <div class="player-actions">
        <button class="transport-button" type="button" disabled={disabled || playbackDisabled} aria-label={$t('troubadour.lyrics.backFive', { default: 'Back 5 seconds' })} on:click={() => dispatch('seek', Math.max(0, getCurrentTime() - 5))}>
          <span class="material-symbols-outlined" aria-hidden="true">replay_5</span>
        </button>
        <button class="transport-button transport-button-primary" type="button" disabled={disabled || playbackDisabled} aria-label={playing ? $t('troubadour.lyrics.pause', { default: 'Pause' }) : $t('troubadour.lyrics.play', { default: 'Play' })} on:click={() => dispatch('togglePlayback')}>
          <span class="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
        </button>
        <button class="transport-button" type="button" disabled={disabled || playbackDisabled} aria-label={$t('troubadour.lyrics.forwardFive', { default: 'Forward 5 seconds' })} on:click={() => dispatch('seek', Math.min(duration, getCurrentTime() + 5))}>
          <span class="material-symbols-outlined" aria-hidden="true">forward_5</span>
        </button>
      </div>
    </div>
  </div>
</section>
