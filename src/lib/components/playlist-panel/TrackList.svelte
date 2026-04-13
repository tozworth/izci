<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PlaylistItem } from '$lib/types';
  import type { LibraryPanelColumn } from './library-columns';
  import TrackRow from './TrackRow.svelte';

  export let displayItems: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let playingId: string | null = null;
  export let layout: 'list' | 'columns' = 'list';
  export let isCompactColumnLayout = false;
  export let visibleColumns: LibraryPanelColumn[] = [];
  export let tableTemplateColumns = '';
  export let hideTrackFormat = false;

  const dispatch = createEventDispatcher<{
    itemClick: { id: string; event: MouseEvent };
    itemDoubleClick: string;
    itemContextMenu: { id: string; event: MouseEvent };
  }>();
</script>

{#if layout === 'columns' && !isCompactColumnLayout}
  <div class="track-table" style={`--track-table-columns: ${tableTemplateColumns};`}>
    <ul class="track-list track-table-body">
      {#each displayItems as item}
        <TrackRow
          {item}
          layout="columns"
          selected={selectedIds.includes(item.id)}
          playing={item.id === playingId}
          {visibleColumns}
          on:itemClick={(event) => dispatch('itemClick', event.detail)}
          on:itemDoubleClick={(event) => dispatch('itemDoubleClick', event.detail)}
          on:itemContextMenu={(event) => dispatch('itemContextMenu', event.detail)}
        />
      {/each}
    </ul>
  </div>
{:else}
  <ul class="track-list">
    {#each displayItems as item}
      <TrackRow
        {item}
        layout="list"
        selected={selectedIds.includes(item.id)}
        playing={item.id === playingId}
        {hideTrackFormat}
        on:itemClick={(event) => dispatch('itemClick', event.detail)}
        on:itemDoubleClick={(event) => dispatch('itemDoubleClick', event.detail)}
        on:itemContextMenu={(event) => dispatch('itemContextMenu', event.detail)}
      />
    {/each}
  </ul>
{/if}

<style>
  .track-table {
    width: 100%;
    min-width: 0;
    padding: 0 0.85rem 0.85rem;
    overflow-x: hidden;
  }

  .track-table-body {
    width: 100%;
  }
</style>
