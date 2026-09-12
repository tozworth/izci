<script lang="ts">
  import { onMount } from 'svelte';
  import { odaBrowseTrackId, odaTrackFocusId } from '../oda-browse';
  import {
    odaNowPlayingQueueActionFocusId,
    parseOdaNowPlayingQueueActionFocusId,
    resolveOdaNowPlayingQueueActionIds,
    type OdaNowPlayingQueueAction
  } from '../oda-now-playing';
  import type { OdaDisplayRow } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';

  export let rows: OdaDisplayRow[] = [];
  export let focusId: string | null = null;
  /** Changing this resets the scroll position (route/level change). */
  export let listKey = '';
  export let canRemove = false;
  export let canMove = false;
  export let translate: OdaTranslate;
  export let onActivate: (focusId: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};
  export let onRemove: (focusId: string) => void = () => {};
  export let onMove: (focusId: string, direction: -1 | 1) => void = () => {};

  const ROW_HEIGHT = 72;
  const OVERSCAN = 5;

  let viewport: HTMLDivElement | null = null;
  let scrollTop = 0;
  let viewportHeight = 0;
  let lastListKey = '';

  $: totalHeight = rows.length * ROW_HEIGHT;
  $: startIndex = rows.length === 0 ? 0 : Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  $: endIndex = rows.length === 0
    ? 0
    : Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
  $: visibleRows = rows
    .slice(startIndex, endIndex)
    .map((row, offset) => ({ row, index: startIndex + offset }));

  function handleScroll(event: Event): void {
    scrollTop = (event.currentTarget as HTMLElement).scrollTop;
  }

  function measure(): void {
    if (viewport) viewportHeight = viewport.clientHeight;
  }

  function ensureFocusVisible(id: string | null): void {
    if (!viewport || !id) return;
    const queueAction = parseOdaNowPlayingQueueActionFocusId(id);
    const rowFocusId = queueAction ? odaTrackFocusId(queueAction.trackId) : id;
    const index = rows.findIndex((row) => row.focusId === rowFocusId);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight;
    }
  }

  function queueActionFocusId(rowFocusId: string, action: OdaNowPlayingQueueAction): string {
    const trackId = odaBrowseTrackId(rowFocusId) ?? rowFocusId;
    return odaNowPlayingQueueActionFocusId(trackId, action);
  }

  function queueActionIds(rowFocusId: string): string[] {
    const trackId = odaBrowseTrackId(rowFocusId) ?? rowFocusId;
    return resolveOdaNowPlayingQueueActionIds(trackId, canMove, canRemove);
  }

  function actionStripOpen(rowFocusId: string): boolean {
    return focusId !== null && queueActionIds(rowFocusId).includes(focusId);
  }

  function handleAction(actionFocusId: string, action: () => void): void {
    onFocus(actionFocusId);
    action();
  }

  $: if (listKey !== lastListKey) {
    lastListKey = listKey;
    if (viewport) viewport.scrollTop = 0;
    scrollTop = 0;
  }

  // Keep the focused row on screen after route changes, item updates, or
  // arrow movement without recomputing geometry from the DOM.
  $: if (viewport && focusId && rows.length > 0) {
    void startIndex;
    void endIndex;
    ensureFocusVisible(focusId);
  }

  onMount(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !viewport) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    return () => observer.disconnect();
  });
</script>

<div class="oda-list-viewport" bind:this={viewport} on:scroll={handleScroll}>
  <div class="oda-list-inner" style={`height: ${totalHeight}px`}>
    {#each visibleRows as { row, index } (row.focusId)}
      <div
        class="oda-row-slot"
        class:is-action-open={actionStripOpen(row.focusId)}
        style={`top: ${index * ROW_HEIGHT}px; height: ${ROW_HEIGHT}px`}
      >
        <button
          type="button"
          class="oda-row"
          class:is-focused={focusId === row.focusId}
          class:is-playing={row.playing}
          class:is-action-parent={actionStripOpen(row.focusId)}
          aria-current={row.playing ? 'true' : undefined}
          on:click={() => { onFocus(row.focusId); onActivate(row.focusId); }}
        >
          <span class="oda-row-main">
            <span class="oda-row-title">{row.title}</span>
            {#if row.meta}<span class="oda-row-meta">{row.meta}</span>{/if}
          </span>
          <span class="oda-row-end">
            {#if row.trailing}<span class="oda-row-trailing">{row.trailing}</span>{/if}
            {#if canRemove || canMove}
              <span class="material-symbols-outlined oda-row-action-chevron" aria-hidden="true">chevron_right</span>
            {/if}
          </span>
        </button>
        {#if canRemove || canMove}
          <span class="oda-row-actions">
            {#if canMove}
              <button
                type="button"
                class="oda-row-action"
                class:is-focused={focusId === queueActionFocusId(row.focusId, 'move-up')}
                title={translate('oda.queue.moveUp', 'Move up')}
                aria-label={translate('oda.queue.moveUp', 'Move up')}
                on:click={() => handleAction(queueActionFocusId(row.focusId, 'move-up'), () => onMove(row.focusId, -1))}
              >
                <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>
              </button>
              <button
                type="button"
                class="oda-row-action"
                class:is-focused={focusId === queueActionFocusId(row.focusId, 'move-down')}
                title={translate('oda.queue.moveDown', 'Move down')}
                aria-label={translate('oda.queue.moveDown', 'Move down')}
                on:click={() => handleAction(queueActionFocusId(row.focusId, 'move-down'), () => onMove(row.focusId, 1))}
              >
                <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
              </button>
            {/if}
            {#if canRemove}
              <button
                type="button"
                class="oda-row-action"
                class:is-focused={focusId === queueActionFocusId(row.focusId, 'remove')}
                title={translate('oda.nowPlaying.remove', 'Remove from queue')}
                aria-label={translate('oda.nowPlaying.remove', 'Remove from queue')}
                on:click={() => handleAction(queueActionFocusId(row.focusId, 'remove'), () => onRemove(row.focusId))}
              >
                <span class="material-symbols-outlined" aria-hidden="true">close</span>
              </button>
            {/if}
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>
