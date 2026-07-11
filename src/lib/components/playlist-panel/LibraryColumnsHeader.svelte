<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { LibraryColumnId, LibraryViewSortState } from '$lib/types';
  import type { ColumnDropIndicator, LibraryPanelColumn } from './library-columns';
  import { isRightAlignedColumn } from './library-columns';

  export let visibleColumns: LibraryPanelColumn[] = [];
  export let activeSort: LibraryViewSortState;
  export let tableTemplateColumns = '';
  export let tableColumnGap = '4px';
  export let dropIndicator: ColumnDropIndicator | null = null;
  export let draggedColumnId: LibraryColumnId | null = null;
  export let resizingColumnId: LibraryColumnId | null = null;
  export let headerElement: HTMLDivElement | null = null;

  const dispatch = createEventDispatcher<{
    sort: LibraryColumnId;
    contextMenu: MouseEvent;
    columnPointerDown: { event: PointerEvent; columnId: LibraryColumnId };
    resizeStart: { event: PointerEvent; columnId: LibraryColumnId };
  }>();
</script>

<div
  bind:this={headerElement}
  class="track-columns-header"
  class:is-dragging={Boolean(draggedColumnId)}
  role="row"
  style={`--track-table-columns: ${tableTemplateColumns}; --track-table-gap: ${tableColumnGap};`}
>
  {#each visibleColumns as column}
    <div
      class="track-column-header"
      class:is-sorted={activeSort.columnId === column.id}
      class:is-dragged={draggedColumnId === column.id}
      class:is-resizing={resizingColumnId === column.id}
      class:is-right-aligned={isRightAlignedColumn(column.id)}
      class:drop-before={dropIndicator?.columnId === column.id && dropIndicator.position === 'before'}
      class:drop-after={dropIndicator?.columnId === column.id && dropIndicator.position === 'after'}
      data-library-column-id={column.id}
      role="columnheader"
      tabindex="-1"
      aria-sort={
        activeSort.columnId === column.id
          ? activeSort.direction === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
      on:pointerdown={(event) => dispatch('columnPointerDown', { event, columnId: column.id })}
      on:contextmenu={(event) => dispatch('contextMenu', event)}
    >
      <button
        type="button"
        class="track-column-sort-button"
        class:is-sorted={activeSort.columnId === column.id}
        class:is-right-aligned={isRightAlignedColumn(column.id)}
        title={`Sort by ${column.label}`}
        on:click={() => dispatch('sort', column.id)}
      >
        <span class="track-column-sort-content" class:is-right-aligned={isRightAlignedColumn(column.id)}>
          <span class="track-column-label">{column.label}</span>
          {#if activeSort.columnId === column.id}
            <span class="material-symbols-outlined track-column-sort-icon" aria-hidden="true">
              {activeSort.direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
            </span>
          {/if}
        </span>
      </button>
      <button
        type="button"
        class="track-column-resizer"
        aria-label={`Resize ${column.label} column`}
        title={`Resize ${column.label} column`}
        on:pointerdown={(event) => dispatch('resizeStart', { event, columnId: column.id })}
      ></button>
    </div>
  {/each}
</div>

<style>
  .track-columns-header {
    display: grid;
    grid-template-columns: var(--track-table-columns);
    column-gap: var(--track-table-gap);
    width: 100%;
    margin-inline: -0.25rem;
    padding: 0.02rem 0 0;
  }

  .track-column-header {
    position: relative;
    min-width: 0;
    min-height: 1.45rem;
    display: flex;
    align-items: stretch;
    border: 0;
    border-radius: 4px;
    background: transparent;
    overflow: visible;
    cursor: grab;
    transition:
      background-color var(--artwork-ui-transition-duration, 280ms) linear,
      opacity var(--artwork-ui-transition-duration, 280ms) linear;
  }

  .track-columns-header.is-dragging .track-column-header {
    cursor: grabbing;
  }

  .track-column-header.is-dragged {
    background: var(--accent-strong-faint);
    opacity: 0.58;
  }

  .track-column-header.drop-before::before,
  .track-column-header.drop-after::after {
    content: "";
    position: absolute;
    top: -0.16rem;
    bottom: -0.16rem;
    width: 3px;
    border-radius: 999px;
    background: var(--accent-strong);
    box-shadow: 0 0 0 3px var(--accent-strong-faint);
    z-index: 4;
  }

  .track-column-header.drop-before::before {
    left: calc(var(--track-table-gap) / -2 - 1px);
  }

  .track-column-header.drop-after::after {
    right: calc(var(--track-table-gap) / -2 - 1px);
  }

  .track-column-sort-button {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0.16rem 0.3rem 0.14rem;
    color: var(--muted);
    background: transparent;
    text-align: left;
    border: 0;
    border-radius: 4px;
    user-select: none;
    transition: color var(--artwork-ui-transition-duration, 280ms) linear;
  }

  .track-column-sort-button.is-right-aligned {
    text-align: left;
  }

  .track-column-header.is-sorted .track-column-sort-button,
  .track-column-sort-button:hover {
    color: var(--text);
  }

  .track-column-sort-button:hover {
    background: var(--hover-subtle);
  }

  .track-column-sort-content {
    display: block;
    min-width: 0;
    max-width: 100%;
    width: 100%;
  }

  .track-column-sort-content.is-right-aligned {
    text-align: right;
  }

  .track-column-label {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.7rem;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .track-column-sort-icon {
    position: absolute;
    right: 0.32rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.9rem;
    flex-shrink: 0;
    pointer-events: none;
  }

  .track-column-sort-button.is-sorted .track-column-label {
    padding-right: 0.9rem;
  }

  .track-column-resizer {
    position: absolute;
    top: -1px;
    right: calc(var(--track-table-gap) / -2 - 4px);
    width: 12px;
    height: 100%;
    min-height: calc(100% + 2px);
    padding: 0;
    background: transparent;
    cursor: col-resize;
    border: 0;
    z-index: 5;
  }

  .track-column-resizer::after {
    content: "";
    position: absolute;
    top: 0.36rem;
    bottom: 0.36rem;
    left: 50%;
    width: 1px;
    transform: translateX(-50%);
    background: var(--border-soft);
    opacity: 1;
    transition:
      opacity 120ms ease,
      background-color var(--artwork-ui-transition-duration, 280ms) linear;
  }

  .track-column-header:last-child .track-column-resizer::after {
    opacity: 0;
  }

  .track-column-resizer:hover::after,
  .track-column-header.is-resizing .track-column-resizer::after {
    opacity: 1;
    background: var(--accent-strong);
  }
</style>
