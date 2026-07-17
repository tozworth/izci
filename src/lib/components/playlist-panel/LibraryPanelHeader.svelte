<script lang="ts">
  import { afterUpdate, createEventDispatcher, tick } from 'svelte';
  import type { LibraryViewId } from '$lib/types';
  import { LIBRARY_VIEW_DEFINITIONS } from './library-views';

  export let activeView: LibraryViewId = 'songs';
  export let summary = '';
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
</script>

<div class="library-header">
  <div class="library-toolbar">
    <div class="library-view-tabs" aria-label="Library views" role="tablist">
      {#each LIBRARY_VIEW_DEFINITIONS as view}
        <button
          type="button"
          class="library-toolbar-button"
          class:active={activeView === view.id}
          role="tab"
          aria-selected={activeView === view.id}
          aria-label={view.label}
          title={view.label}
          on:click={() => dispatch('viewChange', view.id)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
        </button>
      {/each}
    </div>

    <div class="library-primary-actions">
      <button
        type="button"
        class="library-toolbar-button"
        class:active={showSearchInput || searchQuery !== ''}
        aria-label="Search library"
        title="Search library"
        on:click={() => dispatch('searchToggle')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
      </button>
      <button
        type="button"
        class="library-toolbar-button"
        aria-label="Add files"
        title="Add files"
        on:click={() => dispatch('openFiles')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
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
        placeholder="Search"
        aria-label="Search library"
        value={searchQuery}
        on:input={handleSearchInput}
        on:keydown={handleSearchKeydown}
      />
      <button
        type="button"
        class="library-search-close"
        aria-label="Close library search"
        title="Close library search"
        on:click={() => dispatch('searchClose')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </div>
  {/if}

  <div class="library-location">
    {#if showBack}
      <button
        type="button"
        class="library-back-button"
        aria-label="Back to groups"
        title="Back"
        on:click={() => dispatch('back')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      <span class="library-group-label" title={groupLabel}>{groupLabel}</span>
      <span class="library-location-divider" aria-hidden="true">·</span>
    {/if}
    <span class="panel-summary" title={summary}>{summary}</span>
  </div>
</div>

<style>
  .library-header {
    display: flex;
    flex-direction: column;
    gap: 0.36rem;
    width: 100%;
  }

  .library-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    container-type: inline-size;
  }

  .library-view-tabs,
  .library-primary-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.12rem;
  }

  .library-view-tabs {
    flex: 1;
    min-width: 0;
    justify-content: space-between;
  }

  .library-view-tabs .library-toolbar-button {
    flex: 1 1 0;
    width: auto;
    min-width: 1rem;
    max-width: 1.58rem;
  }

  .library-primary-actions {
    flex-shrink: 0;
    padding-left: 0.26rem;
    border-left: 1px solid var(--border-subtle);
  }

  .library-toolbar-button,
  .library-search-close,
  .library-back-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.58rem;
    height: 1.58rem;
    padding: 0;
    color: var(--muted);
    background: transparent;
    border: 0;
    border-radius: 4px;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .library-toolbar-button:hover,
  .library-toolbar-button.active,
  .library-search-close:hover,
  .library-back-button:hover {
    color: var(--accent-strong);
    background: var(--accent-strong-soft);
  }

  .library-toolbar-button.active {
    box-shadow: inset 0 -2px 0 var(--accent-strong);
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
    height: 1.85rem;
    padding: 0 0.26rem 0 0.5rem;
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
      width: 1.35rem;
    }

    .library-view-tabs,
    .library-primary-actions {
      gap: 0;
    }

    .library-view-tabs .library-toolbar-button {
      min-width: 0.85rem;
    }
  }
</style>
