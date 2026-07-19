<script lang="ts">
  import { afterUpdate, createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
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

  let shuffleRecentlyDisabled = false;
  let repeatRecentlyDisabled = false;
  export let searchInputElement: HTMLInputElement | null = null;

  const dispatch = createEventDispatcher<{
    searchToggle: void;
    searchInput: string;
    searchClose: void;
    toggleShuffle: void;
    cycleRepeat: void;
    openFiles: void;
  }>();

  function toggleShuffle() {
    shuffleRecentlyDisabled = shuffleEnabled;
    dispatch('toggleShuffle');
  }

  function cycleRepeat() {
    repeatRecentlyDisabled = repeatMode === 'one';
    dispatch('cycleRepeat');
  }

  let previousShowSearchInput = false;

  $: [trackCountSummary = '', trackRuntimeSummary = ''] = trackSummary.split(' · ', 2);

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
    <p class="panel-summary" title={trackSummary}>
      <span class="panel-summary-count">{trackCountSummary}</span>
      {#if trackRuntimeSummary}
        <span class="panel-summary-runtime"> · {trackRuntimeSummary}</span>
      {/if}
    </p>
  </div>
  <div class="playlist-actions">
    {#if showSearchControl}
      {#if showSearchInput}
        <div class="playlist-search-inline">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            bind:this={searchInputElement}
            type="search"
            inputmode="search"
            spellcheck="false"
            autocomplete="off"
            placeholder={$t('playlist.library.filter', { default: 'Filter library' })}
            aria-label={$t('playlist.library.filter', { default: 'Filter library' })}
            value={searchQuery}
            on:input={handleSearchInput}
            on:keydown={handleSearchKeydown}
          />
          <button
            type="button"
            class="playlist-search-close"
            aria-label={$t('playlist.library.closeSearch', { default: 'Close library search' })}
            title={$t('playlist.library.closeSearch', { default: 'Close library search' })}
            on:click={() => dispatch('searchClose')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="playlist-action-button"
          aria-label={$t('playlist.library.search', { default: 'Search library' })}
          title={$t('playlist.library.search', { default: 'Search library' })}
          on:click={() => dispatch('searchToggle')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
        </button>
      {/if}
    {/if}
    {#if showShuffleControl}
      <button
        type="button"
        class="playlist-action-button"
        class:active={shuffleEnabled}
        class:recently-disabled={shuffleRecentlyDisabled}
        aria-label={shuffleEnabled
          ? $t('playlist.shuffle.disable', { default: 'Disable shuffle' })
          : $t('playlist.shuffle.enable', { default: 'Enable shuffle' })}
        title={shuffleEnabled
          ? $t('playlist.shuffle.on', { default: 'Shuffle on' })
          : $t('playlist.shuffle.off', { default: 'Shuffle off' })}
        on:mouseenter={() => (shuffleRecentlyDisabled = false)}
        on:click={toggleShuffle}
      >
        <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
      </button>
    {/if}
    {#if showRepeatControl}
      <button
        type="button"
        class="playlist-action-button"
        class:active={repeatMode !== 'off'}
        class:recently-disabled={repeatRecentlyDisabled}
        aria-label={repeatLabel}
        title={repeatLabel}
        on:mouseenter={() => (repeatRecentlyDisabled = false)}
        on:click={cycleRepeat}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{repeatIcon}</span>
      </button>
    {/if}
    <button
      type="button"
      class="playlist-add-files"
      aria-label={$t('playlist.addFiles', { default: 'Add files' })}
      title={$t('playlist.addFiles', { default: 'Add files' })}
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
    gap: 0.6rem;
    width: 100%;
  }

  .playlist-header-main .panel-heading {
    flex: 1;
    min-width: 0;
    container-type: inline-size;
  }

  .panel-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @container (max-width: 9rem) {
    .panel-summary-runtime {
      display: none;
    }
  }

  .playlist-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.52rem;
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
    transition:
      color 180ms ease,
      background-color 180ms ease;
  }

  .playlist-action-button.active,
  .playlist-action-button:hover,
  .playlist-add-files:hover {
    color: var(--accent-strong);
  }

  .playlist-action-button.recently-disabled,
  .playlist-action-button.recently-disabled:hover {
    color: var(--muted);
  }

  .playlist-action-button .material-symbols-outlined,
  .playlist-add-files .material-symbols-outlined {
    font-size: 1rem;
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
    background-color: var(--bg-search);
    box-shadow: var(--shadow);
    color: var(--muted);
    transition:
      color var(--artwork-ui-transition-duration, 280ms) linear,
      background-color var(--artwork-ui-transition-duration, 280ms) linear,
      border-color var(--artwork-ui-transition-duration, 280ms) linear,
      box-shadow var(--artwork-ui-transition-duration, 280ms) linear;
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
    transition:
      color 180ms ease,
      background-color 180ms ease;
  }

  .playlist-search-close:hover {
    color: var(--accent-strong);
    background-color: var(--accent-strong-soft);
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
