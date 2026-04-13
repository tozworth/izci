<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { PlaylistItem } from '$lib/types';
  import type { LibraryPanelColumn } from './library-columns';
  import {
    formatTrackType,
    getColumnTextValue,
    getTrackDuration,
    isRightAlignedColumn
  } from './library-columns';
  import { getTrackDisplayTitle } from '$lib/utils/files';

  export let item: PlaylistItem;
  export let selected = false;
  export let playing = false;
  export let layout: 'list' | 'columns' = 'list';
  export let visibleColumns: LibraryPanelColumn[] = [];
  export let hideTrackFormat = false;

  const dispatch = createEventDispatcher<{
    itemClick: { id: string; event: MouseEvent };
    itemDoubleClick: string;
    itemContextMenu: { id: string; event: MouseEvent };
  }>();

  $: trackTitle = getTrackDisplayTitle(item);
  $: trackDuration = getTrackDuration(item);
</script>

<li class:selected class:playing data-track-id={item.id}>
  {#if layout === 'columns'}
    <button
      class="track-table-row-button"
      type="button"
      aria-current={playing ? 'true' : undefined}
      on:click={(event) => dispatch('itemClick', { id: item.id, event })}
      on:dblclick={() => dispatch('itemDoubleClick', item.id)}
      on:contextmenu={(event) => dispatch('itemContextMenu', { id: item.id, event })}
    >
      {#each visibleColumns as column}
        <span
          class="track-table-cell"
          class:is-right-aligned={isRightAlignedColumn(column.id)}
          class:is-duration={column.id === 'duration'}
          title={getColumnTextValue(item, column.id)}
        >
          {getColumnTextValue(item, column.id)}
        </span>
      {/each}
    </button>
  {:else}
    <button
      class="track-row"
      type="button"
      aria-current={playing ? 'true' : undefined}
      title={trackTitle}
      on:click={(event) => dispatch('itemClick', { id: item.id, event })}
      on:dblclick={() => dispatch('itemDoubleClick', item.id)}
      on:contextmenu={(event) => dispatch('itemContextMenu', { id: item.id, event })}
    >
      <span class="track-name">{trackTitle}</span>
      {#if !hideTrackFormat || trackDuration}
        <span class="track-meta" class:has-duration={Boolean(trackDuration)}>
          {#if !hideTrackFormat}
            <span class="track-format">{formatTrackType(item)}</span>
          {/if}
          {#if trackDuration}
            <span class="track-duration">{trackDuration}</span>
          {/if}
        </span>
      {/if}
    </button>
  {/if}
</li>

<style>
  .track-table-row-button {
    width: 100%;
    display: grid;
    grid-template-columns: var(--track-table-columns);
    column-gap: 0.75rem;
    align-items: center;
    padding: 0.38rem 0;
    color: inherit;
    background: transparent;
    border: 0;
    text-align: left;
    min-width: 0;
  }

  .track-table-cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-table-cell.is-right-aligned {
    text-align: right;
  }

  .track-table-cell.is-duration {
    color: var(--muted);
  }

  li .track-table-row-button:hover {
    background: var(--hover-subtle);
  }

  li.selected .track-table-row-button {
    background: var(--selection-bg);
  }

  li.playing .track-table-row-button {
    box-shadow: inset 3px 0 0 var(--accent-strong);
    font-weight: 600;
  }

  li.playing .track-table-row-button .track-table-cell.is-duration {
    color: inherit;
  }
</style>
