<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import MenuSurface from './MenuSurface.svelte';
  import type { ColumnListDropIndicator, ColumnListViewColumn } from './column-list-view';

  export let columns: ColumnListViewColumn[] = [];
  export let allColumns: ColumnListViewColumn[] = [];
  export let columnGap = '4px';
  export let contextMenuLabel = 'Columns';
  export let resizingColumnId: string | null = null;
  export let draggedColumnId: string | null = null;
  export let dropIndicator: ColumnListDropIndicator | null = null;
  export let activeSort: { columnId: string; direction: 'asc' | 'desc' } | null = null;
  export let showHeader = true;
  export let resizeLabel: (column: ColumnListViewColumn) => string = (column) =>
    `Resize ${column.label} column`;
  export let style = '';
  export let scrollElement: HTMLElement | null = null;
  export let headerElement: HTMLDivElement | null = null;
  export let clientWidth = 0;
  export let clientHeight = 0;

  const dispatch = createEventDispatcher<{
    resizeStart: { event: PointerEvent; columnId: string };
    columnPointerDown: { event: PointerEvent; columnId: string };
    visibilityToggle: string;
    scroll: void;
  }>();

  let menuOpen = false;
  let menuX = 0;
  let menuY = 0;

  $: templateColumns = columns
    .map((column) => `minmax(${column.width}px, ${column.width}px)`)
    .join(' ');
  $: visibleColumnCount = allColumns.filter((column) => column.visible).length;
  $: menuItems = allColumns.map((column) => ({
    id: `toggle:${column.id}`,
    label: column.label,
    icon: column.icon,
    checked: column.visible,
    disabled: column.visible && visibleColumnCount === 1
  }));
  $: if (!showHeader) menuOpen = false;

  function openContextMenu(event: MouseEvent): void {
    if (allColumns.length === 0) return;
    event.preventDefault();
    menuX = event.clientX;
    menuY = event.clientY;
    menuOpen = true;
  }

  function handleMenuAction(actionId: string): void {
    menuOpen = false;
    if (actionId.startsWith('toggle:')) {
      dispatch('visibilityToggle', actionId.slice('toggle:'.length));
    }
  }

  onMount(() => {
    const region = scrollElement;
    if (!region) return;

    clientWidth = Math.round(region.clientWidth);
    clientHeight = Math.round(region.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      clientWidth = Math.round(region.clientWidth);
      clientHeight = Math.round(region.clientHeight);
    });
    observer.observe(region);
    return () => observer.disconnect();
  });
</script>

<div
  class="column-list-view"
  style={`${style} --clv-template-columns: ${templateColumns}; --clv-column-gap: ${columnGap};`}
>
  {#if showHeader}
    <div
      bind:this={headerElement}
      class="clv-columns-header"
      class:is-dragging={Boolean(draggedColumnId)}
      role="row"
      tabindex="-1"
      on:contextmenu={openContextMenu}
    >
      {#each columns as column}
        <div
          class="clv-column-header"
          class:is-resizing={resizingColumnId === column.id}
          class:is-dragged={draggedColumnId === column.id}
          class:is-right-aligned={column.rightAligned}
          class:drop-before={dropIndicator?.columnId === column.id && dropIndicator.position === 'before'}
          class:drop-after={dropIndicator?.columnId === column.id && dropIndicator.position === 'after'}
          data-column-id={column.id}
          role="columnheader"
          tabindex="-1"
          aria-sort={activeSort?.columnId === column.id
            ? activeSort.direction === 'asc' ? 'ascending' : 'descending'
            : 'none'}
          on:pointerdown={(event) => dispatch('columnPointerDown', { event, columnId: column.id })}
        >
          <slot name="headerCell" {column} sorted={activeSort?.columnId === column.id}>
            <span class="clv-column-label">{column.label}</span>
          </slot>
          <button
            type="button"
            class="clv-column-resizer"
            aria-label={resizeLabel(column)}
            title={resizeLabel(column)}
            on:pointerdown={(event) => dispatch('resizeStart', { event, columnId: column.id })}
          ></button>
        </div>
      {/each}
    </div>
  {/if}

  <div
    class="clv-scroll-region"
    {...$$restProps}
    bind:this={scrollElement}
    on:scroll={() => dispatch('scroll')}
  >
    <slot />
  </div>
</div>

{#if menuOpen}
  <MenuSurface
    items={menuItems}
    x={menuX}
    y={menuY}
    ariaLabel={contextMenuLabel}
    maxVisibleItems={8}
    on:dismiss={() => (menuOpen = false)}
    on:action={(event) => handleMenuAction(event.detail)}
  />
{/if}

<style>
  .column-list-view { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
  .clv-columns-header { position: relative; z-index: 3; display: grid; grid-template-columns: var(--clv-template-columns); column-gap: var(--clv-column-gap); align-items: stretch; min-height: var(--clv-header-min-height, 1.4rem); padding: var(--clv-header-padding, 0); }
  .clv-columns-header::before { content: ""; position: absolute; inset: 0 var(--clv-header-bleed, 0); z-index: 0; border-bottom: 1px solid var(--clv-header-border, transparent); background: var(--clv-header-background, transparent); pointer-events: none; }
  .clv-column-header { position: relative; z-index: 1; min-width: 0; min-height: 1.32rem; display: flex; align-items: stretch; overflow: visible; cursor: var(--clv-column-cursor, default); }
  .clv-columns-header.is-dragging .clv-column-header { cursor: grabbing; }
  .clv-column-header.is-dragged { background: var(--accent-strong-faint); opacity: 0.58; }
  .clv-column-header.drop-before::before, .clv-column-header.drop-after::after { content: ""; position: absolute; top: -0.16rem; bottom: -0.16rem; z-index: 4; width: 3px; border-radius: 999px; background: var(--accent-strong); box-shadow: 0 0 0 3px var(--accent-strong-faint); }
  .clv-column-header.drop-before::before { left: calc(var(--clv-column-gap) / -2 - 1px); }
  .clv-column-header.drop-after::after { right: calc(var(--clv-column-gap) / -2 - 1px); }
  :global(.clv-column-label) { align-self: center; display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 0.66rem; font-weight: 600; letter-spacing: 0.025em; text-transform: uppercase; }
  :global(.clv-column-sort-button) { position: relative; width: 100%; display: flex; align-items: center; min-width: 0; padding: 0.08rem 0.3rem 0.07rem; color: var(--muted); background: transparent; text-align: left; border: 0; border-radius: 0; user-select: none; }
  :global(.clv-column-sort-button:hover), :global(.clv-column-sort-button.is-sorted) { color: var(--text); }
  :global(.clv-column-sort-button:hover) { background: color-mix(in srgb, var(--hover-subtle) 72%, transparent); }
  :global(.clv-column-sort-content) { display: block; min-width: 0; width: 100%; }
  :global(.clv-column-sort-content.is-right-aligned) { text-align: right; }
  :global(.clv-column-sort-button .clv-column-sort-icon) { position: absolute; right: 0.25rem; top: 50%; transform: translateY(-50%); font-size: 0.72rem; color: inherit; pointer-events: none; }
  :global(.clv-column-sort-button.is-sorted .clv-column-label) { padding-right: 0.9rem; }
  .clv-column-resizer { position: absolute; top: -1px; right: calc(var(--clv-column-gap) / -2 - 6px); z-index: 5; width: 12px; height: calc(100% + 2px); padding: 0; border: 0; background: transparent; cursor: col-resize; }
  .clv-column-resizer::after { content: ""; position: absolute; top: 0.22rem; bottom: 0.22rem; left: 50%; width: 1px; transform: translateX(-50%); background: var(--border-soft); }
  .clv-column-header:last-child .clv-column-resizer::after { opacity: 0; }
  .clv-column-resizer:hover::after, .clv-column-header.is-resizing .clv-column-resizer::after { opacity: 1; background: var(--accent-strong); box-shadow: 0 0 0 2px var(--accent-strong-faint); }
  .clv-scroll-region { position: relative; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; }
</style>
