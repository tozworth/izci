<script lang="ts">
  import { afterUpdate, createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import type { LibraryViewId } from '$lib/types';
  import { LIBRARY_VIEW_DEFINITIONS } from './library-views';

  export let activeView: LibraryViewId = 'songs';
  export let summary = '';
  export let tooltipDetails: Record<LibraryViewId, string>;
  export let groupLabel = '';
  export let showBack = false;
  export let showSearchInput = false;
  export let searchQuery = '';
  export let searchInputElement: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{
    viewChange: LibraryViewId;
    back: void;
    searchToggle: void;
    searchInput: string;
    searchClose: void;
    openFiles: void;
  }>();

  let previousShowSearchInput = false;

  afterUpdate(async () => {
    if (showSearchInput && !previousShowSearchInput) {
      await tick();
      searchInputElement?.focus();
      searchInputElement?.select();
    }

    previousShowSearchInput = showSearchInput;
  });

  function handleSearchInput(event: Event) {
    dispatch('searchInput', (event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    dispatch('searchClose');
  }

  function getViewLabel(view: LibraryViewId, fallback: string): string {
    switch (view) {
      case 'favorites': return $t('playlist.library.views.favorites', { default: 'Favorites' });
      case 'songs': return $t('playlist.library.views.songs', { default: 'Songs' });
      case 'artists': return $t('playlist.library.views.artists', { default: 'Artists' });
      case 'albums': return $t('playlist.library.views.albums', { default: 'Albums' });
      case 'genres': return $t('playlist.library.views.genres', { default: 'Genres' });
      case 'years': return $t('playlist.library.views.years', { default: 'Years' });
      case 'formats': return $t('playlist.library.views.formats', { default: 'Formats' });
      case 'folders': return $t('playlist.library.views.folders', { default: 'Folders' });
      default: return fallback;
    }
  }
</script>

<div class="library-header">
  <div class="library-toolbar">
    <div class="library-view-tabs" aria-label={$t('playlist.library.views.label', { default: 'Library views' })} role="tablist">
      {#each LIBRARY_VIEW_DEFINITIONS as view}
        <button
          type="button"
          class="library-toolbar-button library-view-tab hover-tooltip-anchor"
          class:active={activeView === view.id}
          role="tab"
          aria-selected={activeView === view.id}
          aria-label={getViewLabel(view.id, view.label)}
          on:click={() => dispatch('viewChange', view.id)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
          <HoverTooltip align={view.id === 'favorites' ? 'left' : 'center'} nowrap>
            <strong>{getViewLabel(view.id, view.label)}</strong>{#if !showBack && tooltipDetails[view.id]}
              <span class="library-tooltip-detail">{tooltipDetails[view.id]}</span>
            {/if}
          </HoverTooltip>
        </button>
      {/each}
    </div>

    <div class="library-primary-actions">
      <button
        type="button"
        class="library-toolbar-button hover-tooltip-anchor"
        class:active={showSearchInput || searchQuery !== ''}
        aria-label={$t('playlist.library.search', { default: 'Search library' })}
        on:click={() => dispatch('searchToggle')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <HoverTooltip>{$t('playlist.library.search', { default: 'Search library' })}</HoverTooltip>
      </button>
      <button
        type="button"
        class="library-toolbar-button hover-tooltip-anchor"
        aria-label={$t('playlist.addFiles', { default: 'Add files' })}
        on:click={() => dispatch('openFiles')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        <HoverTooltip>{$t('playlist.addFiles', { default: 'Add files' })}</HoverTooltip>
      </button>
    </div>
  </div>

  {#if showSearchInput}
    <div class="library-search-row">
      <span class="material-symbols-outlined" aria-hidden="true">search</span>
      <input
        bind:this={searchInputElement}
        type="search"
        inputmode="search"
        spellcheck="false"
        autocomplete="off"
        placeholder={$t('playlist.searchPlaceholder', { default: 'Search' })}
        aria-label={$t('playlist.library.search', { default: 'Search library' })}
        value={searchQuery}
        on:input={handleSearchInput}
        on:keydown={handleSearchKeydown}
      />
      <button
        type="button"
        class="library-search-close"
        aria-label={$t('playlist.library.closeSearch', { default: 'Close library search' })}
        title={$t('playlist.library.closeSearch', { default: 'Close library search' })}
        on:click={() => dispatch('searchClose')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  {/if}

  {#if showBack}
    <div class="library-location">
      <button
        type="button"
        class="library-back-button"
        aria-label={$t('playlist.library.backToGroups', { default: 'Back to groups' })}
        title={$t('playlist.library.back', { default: 'Back' })}
        on:click={() => dispatch('back')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <span class="library-group-label" title={groupLabel}>{groupLabel}</span>
      <span class="library-location-divider" aria-hidden="true">·</span>
      <span class="panel-summary" title={summary}>{summary}</span>
    </div>
  {/if}
</div>

<style>
  .library-header {
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 0.24rem;
    width: 100%;
  }

  .library-tooltip-detail {
    margin-left: 0.28rem;
  }

  .library-toolbar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    container-type: inline-size;
  }

  .library-toolbar::after {
    content: "";
    position: absolute;
    z-index: 0;
    right: -0.45rem;
    bottom: 0;
    left: -0.45rem;
    height: 1px;
    background: var(--border-soft);
    pointer-events: none;
  }

  .library-view-tabs,
  .library-primary-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.14rem;
  }

  .library-view-tabs {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: flex-start;
    align-self: stretch;
    align-items: flex-end;
    gap: 0;
    padding-inline: 0.08rem;
  }

  .library-view-tabs .library-toolbar-button {
    flex: 1 1 0;
    width: auto;
    min-width: 1.4rem;
    max-width: 2.25rem;
  }

  .library-primary-actions {
    flex-shrink: 0;
    padding-left: 0.22rem;
    border-left: 1px solid var(--border-subtle);
  }

  .library-toolbar-button,
  .library-search-close,
  .library-back-button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.65rem;
    padding: 0;
    color: var(--muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
  }

  .library-toolbar-button:hover,
  .library-toolbar-button.active,
  .library-search-close:hover,
  .library-back-button:hover {
    color: var(--accent-strong);
    background: var(--accent-strong-soft);
  }

  .library-toolbar-button.active {
    box-shadow: none;
  }

  .library-view-tab {
    border-radius: 0;
  }

  .library-view-tab:hover {
    border-radius: 0.36rem 0.36rem 0 0;
  }

  .library-view-tab.active {
    --library-active-tab-background: color-mix(in srgb, var(--bg-elevated) 84%, var(--accent-strong-soft));
    margin-bottom: 0;
    color: var(--accent-strong);
    background: var(--library-active-tab-background);
    border-color: var(--border-soft);
    border-bottom-color: var(--border-soft);
    border-radius: 0.36rem 0.36rem 0 0;
    z-index: 1;
  }

  .library-toolbar-button .material-symbols-outlined,
  .library-back-button .material-symbols-outlined {
    font-size: 1rem;
    line-height: 1;
  }

  .library-search-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    height: 1.5rem;
    padding: 0 0.2rem 0 0.42rem;
    color: var(--muted);
    background: var(--bg-search);
    border: 1px solid var(--border-soft);
    border-radius: 5px;
  }

  .library-search-row:focus-within {
    color: var(--accent-strong);
    border-color: var(--accent-focus-border);
  }

  .library-search-row > .material-symbols-outlined {
    font-size: 0.94rem;
  }

  .library-search-row input {
    width: 100%;
    min-width: 0;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
    font: inherit;
    font-size: 0.8rem;
  }

  .library-search-row input::-webkit-search-cancel-button {
    appearance: none;
  }

  .library-search-close {
    width: 1.35rem;
    height: 1.35rem;
    flex-shrink: 0;
  }

  .library-search-close .material-symbols-outlined {
    font-size: 0.9rem;
  }

  .library-location {
    display: flex;
    align-items: center;
    min-width: 0;
    min-height: 1.2rem;
    gap: 0.28rem;
  }

  .library-back-button {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
  }

  .library-back-button .material-symbols-outlined {
    font-size: 0.88rem;
  }

  .library-group-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-strong);
    font-size: 0.76rem;
    font-weight: 600;
  }

  .library-location-divider,
  .library-location .panel-summary {
    flex-shrink: 0;
  }

  .library-location-divider {
    color: var(--muted);
  }

  @container (max-width: 13rem) {
    .library-toolbar-button {
      width: 1.3rem;
    }

    .library-view-tabs,
    .library-primary-actions {
      gap: 0;
    }

    .library-view-tabs .library-toolbar-button {
      min-width: 1.18rem;
    }
  }
</style>
