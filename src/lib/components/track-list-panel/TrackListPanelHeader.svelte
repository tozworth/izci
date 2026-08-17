<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import type { RepeatMode } from '$lib/types';

  export let panelTitle = 'Queue';
  export let hideEyebrow = false;
  export let trackSummary = '';
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let repeatIcon = 'repeat';
  export let repeatLabel = 'Repeat off';
  export let readOnly = false;

  let shuffleRecentlyDisabled = false;
  let repeatRecentlyDisabled = false;

  const dispatch = createEventDispatcher<{
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

  $: [trackCountSummary = '', trackRuntimeSummary = ''] = trackSummary.split(' · ', 2);
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
    {#if showShuffleControl}
      <button
        type="button"
        class="queue-action-button"
        class:active={shuffleEnabled}
        class:recently-disabled={shuffleRecentlyDisabled}
        aria-label={shuffleEnabled
          ? $t('queue.shuffle.disable', { default: 'Disable shuffle' })
          : $t('queue.shuffle.enable', { default: 'Enable shuffle' })}
        on:mouseenter={() => (shuffleRecentlyDisabled = false)}
        on:click={toggleShuffle}
      >
        <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
        <HoverTooltip align="center" nowrap>{shuffleEnabled
          ? $t('queue.shuffle.on', { default: 'Shuffle on' })
          : $t('queue.shuffle.off', { default: 'Shuffle off' })}</HoverTooltip>
      </button>
    {/if}
    {#if showRepeatControl}
      <button
        type="button"
        class="queue-action-button"
        class:active={repeatMode !== 'off'}
        class:recently-disabled={repeatRecentlyDisabled}
        aria-label={repeatLabel}
        on:mouseenter={() => (repeatRecentlyDisabled = false)}
        on:click={cycleRepeat}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{repeatIcon}</span>
        <HoverTooltip align="center" nowrap>{repeatLabel}</HoverTooltip>
      </button>
    {/if}
    {#if !readOnly}
      <button
        type="button"
        class="track-list-add-files"
        aria-label={$t('queue.addFiles', { default: 'Add files' })}
        on:click={() => dispatch('openFiles')}
      >
        <span class="material-symbols-outlined" aria-hidden="true">add</span>
        <HoverTooltip align="center" nowrap>{$t('queue.addFiles', { default: 'Add files' })}</HoverTooltip>
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
</style>
