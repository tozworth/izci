<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { LibraryColumnId, LibraryViewSortState } from '$lib/types';
  import type { ColumnDropIndicator, LibraryPanelColumn } from './library-columns';
  import { isRightAlignedColumn } from './library-columns';

  export let visibleColumns: LibraryPanelColumn[] = [];
  export let activeSort: LibraryViewSortState;
  export let tableTemplateColumns = '';
  export let dropIndicator: ColumnDropIndicator | null = null;

  const dispatch = createEventDispatcher<{
    sort: LibraryColumnId;
    contextMenu: MouseEvent;
    columnPointerDown: { event: PointerEvent; columnId: LibraryColumnId };
    columnPointerEnter: { event: PointerEvent; columnId: LibraryColumnId };
    resizeStart: { event: PointerEvent; columnId: LibraryColumnId };
  }>();
</script>

<div class="track-columns-header" role="row" style={`--track-table-columns: ${tableTemplateColumns};`}>
  {#each visibleColumns as column}
    <div
      class="track-column-header"
      class:is-sorted={activeSort.columnId === column.id}
      class:is-right-aligned={isRightAlignedColumn(column.id)}
      class:drop-before={dropIndicator?.columnId === column.id && dropIndicator.position === 'before'}
      class:drop-after={dropIndicator?.columnId === column.id && dropIndicator.position === 'after'}
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
      on:pointerenter={(event) => dispatch('columnPointerEnter', { event, columnId: column.id })}
      on:contextmenu={(event) => dispatch('contextMenu', event)}
    >
      <button
        type="button"
        class="track-column-sort-button"
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
    column-gap: 0.75rem;
    width: 100%;
    padding: 0 0 0.02rem;
  }

  .track-column-header {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid var(--border-soft);
  }

  .track-column-header.drop-before::before,
  .track-column-header.drop-after::after {
    content: "";
    position: absolute;
    top: 0.35rem;
    bottom: 0.35rem;
    width: 2px;
    background: var(--accent-strong);
    z-index: 2;
  }

  .track-column-header.drop-before::before {
    left: -1px;
  }

  .track-column-header.drop-after::after {
    right: -1px;
  }

  .track-column-sort-button {
    width: 100%;
    display: block;
    padding: 0.1rem 1rem 0.14rem 0;
    color: var(--muted);
    background: transparent;
    text-align: left;
    border: 0;
    user-select: none;
  }

  .track-column-sort-button.is-right-aligned {
    text-align: right;
  }

  .track-column-header.is-sorted .track-column-sort-button,
  .track-column-sort-button:hover {
    color: var(--text);
  }

  .track-column-sort-content {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    max-width: 100%;
  }

  .track-column-sort-content.is-right-aligned {
    justify-content: flex-end;
    width: 100%;
  }

  .track-column-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .track-column-sort-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .track-column-resizer {
    position: absolute;
    top: 0;
    right: -5px;
    width: 10px;
    height: 100%;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    z-index: 3;
  }
</style>
