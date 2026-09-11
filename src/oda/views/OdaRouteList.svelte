<script lang="ts">
  import { onMount } from 'svelte';
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
    const index = rows.findIndex((row) => row.focusId === id);
    if (index < 0) return;
    const top = index * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < viewport.scrollTop) {
      viewport.scrollTop = top;
    } else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight;
    }
  }

  function handleAction(rowFocusId: string, action: () => void): void {
    onFocus(rowFocusId);
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
        style={`top: ${index * ROW_HEIGHT}px; height: ${ROW_HEIGHT}px`}
      >
        <button
          type="button"
          class="oda-row"
          class:is-focused={focusId === row.focusId}
          class:is-playing={row.playing}
          on:click={() => { onFocus(row.focusId); onActivate(row.focusId); }}
        >
          <span class="oda-row-main">
            <span class="oda-row-title">
              {row.title}
              {#if row.playing}
                <span class="material-symbols-outlined oda-row-playing" aria-hidden="true">graphic_eq</span>
              {/if}
            </span>
            {#if row.meta}<span class="oda-row-meta">{row.meta}</span>{/if}
          </span>
          {#if row.trailing}<span class="oda-row-trailing">{row.trailing}</span>{/if}
        </button>
        {#if canRemove || canMove}
          <span class="oda-row-actions">
            {#if canMove}
              <button
                type="button"
                class="oda-row-action"
                title={translate('oda.queue.moveUp', 'Move up')}
                on:click={() => handleAction(row.focusId, () => onMove(row.focusId, -1))}
              >
                <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_up</span>
              </button>
              <button
                type="button"
                class="oda-row-action"
                title={translate('oda.queue.moveDown', 'Move down')}
                on:click={() => handleAction(row.focusId, () => onMove(row.focusId, 1))}
              >
                <span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>
              </button>
            {/if}
            {#if canRemove}
              <button
                type="button"
                class="oda-row-action"
                title={translate('oda.nowPlaying.remove', 'Remove from queue')}
                on:click={() => handleAction(row.focusId, () => onRemove(row.focusId))}
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
