<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import {
    formatLyricsTimestamp,
    parseLyricsForEditor,
    parseLyricsTimestamp,
    serializeLyrics,
    type EditableLyricLine
  } from './lyrics-editor';

  export let value = '';
  export let currentTime = 0;
  export let duration = 0;
  export let disabled = true;
  export let playing = false;
  export let getCurrentTime: () => number = () => currentTime;

  const dispatch = createEventDispatcher<{
    change: string;
    togglePlayback: void;
    seek: number;
    save: void;
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

  function nudge(seconds: number): void {
    const line = lines[selectedIndex];
    if (!line || line.time === null) return;
    updateLine(selectedIndex, { time: Math.max(0, Math.min(line.time + seconds, duration || Number.POSITIVE_INFINITY)) });
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
</script>

<section class="lyrics-workbench" aria-label={$t('clipTag.tabs.lyrics', { default: 'Lyrics' })}>
  <div class="tool-row lyrics-toolbar" role="toolbar" aria-label={$t('clipTag.lyrics.toolbar', { default: 'Lyrics tools' })}>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('clipTag.lyrics.backFive', { default: 'Back 5 seconds' })} on:click={() => dispatch('seek', Math.max(0, getCurrentTime() - 5))}>
      <span class="material-symbols-outlined" aria-hidden="true">replay_5</span><HoverTooltip>{$t('clipTag.lyrics.backFive', { default: 'Back 5 seconds' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" class:is-active={playing} type="button" disabled={disabled} aria-label={playing ? $t('clipTag.lyrics.pause', { default: 'Pause' }) : $t('clipTag.lyrics.play', { default: 'Play' })} on:click={() => dispatch('togglePlayback')}>
      <span class="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span><HoverTooltip>{playing ? $t('clipTag.lyrics.pause', { default: 'Pause' }) : $t('clipTag.lyrics.play', { default: 'Play' })}</HoverTooltip>
    </button>
    <span class="lyrics-clock" aria-live="off">{formatLyricsTimestamp(currentTime)}</span>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="text-button primary stamp-step-button" type="button" disabled={disabled} on:click={() => stamp(true)}>
      <span class="material-symbols-outlined" aria-hidden="true">more_time</span>{$t('clipTag.lyrics.stampAndStep', { default: 'Stamp and step' })}<kbd>Ctrl+Enter</kbd>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('clipTag.lyrics.stamp', { default: 'Stamp selected line' })} on:click={() => stamp(false)}>
      <span class="material-symbols-outlined" aria-hidden="true">timer</span><HoverTooltip>{$t('clipTag.lyrics.stamp', { default: 'Stamp selected line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || lines[selectedIndex]?.time === null} aria-label={$t('clipTag.lyrics.clearStamp', { default: 'Clear timestamp' })} on:click={() => updateLine(selectedIndex, { time: null })}>
      <span class="material-symbols-outlined" aria-hidden="true">timer_off</span><HoverTooltip>{$t('clipTag.lyrics.clearStamp', { default: 'Clear timestamp' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || lines[selectedIndex]?.time === null} aria-label={$t('clipTag.lyrics.earlier', { default: 'Move timestamp 0.1 seconds earlier' })} on:click={() => nudge(-0.1)}>
      <span class="material-symbols-outlined" aria-hidden="true">remove</span><HoverTooltip>{$t('clipTag.lyrics.earlier', { default: 'Move timestamp 0.1 seconds earlier' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || lines[selectedIndex]?.time === null} aria-label={$t('clipTag.lyrics.later', { default: 'Move timestamp 0.1 seconds later' })} on:click={() => nudge(0.1)}>
      <span class="material-symbols-outlined" aria-hidden="true">add</span><HoverTooltip>{$t('clipTag.lyrics.later', { default: 'Move timestamp 0.1 seconds later' })}</HoverTooltip>
    </button>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('clipTag.lyrics.addLine', { default: 'Add line' })} on:click={() => insertLine()}>
      <span class="material-symbols-outlined" aria-hidden="true">playlist_add</span><HoverTooltip>{$t('clipTag.lyrics.addLine', { default: 'Add line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled} aria-label={$t('clipTag.lyrics.deleteLine', { default: 'Delete line' })} on:click={deleteLine}>
      <span class="material-symbols-outlined" aria-hidden="true">delete</span><HoverTooltip>{$t('clipTag.lyrics.deleteLine', { default: 'Delete line' })}</HoverTooltip>
    </button>
    <button class="icon-button hover-tooltip-anchor" type="button" disabled={disabled || timedCount < 2} aria-label={$t('clipTag.lyrics.sort', { default: 'Sort by timestamp' })} on:click={sortLines}>
      <span class="material-symbols-outlined" aria-hidden="true">sort</span><HoverTooltip>{$t('clipTag.lyrics.sort', { default: 'Sort by timestamp' })}</HoverTooltip>
    </button>
    <div class="toolbar-spacer"></div>
    <span class="lyrics-count">{$t('clipTag.lyrics.stampedCount', { default: '{stamped}/{total} stamped', values: { stamped: timedCount, total: lines.length } })}</span>
    <button class="text-button" type="button" disabled={disabled} on:click={() => dispatch('save')}><span class="material-symbols-outlined" aria-hidden="true">new_label</span>{$t('clipTag.menu.saveTags', { default: 'Save tagged copy...' })}</button>
  </div>

  <div bind:this={editorElement} class="lyrics-editor" class:is-disabled={disabled} role="grid" aria-label={$t('clipTag.lyrics.editor', { default: 'Timestamped lyrics editor' })}>
    <div class="lyrics-grid-header" role="row">
      <span role="columnheader">#</span>
      <span role="columnheader">{$t('clipTag.lyrics.timestamp', { default: 'Timestamp' })}</span>
      <span role="columnheader">{$t('clipTag.lyrics.line', { default: 'Lyric line' })}</span>
    </div>
    {#each lines as line, index}
      <div class="lyric-editor-row" class:selected={selectedIndex === index} class:active={activeIndex === index} data-line-index={index} role="row">
        <button class="line-number" type="button" disabled={disabled} aria-label={$t('clipTag.lyrics.selectLine', { default: 'Select line {number}', values: { number: index + 1 } })} on:click={() => void focusLine(index)}>{index + 1}</button>
        <input class="lyric-time-input" type="text" inputmode="decimal" value={line.time === null ? '' : formatLyricsTimestamp(line.time)} placeholder="--:--.---" disabled={disabled} aria-label={$t('clipTag.lyrics.timestampForLine', { default: 'Timestamp for line {number}', values: { number: index + 1 } })} on:focus={() => (selectedIndex = index)} on:change={(event) => handleTimestampChange(index, event)} />
        <input class="lyric-text-input" type="text" value={line.text} placeholder={$t('clipTag.lyrics.linePlaceholder', { default: 'Enter lyric line' })} disabled={disabled} aria-label={$t('clipTag.lyrics.textForLine', { default: 'Lyrics for line {number}', values: { number: index + 1 } })} on:focus={() => (selectedIndex = index)} on:input={(event) => updateLine(index, { text: event.currentTarget.value })} on:keydown={(event) => handleTextKeydown(index, event)} />
      </div>
    {/each}
  </div>

  <div class="lyrics-transport">
    <span>{formatLyricsTimestamp(currentTime)}</span>
    <input type="range" min="0" max={Math.max(duration, 0.001)} step="0.001" value={Math.min(currentTime, duration)} disabled={disabled} aria-label={$t('clipTag.lyrics.position', { default: 'Playback position' })} on:change={(event) => dispatch('seek', Number(event.currentTarget.value))} />
    <span>{formatLyricsTimestamp(duration)}</span>
    <span class="lyrics-hint">{$t('clipTag.lyrics.hint', { default: 'Select a line, start playback, then stamp each line as it begins.' })}</span>
  </div>
</section>
