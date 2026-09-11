<script lang="ts">
  import type { TrackItem } from '$lib/types';
  import { formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import type { OdaTranslate } from '../oda-translate';

  export let title: string;
  export let subtitle = '';
  export let items: TrackItem[] = [];
  export let focusId: string | null = null;
  export let translate: OdaTranslate;
  export let playingId: string | null = null;
  export let emptyTitle = 'Nothing here yet';
  export let emptyMessage = '';
  export let onActivate: (id: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  export function focusIdFor(id: string): string {
    return `item:${id}`;
  }

  function secondary(item: TrackItem): string {
    const artist = item.metadata?.artist?.trim();
    const album = item.metadata?.album?.trim();
    return [artist, album].filter(Boolean).join(' · ');
  }

  function duration(item: TrackItem): string {
    const seconds = item.metadata?.duration;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? formatDuration(seconds)
      : '';
  }
</script>

<div class="oda-list-route">
  <div class="oda-route-header">
    <h2>{title}</h2>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>

  {#if items.length === 0}
    <div class="oda-placeholder">
      <h2>{emptyTitle}</h2>
      <p>{emptyMessage || translate('oda.empty.default', 'There is nothing here yet.')}</p>
    </div>
  {:else}
    <div class="oda-rows">
      {#each items as item (item.id)}
        {@const itemFocusId = focusIdFor(item.id)}
        <button
          type="button"
          class="oda-row"
          class:is-focused={focusId === itemFocusId}
          on:click={() => { onFocus(itemFocusId); onActivate(item.id); }}
        >
          <span class="oda-row-title">
            {getTrackDisplayTitle(item) || item.name}
            {#if playingId === item.id}
              <span class="material-symbols-outlined" aria-hidden="true">graphic_eq</span>
            {/if}
          </span>
          <span class="oda-row-meta">
            {secondary(item)}
            {#if duration(item)} · {duration(item)}{/if}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>
