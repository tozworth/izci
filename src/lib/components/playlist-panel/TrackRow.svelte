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
  import {
    getTrackDisplaySubtitle,
    getTrackDisplayTitle,
    getTrackPlaylistLabel
  } from '$lib/utils/files';

  export let item: PlaylistItem;
  export let selected = false;
  export let playing = false;
  export let layout: 'list' | 'columns' = 'list';
  export let visibleColumns: LibraryPanelColumn[] = [];
  export let hideTrackFormat = false;
  export let mobilePresentation = false;

  const dispatch = createEventDispatcher<{
    itemClick: { id: string; event: MouseEvent };
    itemDoubleClick: string;
    itemContextMenu: { id: string; event: MouseEvent };
  }>();

  $: trackTitle = getTrackPlaylistLabel(item);
  $: mobileTrackTitle = getTrackDisplayTitle(item);
  $: mobileTrackArtist = getTrackDisplaySubtitle(item);
  $: trackDuration = getTrackDuration(item);
</script>

<li class:selected class:playing data-track-id={item.id}>
  {#if layout === 'columns'}
    <button
      data-track-row-button
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
          class:is-rating={column.id === 'rating'}
          title={getColumnTextValue(item, column.id)}
        >
          {#if column.id === 'rating' && getColumnTextValue(item, column.id)}
            <span class="track-rating-value">
              {getColumnTextValue(item, column.id)}
              <span class="material-symbols-outlined track-rating-star" aria-hidden="true">star</span>
            </span>
          {:else}
            {getColumnTextValue(item, column.id)}
          {/if}
        </span>
      {/each}
    </button>
  {:else}
    <button
      data-track-row-button
      class="track-row"
      type="button"
      aria-current={playing ? 'true' : undefined}
      title={trackTitle}
      on:click={(event) => dispatch('itemClick', { id: item.id, event })}
      on:dblclick={() => dispatch('itemDoubleClick', item.id)}
      on:contextmenu={(event) => dispatch('itemContextMenu', { id: item.id, event })}
    >
      {#if mobilePresentation}
        <span class="mobile-track-copy">
          <span class="mobile-track-title">{mobileTrackTitle}</span>
          {#if mobileTrackArtist}
            <span class="mobile-track-artist">{mobileTrackArtist}</span>
          {/if}
        </span>
      {:else}
        <span class="track-name">{trackTitle}</span>
      {/if}
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
    position: relative;
    width: 100%;
    display: grid;
    grid-template-columns: var(--track-table-columns);
    column-gap: var(--track-table-gap);
    align-items: center;
    padding: 0.01rem 0;
    color: var(--text);
    background: transparent;
    border: 0;
    text-align: left;
    min-width: 0;
    border-radius: 4px;
  }

  .track-table-row-button::before {
    content: "";
    position: absolute;
    inset: 0 -0.55rem;
    z-index: 0;
    border-radius: 4px;
    pointer-events: none;
  }

  .track-table-cell {
    position: relative;
    z-index: 1;
    min-width: 0;
    min-height: 1.4rem;
    display: block;
    padding: 0.18rem 0.3rem 0.16rem;
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

  .track-table-cell.is-rating {
    text-overflow: clip;
  }

  .track-rating-value {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
  }

  .track-rating-star {
    flex-shrink: 0;
    color: var(--accent-strong);
    font-size: 0.92rem;
    line-height: 1;
    font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
  }

  li .track-table-row-button:hover::before {
    background: var(--hover-subtle);
  }

  li.selected .track-table-row-button::before {
    background: var(--selection-bg);
  }

  li.playing .track-table-row-button {
    color: var(--text-strong);
    font-weight: 600;
  }

  li.playing .track-table-row-button::before {
    box-shadow: inset 3px 0 0 var(--accent-strong);
  }

  li.playing .track-table-row-button .track-table-cell.is-duration {
    color: inherit;
  }
</style>
