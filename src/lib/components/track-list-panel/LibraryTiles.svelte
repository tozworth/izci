<script lang="ts">
  import { afterUpdate, createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import ArtworkThumbnail from '$lib/components/ArtworkThumbnail.svelte';
  import VisualThumbnail from '$lib/components/VisualThumbnail.svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import type { LibraryGroup } from './library-views';
  import type { TrackItem } from '$lib/types';
  import { getTrackDisplayTitle, getTrackDisplaySubtitle } from '$lib/utils/files';
  import { getLocalizedItemCount } from './summaries';
  import { getLibraryTileMetrics, getLibraryTileNavigationIndex, getLibraryTileWindow } from './library-browser-layout';

  export let items: TrackItem[] = [];
  export let groups: LibraryGroup[] = [];
  export let groupIcon = 'album';
  export let selectedIds: string[] = [];
  export let playingId: string | null = null;
  export let pinnedKeys: string[] = [];
  export let gallery = false;
  export let visual = false;
  export let tileSize = 144;
  export let scrollTop = 0;
  export let viewportHeight = 0;
  export let scrollElement: HTMLElement | null = null;

  const dispatch = createEventDispatcher<{
    itemClick: { id: string; event: MouseEvent };
    itemDoubleClick: string;
    itemContextMenu: { id: string; event: MouseEvent };
    itemNavigate: { id: string; range: boolean };
    open: string;
    groupContextMenu: { key: string; event: MouseEvent };
    movePin: { key: string; targetKey: string; position: 'before' | 'after' };
  }>();
  let host: HTMLDivElement;
  let width = 0;
  let top = 0;
  let draggedKey: string | null = null;
  let dropTarget: { key: string; position: 'before' | 'after' } | null = null;
  $: metrics = getLibraryTileMetrics(width, tileSize, visual && groups.length === 0);
  $: window = getLibraryTileWindow(groups.length || items.length, metrics.columns, metrics.rowPitch, scrollTop - top, viewportHeight);
  $: visibleItems = groups.length ? [] : gallery ? items : items.slice(window.start, window.end);
  $: visibleGroups = gallery ? [] : groups.slice(window.start, window.end);
  $: selected = new Set(selectedIds);
  $: pinned = new Set(pinnedKeys);
  afterUpdate(() => { if (host) top = host.offsetTop; });

  function titleIsTruncated(anchor: HTMLElement): boolean {
    const title = anchor.querySelector<HTMLElement>('.tile-copy strong');
    return !!title && title.scrollWidth > title.clientWidth;
  }

  async function scrollIndexIntoView(index: number) {
    if (!scrollElement || index < 0 || gallery) return;
    const rowTop = top + 6 + Math.floor(index / metrics.columns) * metrics.rowPitch;
    const covered = scrollElement.querySelector<HTMLElement>('.track-list-panel-header')?.offsetHeight ?? 0;
    if (rowTop < scrollElement.scrollTop + covered) scrollElement.scrollTop = Math.max(0, rowTop - covered);
    else if (rowTop + metrics.rowHeight > scrollElement.scrollTop + scrollElement.clientHeight) {
      scrollElement.scrollTop = rowTop + metrics.rowHeight - scrollElement.clientHeight;
    }
    scrollTop = scrollElement.scrollTop;
    await tick();
  }

  export async function scrollTrackIntoView(id: string) {
    await tick();
    await scrollIndexIntoView(items.findIndex((item) => item.id === id));
    if (gallery) host?.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  async function handleKeydown(event: KeyboardEvent, index: number, isGroup: boolean) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    const count = isGroup ? groups.length : items.length;
    const next = gallery
      ? Math.max(0, Math.min(count - 1, index + (event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1)))
      : getLibraryTileNavigationIndex(index, count, metrics.columns, event.key);
    if (next === index) return;
    if (!isGroup) dispatch('itemNavigate', { id: items[next].id, range: event.shiftKey });
    else {
      await scrollIndexIntoView(next);
      host?.querySelector<HTMLButtonElement>(`[data-group-key="${CSS.escape(groups[next].key)}"] button`)?.focus();
    }
  }

  function dragStart(event: DragEvent, key: string) {
    if (!event.dataTransfer || !pinned.has(key)) { event.preventDefault(); return; }
    draggedKey = key;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  }
  function dragOver(event: DragEvent, key: string) {
    if (!draggedKey || draggedKey === key || !pinned.has(key)) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropTarget = { key, position: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after' };
  }
  function drop(event: DragEvent, key: string) {
    if (!draggedKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (dropTarget?.key === key) dispatch('movePin', { key: draggedKey, targetKey: key, position: dropTarget.position });
    draggedKey = null;
    dropTarget = null;
  }
</script>

<div class="library-tiles" class:gallery bind:this={host} bind:clientWidth={width}
  style={`--tile-columns: ${metrics.columns}; --tile-height: ${metrics.rowHeight}px;`}>
  <div class="tile-space" style:height={gallery ? undefined : `${window.height}px`}>
    <ul class="tile-window" style:top={gallery ? undefined : `${window.top}px`}>
      {#each visibleGroups as group, index (group.key)}
        <li data-group-key={group.key} class:drop-before={dropTarget?.key === group.key && dropTarget.position === 'before'}
          class:drop-after={dropTarget?.key === group.key && dropTarget.position === 'after'}
          draggable={pinned.has(group.key)} on:dragstart={(event) => dragStart(event, group.key)}
          on:dragover={(event) => dragOver(event, group.key)} on:drop={(event) => drop(event, group.key)}
          on:dragend={() => { draggedKey = null; dropTarget = null; }}>
          <button type="button" class="tile"
            on:click={() => dispatch('open', group.key)}
            on:keydown={(event) => handleKeydown(event, window.start + index, true)}
            on:contextmenu={(event) => dispatch('groupContextMenu', { key: group.key, event })}>
            <span class="tile-visual">
              <ArtworkThumbnail tracks={group.items} icon={groupIcon} />
              {#if pinned.has(group.key)}<span class="tile-badge material-symbols-outlined" aria-hidden="true">keep</span>{/if}
            </span>
            <span class="tile-copy"><strong>{group.label}</strong><span>{group.secondary || getLocalizedItemCount(group.items, $t)}</span></span>
            <HoverTooltip align="center" showWhen={titleIsTruncated}>{group.label}</HoverTooltip>
          </button>
        </li>
      {/each}
      {#each visibleItems as track, index (track.id)}
        <li data-track-id={track.id} class:selected={selected.has(track.id)} class:playing={playingId === track.id}>
          <button type="button" class="tile" data-track-row-button
            aria-label={getTrackDisplayTitle(track)} aria-current={playingId === track.id ? 'true' : undefined}
            on:click={(event) => dispatch('itemClick', { id: track.id, event })}
            on:dblclick={() => dispatch('itemDoubleClick', track.id)}
            on:keydown={(event) => handleKeydown(event, gallery ? index : window.start + index, false)}
            on:contextmenu={(event) => dispatch('itemContextMenu', { id: track.id, event })}>
            <span class="tile-visual" class:is-visual={track.kind === 'image' || track.kind === 'video'}>
              {#if track.kind === 'image' || track.kind === 'video'}
                <VisualThumbnail {track} />
              {:else}
                <ArtworkThumbnail tracks={[track]} icon={track.kind === 'module' ? 'equalizer' : 'music_note'} />
              {/if}
              {#if playingId === track.id}<span class="tile-badge material-symbols-outlined" aria-hidden="true">graphic_eq</span>{/if}
            </span>
            {#if !gallery}
              <span class="tile-copy"><strong>{getTrackDisplayTitle(track)}</strong><span>{getTrackDisplaySubtitle(track) || track.extension.toUpperCase()}</span></span>
              <HoverTooltip align="center" showWhen={titleIsTruncated}>{getTrackDisplayTitle(track)}</HoverTooltip>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .library-tiles { position: relative; width: 100%; }
  .tile-space { position: relative; }
  .tile-window {
    position: absolute; left: 6px; right: 6px;
    display: grid; grid-template-columns: repeat(var(--tile-columns), minmax(0, 1fr));
    gap: 6px; margin: 0; padding: 0; list-style: none;
  }
  li { min-width: 0; position: relative; }
  .tile {
    position: relative; display: flex; flex-direction: column; width: 100%; height: var(--tile-height);
    padding: 0; border: 1px solid transparent; border-radius: 0; background: transparent;
    color: var(--text); font: inherit; text-align: left; cursor: default;
  }
  .tile:hover { background: var(--hover-surface); }
  .selected .tile { background: var(--selection-bg); border-color: var(--accent); }
  .tile:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
  .playing .tile-copy strong { color: var(--accent); }
  .tile-visual { position: relative; display: block; flex: 1; min-height: 0; width: 100%; overflow: hidden; background: var(--bg-elevated); }
  .tile-copy { display: flex; flex-direction: column; gap: 2px; height: 42px; padding: 4px; box-sizing: border-box; }
  .tile-copy strong, .tile-copy span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 0.72rem; line-height: 15px; }
  .tile-copy strong { font-weight: 500; }
  .tile-copy span { color: var(--muted); font-size: 0.66rem; }
  .tile-badge { position: absolute; bottom: 3px; right: 3px; padding: 2px; font-size: 1rem; background: var(--bg-elevated); color: var(--accent); }
  .tile-visual :global(.thumbnail-host) { position: absolute; inset: 0; display: grid; place-items: center; }
  .tile-visual :global(.thumbnail-image) { width: 100%; height: 100%; object-fit: cover; }
  .tile-visual :global(.thumbnail-placeholder) { color: var(--muted); font-size: 2.5rem; opacity: 0.7; }
  .tile-visual :global(.thumbnail-brand-glyph) { width: 40%; aspect-ratio: 1; background: currentColor; mask: url('/icons/izci-mark.svg') center / contain no-repeat; }
  .drop-before::before, .drop-after::after { position: absolute; z-index: 1; top: 0; bottom: 0; width: 2px; background: var(--accent); content: ''; }
  .drop-before::before { left: -4px; } .drop-after::after { right: -4px; }
  .gallery .tile-window { position: static; display: block; columns: var(--tile-columns); column-gap: 6px; padding: 6px; }
  .gallery li { break-inside: avoid; margin-bottom: 6px; }
  .gallery .tile { display: block; height: auto; }
  .gallery .tile-visual { display: block; }
  .gallery .tile-visual :global(.thumbnail-host) { position: relative; display: block; aspect-ratio: var(--thumbnail-aspect, 4 / 3); }
  .gallery .tile-visual :global(.thumbnail-image), .gallery .tile-visual :global(.thumbnail-placeholder) { position: absolute; inset: 0; }
  .gallery .tile-visual :global(.thumbnail-placeholder) { display: grid; place-items: center; }
</style>
