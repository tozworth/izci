<script lang="ts">
  import { tick } from 'svelte';
  import type { LibraryGroupViewId, OdaSongsLayout, TrackItem } from '$lib/types';
  import type { OdaBrowseView, OdaMedium } from '$lib/services/oda-session';
  import {
    buildOdaBrowseGroupRows,
    isOdaGroupedBrowseView,
    odaBrowserFilterFocusId,
    odaBrowserLayoutFocusId,
    odaBrowseGroupKey,
    odaBrowseTrackId,
    resolveOdaBrowserViews,
    resolveOdaBrowseGroup
  } from '../oda-browse';
  import { buildOdaGroupDisplayRows, buildOdaTrackDisplayRows } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';
  import OdaArtworkThumb from './OdaArtworkThumb.svelte';
  import OdaRouteList from './OdaRouteList.svelte';
  import OdaVisualPreview from './OdaVisualPreview.svelte';

  export let medium: OdaMedium = 'music';
  export let view: OdaBrowseView;
  /** The caller has already filtered this collection by medium. */
  export let items: TrackItem[] = [];
  export let groupKey: string | null = null;
  export let focusId: string | null = null;
  export let playingId: string | null = null;
  export let songsLayout: OdaSongsLayout = 'grid';
  export let translate: OdaTranslate;
  export let onActivateTrack: (id: string) => void = () => {};
  export let onOpenGroup: (groupKey: string) => void = () => {};
  export let onSelectView: (view: OdaBrowseView) => void = () => {};
  export let onSetSongsLayout: (layout: OdaSongsLayout) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  let gridViewport: HTMLElement | null = null;
  const listLayoutFocusId = odaBrowserLayoutFocusId('list');
  const gridLayoutFocusId = odaBrowserLayoutFocusId('grid');

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
  $: layout = songsLayout;
  $: itemCount = groups.length || trackItems.length;
  $: listKey = `${medium}:${view}:${groupKey ?? ''}:${layout}`;
  $: heading = group?.label ?? filterLabel(view);
  $: subheading = group?.secondary || countLabel(itemCount, groups.length > 0);

  $: if (gridViewport && focusId && layout === 'grid') {
    void listKey;
    void tick().then(() => {
      gridViewport
        ?.querySelector(`[data-focus-id="${CSS.escape(focusId ?? '')}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
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

  function trackMeta(track: TrackItem): string {
    return [track.metadata?.artist?.trim(), track.metadata?.album?.trim()]
      .filter(Boolean)
      .join(' · ') || track.extension.toUpperCase();
  }
</script>

<div class="oda-library-browser" class:is-visual={medium !== 'music'}>
  <aside class="oda-browser-sidebar">
    <div class="oda-browser-brand">
      <span class="material-symbols-outlined" aria-hidden="true">library_music</span>
      <div>
        <strong>{translate('oda.browser.library', 'Library')}</strong>
        <span>{medium === 'music'
          ? translate('oda.home.music', 'Music')
          : medium === 'video'
            ? translate('oda.home.videos', 'Videos')
            : translate('oda.home.images', 'Images')}</span>
      </div>
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

      <div class="oda-browser-layout-switch" aria-label={translate('oda.browser.layout', 'Layout')}>
        <button
          type="button"
          class:is-active={songsLayout === 'list'}
          class:is-focused={focusId === listLayoutFocusId}
          data-focus-id={listLayoutFocusId}
          title={translate('oda.browser.list', 'List')}
          on:click={() => { onFocus(listLayoutFocusId); onSetSongsLayout('list'); }}
        ><span class="material-symbols-outlined" aria-hidden="true">view_list</span></button>
        <button
          type="button"
          class:is-active={songsLayout === 'grid'}
          class:is-focused={focusId === gridLayoutFocusId}
          data-focus-id={gridLayoutFocusId}
          title={translate('oda.browser.grid', 'Artwork grid')}
          on:click={() => { onFocus(gridLayoutFocusId); onSetSongsLayout('grid'); }}
        ><span class="material-symbols-outlined" aria-hidden="true">grid_view</span></button>
      </div>
    </header>

    {#if itemCount === 0}
      <div class="oda-placeholder">
        <span class="oda-empty-glyph material-symbols-outlined" aria-hidden="true">{filterIcon(view)}</span>
        <h2>{translate('oda.browse.emptyTitle', 'Nothing to browse')}</h2>
        <p>{translate('oda.browse.empty', 'No library items of this kind have been added.')}</p>
      </div>
    {:else if layout === 'list'}
      <OdaRouteList {rows} {focusId} {listKey} onActivate={activateFocus} {onFocus} {translate} />
    {:else}
      <div class="oda-browser-grid" bind:this={gridViewport}>
        {#if groups.length > 0}
          {#each groups as groupRow (groupRow.focusId)}
            <button
              type="button"
              class="oda-library-tile is-group"
              class:is-focused={focusId === groupRow.focusId}
              data-focus-id={groupRow.focusId}
              on:click={() => { onFocus(groupRow.focusId); onOpenGroup(groupRow.key); }}
            >
              <span class="oda-tile-visual">
                <OdaArtworkThumb
                  tracks={view === 'albums' ? groupRow.items : []}
                  icon={filterIcon(view)}
                />
                <span class="oda-tile-count">{groupRow.count}</span>
              </span>
              <span class="oda-tile-copy">
                <strong>{groupRow.label}</strong>
                {#if groupRow.secondary}<span>{groupRow.secondary}</span>{/if}
              </span>
            </button>
          {/each}
        {:else}
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
                {#if medium === 'music'}
                  <OdaArtworkThumb tracks={[track]} icon={track.kind === 'module' ? 'equalizer' : 'music_note'} />
                {:else}
                  <OdaVisualPreview {track} />
                {/if}
                {#if medium === 'video'}
                  <span class="oda-video-badge material-symbols-outlined" aria-hidden="true">play_arrow</span>
                {/if}
                {#if playingId === track.id}
                  <span class="oda-playing-badge material-symbols-outlined" aria-hidden="true">graphic_eq</span>
                {/if}
              </span>
              <span class="oda-tile-copy">
                <strong>{track.metadata?.title || track.name}</strong>
                <span>{trackMeta(track)}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </main>
</div>
