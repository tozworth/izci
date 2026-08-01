<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import type { PlaylistItem } from '$lib/types';
  import type { LibraryPanelColumn } from './library-columns';
  import TrackRow from './TrackRow.svelte';
  import { getVirtualTrackWindow } from './track-list-virtualization';

  export let displayItems: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let playingId: string | null = null;
  export let layout: 'list' | 'columns' = 'list';
  export let isCompactColumnLayout = false;
  export let visibleColumns: LibraryPanelColumn[] = [];
  export let tableTemplateColumns = '';
  export let tableColumnGap = '4px';
  export let hideTrackFormat = false;
  export let scrollTop = 0;
  export let viewportHeight = 0;
  export let rowHeight = 28;

  let listElement: HTMLUListElement | null = null;

  const dispatch = createEventDispatcher<{
    itemClick: { id: string; event: MouseEvent };
    itemDoubleClick: string;
    itemContextMenu: { id: string; event: MouseEvent };
    rowHeight: number;
  }>();

  $: selectedIdSet = new Set(selectedIds);
  $: virtualWindow = getVirtualTrackWindow(displayItems.length, scrollTop, viewportHeight, rowHeight);
  $: renderedItems = displayItems.slice(virtualWindow.start, virtualWindow.end);

  afterUpdate(() => {
    const renderedRow = listElement?.querySelector<HTMLElement>('[data-track-id]');
    const measuredRowHeight = renderedRow?.getBoundingClientRect().height ?? 0;

    if (measuredRowHeight > 0 && Math.abs(measuredRowHeight - rowHeight) > 0.01) {
      dispatch('rowHeight', measuredRowHeight);
    }
  });
</script>

{#if layout === 'columns' && !isCompactColumnLayout}
  <div
    class="track-table"
    style={`--track-table-columns: ${tableTemplateColumns}; --track-table-gap: ${tableColumnGap};`}
  >
    <ul bind:this={listElement} class="track-list track-table-body">
      {#if virtualWindow.topSpacerHeight > 0}
        <li class="virtual-track-spacer" aria-hidden="true" style={`height: ${virtualWindow.topSpacerHeight}px;`}></li>
      {/if}
      {#each renderedItems as item (item.id)}
        <TrackRow
          {item}
          layout="columns"
          selected={selectedIdSet.has(item.id)}
          playing={item.id === playingId}
          {visibleColumns}
          on:itemClick={(event) => dispatch('itemClick', event.detail)}
          on:itemDoubleClick={(event) => dispatch('itemDoubleClick', event.detail)}
          on:itemContextMenu={(event) => dispatch('itemContextMenu', event.detail)}
        />
      {/each}
      {#if virtualWindow.bottomSpacerHeight > 0}
        <li class="virtual-track-spacer" aria-hidden="true" style={`height: ${virtualWindow.bottomSpacerHeight}px;`}></li>
      {/if}
    </ul>
  </div>
{:else}
  <ul bind:this={listElement} class="track-list">
    {#if virtualWindow.topSpacerHeight > 0}
      <li class="virtual-track-spacer" aria-hidden="true" style={`height: ${virtualWindow.topSpacerHeight}px;`}></li>
    {/if}
    {#each renderedItems as item (item.id)}
      <TrackRow
        {item}
        layout="list"
        selected={selectedIdSet.has(item.id)}
        playing={item.id === playingId}
        {hideTrackFormat}
        on:itemClick={(event) => dispatch('itemClick', event.detail)}
        on:itemDoubleClick={(event) => dispatch('itemDoubleClick', event.detail)}
        on:itemContextMenu={(event) => dispatch('itemContextMenu', event.detail)}
      />
    {/each}
    {#if virtualWindow.bottomSpacerHeight > 0}
      <li class="virtual-track-spacer" aria-hidden="true" style={`height: ${virtualWindow.bottomSpacerHeight}px;`}></li>
    {/if}
  </ul>
{/if}

<style>
  .track-table {
    width: 100%;
    min-width: 0;
    padding: 0 0.55rem 0.7rem;
    overflow-x: hidden;
  }

  .track-table-body {
    width: 100%;
    padding: 0;
  }

  .virtual-track-spacer {
    pointer-events: none;
  }
</style>
