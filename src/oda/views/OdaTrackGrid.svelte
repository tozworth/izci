<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { TrackItem } from '$lib/types';
  import { odaBrowseTrackId } from '../oda-browse';
  import type { OdaBrowseGroupRow } from '../oda-browse';
  import ArtworkThumbnail from '$lib/components/ArtworkThumbnail.svelte';

  export let items: TrackItem[] = [];
  export let groups: OdaBrowseGroupRow[] = [];
  export let groupIcon = 'album';
  export let focusId: string | null = null;
  export let playingId: string | null = null;
  export let columns = 4;
  export let listKey = '';
  export let onFocus: (focusId: string) => void = () => {};
  export let onActivateTrack: (id: string) => void = () => {};
  export let onOpenGroup: (key: string) => void = () => {};

  const OVERSCAN_ROWS = 2;
  const TOP_PADDING = 18;
  const BOTTOM_PADDING = 48;

  let viewport: HTMLDivElement | null = null;
  let tile: HTMLButtonElement | null = null;
  let scrollTop = 0;
  let viewportHeight = 0;
  let rowPitch = 240;
  let rowGap = 16;
  let lastListKey = '';

  $: totalRows = Math.ceil((groups.length || items.length) / columns);
  $: startRow = Math.max(0, Math.floor(Math.max(0, scrollTop - TOP_PADDING) / rowPitch) - OVERSCAN_ROWS);
  $: endRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowPitch) + OVERSCAN_ROWS);
  $: visibleItems = items.slice(startRow * columns, endRow * columns);
  $: visibleGroups = groups.slice(startRow * columns, endRow * columns);
  $: visibleTracks = groups.length === 0 ? visibleItems : [];
  $: totalHeight = TOP_PADDING + Math.max(0, totalRows * rowPitch - rowGap) + BOTTOM_PADDING;

  function measure(): void {
    if (!viewport) return;
    viewportHeight = viewport.clientHeight;
    if (!tile) return;
    const gap = Number.parseFloat(getComputedStyle(tile.parentElement!).rowGap) || 0;
    const pitch = tile.offsetHeight + gap;
    if (pitch > 0) {
      rowGap = gap;
      rowPitch = pitch;
    }
  }

  function ensureFocusVisible(id: string | null): void {
    if (!viewport || !id) return;
    const trackId = odaBrowseTrackId(id);
    const index = groups.length > 0
      ? groups.findIndex((group) => group.focusId === id)
      : trackId ? items.findIndex((item) => item.id === trackId) : -1;
    if (index < 0) return;
    const top = TOP_PADDING + Math.floor(index / columns) * rowPitch;
    const bottom = top + rowPitch - rowGap;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = bottom - viewport.clientHeight;
    }
  }

  $: if (listKey !== lastListKey) {
    lastListKey = listKey;
    if (viewport) viewport.scrollTop = 0;
    scrollTop = 0;
  }

  // Focus updates may move to a row outside the mounted window. Wheel scrolling
  // only changes scrollTop, so it never pulls the viewport back to old focus.
  $: if (viewport && focusId) {
    void listKey;
    void columns;
    void items;
    void groups;
    ensureFocusVisible(focusId);
  }

  $: if (viewport) {
    void listKey;
    void columns;
    void visibleItems;
    void visibleGroups;
    void tick().then(measure);
  }

  onMount(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !viewport) return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  });
</script>

<div
  class="oda-browser-grid oda-browser-grid-virtual"
  bind:this={viewport}
  on:scroll={(event) => { scrollTop = event.currentTarget.scrollTop; }}
>
  <div class="oda-browser-grid-inner" style={`height: ${totalHeight}px`}>
    <div
      class="oda-browser-grid-window"
      style={`--oda-browser-columns: ${columns}; top: ${TOP_PADDING + startRow * rowPitch}px`}
    >
      {#each visibleGroups as group (group.focusId)}
        <button
          bind:this={tile}
          type="button"
          class="oda-library-tile is-group"
          class:is-focused={focusId === group.focusId}
          data-focus-id={group.focusId}
          on:click={() => { onFocus(group.focusId); onOpenGroup(group.key); }}
        >
          <span class="oda-tile-visual">
            <ArtworkThumbnail tracks={group.items} icon={groupIcon} />
            <span class="oda-tile-count">{group.count}</span>
          </span>
          <span class="oda-tile-copy">
            <strong>{group.label}</strong>
            {#if group.secondary}<span>{group.secondary}</span>{/if}
          </span>
        </button>
      {/each}
      {#each visibleTracks as track (track.id)}
        {@const trackFocusId = `item:${track.id}`}
        <button
          bind:this={tile}
          type="button"
          class="oda-library-tile"
          class:is-focused={focusId === trackFocusId}
          class:is-playing={playingId === track.id}
          data-focus-id={trackFocusId}
          on:click={() => { onFocus(trackFocusId); onActivateTrack(track.id); }}
        >
          <span class="oda-tile-visual">
            <ArtworkThumbnail tracks={[track]} icon={track.kind === 'module' ? 'equalizer' : 'music_note'} />
            {#if playingId === track.id}
              <span class="oda-playing-badge material-symbols-outlined" aria-hidden="true">graphic_eq</span>
            {/if}
          </span>
          <span class="oda-tile-copy">
            <strong>{track.metadata?.title || track.name}</strong>
            <span>{[track.metadata?.artist?.trim(), track.metadata?.album?.trim()].filter(Boolean).join(' · ') || track.extension.toUpperCase()}</span>
          </span>
        </button>
      {/each}
    </div>
  </div>
</div>
