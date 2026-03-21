<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import type { PlaylistRepeatMode } from '$lib/types';

  export let panelTitle = 'Playlist';
  export let hideEyebrow = false;
  export let trackSummary = '';
  export let showSearchControl = false;
  export let showSearchInput = false;
  export let searchQuery = '';
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let shuffleEnabled = false;
  export let repeatMode: PlaylistRepeatMode = 'off';
  export let repeatIcon = 'repeat';
  export let repeatLabel = 'Repeat off';
  export let searchInputElement: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{
    searchToggle: void;
    searchInput: string;
    searchClose: void;
    toggleShuffle: void;
    cycleRepeat: void;
    openFiles: void;
  }>();

  let previousShowSearchInput = false;

  afterUpdate(() => {
    if (showSearchInput && !previousShowSearchInput) {
      searchInputElement?.focus();
      searchInputElement?.select();
    }

    previousShowSearchInput = showSearchInput;
  });

  function handleSearchInput(event: Event) {
    dispatch('searchInput', (event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      return;
    }

    event.stopPropagation();
    dispatch('searchClose');
  }
</script>

<div class="playlist-header-main">
  <div class="panel-heading">
    {#if !hideEyebrow}
      <p class="eyebrow">{panelTitle}</p>
    {/if}
    <p class="panel-summary">{trackSummary}</p>
  </div>
  <div class="playlist-actions">
    {#if showSearchControl}
      <button
        type="button"
        class="playlist-action-button"
        class:active={showSearchInput}
        aria-label="Search library"
        title="Search library"
        on:click={() => dispatch('searchToggle')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
      </button>
      {#if showSearchInput}
        <div class="playlist-search-inline">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            bind:this={searchInputElement}
            type="search"
            inputmode="search"
            spellcheck="false"
            autocomplete="off"
            placeholder="Filter library"
            aria-label="Filter library"
            value={searchQuery}
            on:input={handleSearchInput}
            on:keydown={handleSearchKeydown}
          />
          <button
            type="button"
            class="playlist-search-close"
            aria-label="Close library search"
            title="Close library search"
            on:click={() => dispatch('searchClose')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      {/if}
    {/if}
    {#if showShuffleControl}
      <button
        type="button"
        class="playlist-action-button"
        class:active={shuffleEnabled}
        aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
        title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
        on:click={() => dispatch('toggleShuffle')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
      </button>
    {/if}
    {#if showRepeatControl}
      <button
        type="button"
        class="playlist-action-button"
        class:active={repeatMode !== 'off'}
        aria-label={repeatLabel}
        title={repeatLabel}
        on:click={() => dispatch('cycleRepeat')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{repeatIcon}</span>
      </button>
    {/if}
    <button
      type="button"
      class="playlist-add-files"
      aria-label="Add files"
      title="Add files"
      on:click={() => dispatch('openFiles')}
    >
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
    </button>
  </div>
</div>

<style>
  .playlist-header-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    width: 100%;
  }

  .playlist-header-main .panel-heading {
    flex: 1;
    min-width: 0;
  }

  .playlist-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    margin-left: auto;
    flex-shrink: 0;
    justify-content: flex-end;
    position: relative;
  }

  .playlist-action-button,
  .playlist-add-files {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    transition: color 180ms ease;
  }

  .playlist-action-button.active,
  .playlist-action-button:hover,
  .playlist-add-files:hover {
    color: var(--accent-strong);
  }

  .playlist-action-button .material-symbols-outlined,
  .playlist-add-files .material-symbols-outlined {
    font-size: 1.15rem;
    line-height: 1;
  }

  .playlist-search-inline {
    position: absolute;
    right: calc(100% + 0.45rem);
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    width: min(10.25rem, calc(100vw - 7rem));
    padding: 0 0.28rem 0 0.48rem;
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    background: var(--bg-search);
    box-shadow: var(--shadow);
    color: var(--muted);
  }

  .playlist-search-inline:focus-within {
    border-color: var(--accent-focus-border);
    color: var(--accent-strong);
  }

  .playlist-search-inline .material-symbols-outlined {
    font-size: 0.92rem;
    line-height: 1;
  }

  .playlist-search-inline input {
    width: 100%;
    min-width: 0;
    height: 1.72rem;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
    font: inherit;
    font-size: 0.83rem;
  }

  .playlist-search-inline input::-webkit-search-cancel-button {
    appearance: none;
  }

  .playlist-search-inline input::placeholder {
    color: color-mix(in srgb, var(--muted) 82%, transparent);
  }

  .playlist-search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 999px;
  }

  .playlist-search-close:hover {
    color: var(--accent-strong);
    background: var(--accent-strong-soft);
  }

  .playlist-search-close .material-symbols-outlined {
    font-size: 0.9rem;
    line-height: 1;
  }

  @media (max-width: 720px) {
    .playlist-search-inline {
      top: calc(100% + 0.3rem);
      right: 0;
      transform: none;
      width: min(10rem, calc(100vw - 3rem));
    }
  }
</style>
