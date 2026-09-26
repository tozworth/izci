<script lang="ts">
  import { tick } from 'svelte';
  import type { LibraryGroupViewId, OdaBrowserLayout, TrackItem } from '$lib/types';
  import type { OdaBrowseView, OdaMedium } from '$lib/services/oda-session';
  import {
    buildOdaBrowseGroupRows,
    isOdaGroupedBrowseView,
    odaBrowserFilterFromFocusId,
    odaBrowserFilterFocusId,
    odaBrowserLayoutFocusId,
    odaBrowserZoomFocusId,
    odaBrowseGroupKey,
    odaBrowseTrackId,
    resolveOdaBrowserColumns,
    resolveOdaBrowserListRowHeight,
    resolveOdaBrowserViews,
    resolveOdaBrowseGroup
  } from '../oda-browse';
  import { buildOdaGroupDisplayRows, buildOdaTrackDisplayRows } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';
  import OdaRouteList from './OdaRouteList.svelte';
  import OdaTrackGrid from './OdaTrackGrid.svelte';
  import OdaVisualPreview from './OdaVisualPreview.svelte';

  export let medium: OdaMedium = 'music';
  export let view: OdaBrowseView;
  /** The caller has already filtered this collection by medium. */
  export let items: TrackItem[] = [];
  export let groupKey: string | null = null;
  export let focusId: string | null = null;
  export let playingId: string | null = null;
  export let browserLayout: OdaBrowserLayout = 'grid';
  export let zoomLevel = 2;
  export let translate: OdaTranslate;
  export let onActivateTrack: (id: string) => void = () => {};
  export let onOpenGroup: (groupKey: string) => void = () => {};
  export let onSelectView: (view: OdaBrowseView) => void = () => {};
  export let onSetBrowserLayout: (layout: OdaBrowserLayout) => void = () => {};
  export let onAdjustZoom: (delta: -1 | 1) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  let gridViewport: HTMLElement | null = null;
  const listLayoutFocusId = odaBrowserLayoutFocusId('list');
  const gridLayoutFocusId = odaBrowserLayoutFocusId('grid');
  const galleryLayoutFocusId = odaBrowserLayoutFocusId('gallery');
  const zoomOutFocusId = odaBrowserZoomFocusId('out');
  const zoomInFocusId = odaBrowserZoomFocusId('in');

  $: views = resolveOdaBrowserViews(medium);
  $: grouped = medium === 'music' && isOdaGroupedBrowseView(view);
  $: groups = grouped && !groupKey
    ? buildOdaBrowseGroupRows(items, view as LibraryGroupViewId)
    : [];
  $: group = grouped && groupKey
    ? resolveOdaBrowseGroup(items, view as LibraryGroupViewId, groupKey)
    : null;
  $: trackItems = group?.items ?? (groups.length === 0 ? items : []);
  $: rows = groups.length > 0
    ? buildOdaGroupDisplayRows(items, view as LibraryGroupViewId)
    : buildOdaTrackDisplayRows(trackItems, playingId);
  $: layout = medium === 'music' && browserLayout === 'gallery' ? 'grid' : browserLayout;
  $: sidebarFocused = odaBrowserFilterFromFocusId(focusId)?.medium === medium;
  $: columns = resolveOdaBrowserColumns(layout, zoomLevel);
  $: rowHeight = resolveOdaBrowserListRowHeight(zoomLevel);
  $: itemCount = groups.length || trackItems.length;
  $: listKey = `${medium}:${view}:${groupKey ?? ''}:${layout}:${zoomLevel}`;
  $: heading = group?.label ?? filterLabel(view);
  $: subheading = group?.secondary || countLabel(itemCount, groups.length > 0);

  $: if (gridViewport && focusId && layout !== 'list') {
    void listKey;
    void tick().then(() => {
      ensureGridFocusVisible(focusId);
    });
  }

  function ensureGridFocusVisible(id: string): void {
    if (!gridViewport) return;
    // Group keys can contain a NUL separator, which CSS.escape() replaces.
    const tile = Array.from(gridViewport.querySelectorAll<HTMLElement>('[data-focus-id]'))
      .find((element) => element.dataset.focusId === id);
    if (!tile) return;

    const viewportRect = gridViewport.getBoundingClientRect();
    const tileRect = tile.getBoundingClientRect();
    if (tileRect.top < viewportRect.top) {
      gridViewport.scrollTop += tileRect.top - viewportRect.top;
    } else if (tileRect.bottom > viewportRect.bottom) {
      gridViewport.scrollTop += tileRect.bottom - viewportRect.bottom;
    }
  }

  function filterLabel(filter: OdaBrowseView): string {
    if (medium === 'video') return translate('oda.browser.allVideos', 'All videos');
    if (medium === 'image') return translate('oda.browser.allImages', 'All images');
    switch (filter) {
      case 'albums': return translate('oda.cards.albums', 'Albums');
      case 'artists': return translate('oda.cards.artists', 'Artists');
      case 'genres': return translate('oda.cards.genres', 'Genres');
      case 'years': return translate('oda.cards.years', 'Years');
      case 'formats': return translate('oda.cards.formats', 'Formats');
      case 'folders': return translate('oda.cards.folders', 'Folders');
      default: return translate('oda.browser.allSongs', 'All songs');
    }
  }

  function filterIcon(filter: OdaBrowseView): string {
    if (medium === 'video') return 'movie';
    if (medium === 'image') return 'image';
    switch (filter) {
      case 'albums': return 'album';
      case 'artists': return 'mic';
      case 'genres': return 'category';
      case 'years': return 'calendar_month';
      case 'formats': return 'audio_file';
      case 'folders': return 'folder';
      default: return 'music_note';
    }
  }

  function countLabel(count: number, groupCount: boolean): string {
    return groupCount
      ? translate('oda.browse.groupCount', '{count} groups', { count })
      : translate('oda.browse.count', '{count} items', { count });
  }

  function activateFocus(rowFocusId: string): void {
    const nextGroupKey = odaBrowseGroupKey(rowFocusId);
    if (nextGroupKey) onOpenGroup(nextGroupKey);
    const trackId = odaBrowseTrackId(rowFocusId);
    if (trackId) onActivateTrack(trackId);
  }

</script>

<div
  class="oda-library-browser"
  class:is-visual={medium !== 'music'}
  class:is-sidebar-focused={sidebarFocused}
  data-layout={layout}
  data-zoom={zoomLevel}
  style={`--oda-browser-zoom-scale: ${0.72 + zoomLevel * 0.14}`}
>
  <aside class="oda-browser-sidebar">
    <div class="oda-browser-brand">
      <span class="material-symbols-outlined" aria-hidden="true">{medium === 'music' ? 'library_music' : medium === 'video' ? 'movie' : 'image'}</span>
      <strong>{medium === 'music'
        ? translate('oda.home.music', 'Music')
        : medium === 'video'
          ? translate('oda.home.videos', 'Videos')
          : translate('oda.home.images', 'Images')}</strong>
    </div>

    <nav aria-label={translate('oda.browser.filters', 'Library filters')}>
      {#each views as filter}
        {@const filterFocusId = odaBrowserFilterFocusId(medium, filter)}
        <button
          type="button"
          class="oda-browser-filter"
          class:is-active={view === filter}
          class:is-focused={focusId === filterFocusId}
          data-focus-id={filterFocusId}
          aria-label={filterLabel(filter)}
          on:click={() => { onFocus(filterFocusId); onSelectView(filter); }}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{filterIcon(filter)}</span>
          <span>{filterLabel(filter)}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="oda-browser-content">
    <header class="oda-browser-header">
      <div class="oda-browser-heading">
        {#if group}
          <span>{filterLabel(view)}</span>
        {/if}
        <h1>{heading}</h1>
        <p>{subheading}</p>
      </div>

      <div class="oda-browser-view-controls">
        <div class="oda-browser-layout-switch" aria-label={translate('oda.browser.layout', 'Layout')}>
          <button
            type="button"
            class:is-active={layout === 'list'}
            class:is-focused={focusId === listLayoutFocusId}
            data-focus-id={listLayoutFocusId}
            title={translate('oda.browser.list', 'List')}
            on:click={() => { onFocus(listLayoutFocusId); onSetBrowserLayout('list'); }}
          ><span class="material-symbols-outlined" aria-hidden="true">view_list</span></button>
          <button
            type="button"
            class:is-active={layout === 'grid'}
            class:is-focused={focusId === gridLayoutFocusId}
            data-focus-id={gridLayoutFocusId}
            title={translate('oda.browser.grid', 'Artwork grid')}
            on:click={() => { onFocus(gridLayoutFocusId); onSetBrowserLayout('grid'); }}
          ><span class="material-symbols-outlined" aria-hidden="true">grid_view</span></button>
          {#if medium !== 'music'}
            <button
              type="button"
              class:is-active={layout === 'gallery'}
              class:is-focused={focusId === galleryLayoutFocusId}
              data-focus-id={galleryLayoutFocusId}
              title={translate('oda.browser.gallery', 'Gallery')}
              on:click={() => { onFocus(galleryLayoutFocusId); onSetBrowserLayout('gallery'); }}
            ><span class="material-symbols-outlined" aria-hidden="true">view_quilt</span></button>
          {/if}
        </div>
        <div class="oda-browser-layout-switch oda-browser-zoom" aria-label={translate('oda.browser.zoom', 'Item size')}>
          <button
            type="button"
            class:is-focused={focusId === zoomOutFocusId}
            class:is-disabled={zoomLevel <= 0}
            aria-disabled={zoomLevel <= 0}
            data-focus-id={zoomOutFocusId}
            title={translate('oda.browser.zoomOut', 'Zoom out')}
            on:click={() => { onFocus(zoomOutFocusId); onAdjustZoom(-1); }}
          ><span class="material-symbols-outlined" aria-hidden="true">zoom_out</span></button>
          <button
            type="button"
            class:is-focused={focusId === zoomInFocusId}
            class:is-disabled={zoomLevel >= 4}
            aria-disabled={zoomLevel >= 4}
            data-focus-id={zoomInFocusId}
            title={translate('oda.browser.zoomIn', 'Zoom in')}
            on:click={() => { onFocus(zoomInFocusId); onAdjustZoom(1); }}
          ><span class="material-symbols-outlined" aria-hidden="true">zoom_in</span></button>
        </div>
      </div>
    </header>

    {#if itemCount === 0}
      <div class="oda-placeholder">
        <span class="oda-empty-glyph material-symbols-outlined" aria-hidden="true">{filterIcon(view)}</span>
        <h2>{translate('oda.browse.emptyTitle', 'Nothing to browse')}</h2>
        <p>{translate('oda.browse.empty', 'No library items of this kind have been added.')}</p>
      </div>
    {:else if layout === 'list'}
      <OdaRouteList {rows} {focusId} {listKey} {rowHeight} onActivate={activateFocus} {onFocus} {translate} />
    {:else if layout === 'gallery'}
      <div
        class="oda-browser-grid oda-browser-gallery"
        bind:this={gridViewport}
        style={`--oda-browser-columns: ${columns}`}
      >
        {#each trackItems as track (track.id)}
          {@const trackFocusId = `item:${track.id}`}
          <button
            type="button"
            class="oda-library-tile oda-gallery-tile"
            class:is-focused={focusId === trackFocusId}
            class:is-playing={playingId === track.id}
            data-focus-id={trackFocusId}
            title={track.metadata?.title || track.name}
            aria-label={track.metadata?.title || track.name}
            on:click={() => { onFocus(trackFocusId); onActivateTrack(track.id); }}
          >
            <span class="oda-tile-visual">
              <OdaVisualPreview {track} />
              {#if playingId === track.id}
                <span class="oda-playing-badge material-symbols-outlined" aria-hidden="true">graphic_eq</span>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {:else if medium === 'music'}
      <OdaTrackGrid
        items={trackItems}
        {groups}
        groupIcon={filterIcon(view)}
        {focusId}
        {playingId}
        {columns}
        {listKey}
        {onFocus}
        {onActivateTrack}
        {onOpenGroup}
      />
    {:else}
      <div
        class="oda-browser-grid"
        bind:this={gridViewport}
        style={`--oda-browser-columns: ${columns}`}
      >
          {#each trackItems as track (track.id)}
            {@const trackFocusId = `item:${track.id}`}
            <button
              type="button"
              class="oda-library-tile"
              class:is-focused={focusId === trackFocusId}
              class:is-playing={playingId === track.id}
              data-focus-id={trackFocusId}
              on:click={() => { onFocus(trackFocusId); onActivateTrack(track.id); }}
            >
              <span class="oda-tile-visual">
                <OdaVisualPreview {track} />
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
    {/if}
  </main>
</div>
