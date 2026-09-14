<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import type { TrackItem } from '$lib/types';
  import { odaBrowseTrackId } from '../oda-browse';
  import { ODA_NP_QUEUE } from '../oda-now-playing';
  import { buildOdaTrackDisplayRows } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';
  import { getOdaQueueCountSummary } from '../oda-queue';
  import OdaRouteList from './OdaRouteList.svelte';

  export let items: TrackItem[] = [];
  export let playingId: string | null = null;
  export let focusId: string | null = null;
  export let canMutate = true;
  export let canReorder = true;
  export let translate: OdaTranslate;
  export let onClose: () => void = () => {};
  export let onActivate: (id: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};
  export let onRemove: (id: string) => void = () => {};
  export let onMove: (id: string, direction: -1 | 1) => void = () => {};

  $: rows = buildOdaTrackDisplayRows(items, playingId);
  $: countSummary = getOdaQueueCountSummary(items, translate);

  function trackId(rowFocusId: string): string | null {
    return odaBrowseTrackId(rowFocusId);
  }
</script>

<button
  class="oda-queue-scrim"
  type="button"
  aria-label={translate('oda.queue.close', 'Close queue')}
  on:click={onClose}
  transition:fade={{ duration: 170 }}
></button>

<aside class="oda-queue-flyout" aria-label={translate('oda.cards.queue', 'Queue')} transition:fly={{ x: 96, duration: 190 }}>
  <header class="oda-queue-flyout-header">
    <div>
      <h1>{translate('oda.cards.queue', 'Queue')}</h1>
      <p>{countSummary}</p>
    </div>
    <button
      type="button"
      class:is-focused={focusId === ODA_NP_QUEUE}
      title={translate('oda.queue.close', 'Close queue')}
      aria-label={translate('oda.queue.close', 'Close queue')}
      on:click={() => { onFocus(ODA_NP_QUEUE); onClose(); }}
    >
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
  </header>

  {#if rows.length === 0}
    <div class="oda-queue-flyout-empty">
      <span class="material-symbols-outlined" aria-hidden="true">queue_music</span>
      <h2>{translate('oda.queue.emptyTitle', 'The queue is empty')}</h2>
      <p>{translate('oda.queue.empty', 'Add items from the library to build a queue.')}</p>
    </div>
  {:else}
    <OdaRouteList
      {rows}
      {focusId}
      listKey="playback-queue-flyout"
      canRemove={canMutate}
      canMove={canReorder}
      onActivate={(rowFocusId) => { const id = trackId(rowFocusId); if (id) onActivate(id); }}
      {onFocus}
      onRemove={(rowFocusId) => { const id = trackId(rowFocusId); if (id) onRemove(id); }}
      onMove={(rowFocusId, direction) => { const id = trackId(rowFocusId); if (id) onMove(id, direction); }}
      {translate}
    />
  {/if}
</aside>
