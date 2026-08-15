<script lang="ts">
  import { afterUpdate, createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { RepeatMode } from '$lib/types';

  export let panelTitle = 'Queue';
  export let hideEyebrow = false;
  export let trackSummary = '';
  export let showSearchControl = false;
  export let showSearchInput = false;
  export let searchQuery = '';
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let repeatIcon = 'repeat';
  export let repeatLabel = 'Repeat off';
  export let readOnly = false;

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

<div class="track-list-header-main">
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
  <div class="track-list-actions">
    {#if showSearchControl}
      {#if showSearchInput}
        <div class="track-list-search-inline">
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
          <input
            bind:this={searchInputElement}
            type="search"
            inputmode="search"
            spellcheck="false"
            autocomplete="off"
            placeholder={$t('library.filter', { default: 'Filter library' })}
            aria-label={$t('library.filter', { default: 'Filter library' })}
            value={searchQuery}
            on:input={handleSearchInput}
            on:keydown={handleSearchKeydown}
          />
          <button
            type="button"
            class="track-list-search-close"
            aria-label={$t('library.closeSearch', { default: 'Close library search' })}
            title={$t('library.closeSearch', { default: 'Close library search' })}
            on:click={() => dispatch('searchClose')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
      {:else}
        <button
          type="button"
          class="queue-action-button"
          aria-label={$t('library.search', { default: 'Search library' })}
          title={$t('library.search', { default: 'Search library' })}
          on:click={() => dispatch('searchToggle')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">search</span>
        </button>
      {/if}
    {/if}
    {#if showShuffleControl}
      <button
        type="button"
        class="queue-action-button"
        class:active={shuffleEnabled}
        class:recently-disabled={shuffleRecentlyDisabled}
        aria-label={shuffleEnabled
          ? $t('queue.shuffle.disable', { default: 'Disable shuffle' })
          : $t('queue.shuffle.enable', { default: 'Enable shuffle' })}
        title={shuffleEnabled
          ? $t('queue.shuffle.on', { default: 'Shuffle on' })
          : $t('queue.shuffle.off', { default: 'Shuffle off' })}
        on:mouseenter={() => (shuffleRecentlyDisabled = false)}
        on:click={toggleShuffle}
      >
        <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
      </button>
    {/if}
    {#if showRepeatControl}
      <button
        type="button"
        class="queue-action-button"
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
    {#if !readOnly}
      <button
        type="button"
        class="track-list-add-files"
        aria-label={$t('queue.addFiles', { default: 'Add files' })}
        title={$t('queue.addFiles', { default: 'Add files' })}
        on:click={() => dispatch('openFiles')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .track-list-header-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.6rem;
    width: 100%;
  }

  .track-list-header-main .panel-heading {
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

  .track-list-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.52rem;
    margin-left: auto;
    flex-shrink: 0;
    justify-content: flex-end;
    position: relative;
  }

  .queue-action-button,
  .track-list-add-files {
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

  .queue-action-button.active,
  .queue-action-button:hover,
  .track-list-add-files:hover {
    color: var(--accent-strong);
  }

  .queue-action-button.recently-disabled,
  .queue-action-button.recently-disabled:hover {
    color: var(--muted);
  }

  .queue-action-button .material-symbols-outlined,
  .track-list-add-files .material-symbols-outlined {
    font-size: 1rem;
    line-height: 1;
  }

  .track-list-search-inline {
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

  .track-list-search-inline:focus-within {
    border-color: var(--accent-focus-border);
    color: var(--accent-strong);
  }

  .track-list-search-inline .material-symbols-outlined {
    font-size: 0.92rem;
    line-height: 1;
  }

  .track-list-search-inline input {
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

  .track-list-search-inline input::-webkit-search-cancel-button {
    appearance: none;
  }

  .track-list-search-inline input::placeholder {
    color: color-mix(in srgb, var(--muted) 82%, transparent);
  }

  .track-list-search-close {
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

  .track-list-search-close:hover {
    color: var(--accent-strong);
    background-color: var(--accent-strong-soft);
  }

  .track-list-search-close .material-symbols-outlined {
    font-size: 0.9rem;
    line-height: 1;
  }

  @media (max-width: 720px) {
    .track-list-search-inline {
      top: calc(100% + 0.3rem);
      right: 0;
      transform: none;
      width: min(10rem, calc(100vw - 3rem));
    }
  }
</style>
