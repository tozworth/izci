<script lang="ts">
  import type { TrackItem } from '$lib/types';
  import { buildOdaTrackDisplayRows } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';
  import OdaRouteList from './OdaRouteList.svelte';

  export let title: string;
  export let subtitle = '';
  export let items: TrackItem[] = [];
  export let focusId: string | null = null;
  export let translate: OdaTranslate;
  export let playingId: string | null = null;
  export let listKey = '';
  export let emptyTitle = 'Nothing here yet';
  export let emptyMessage = '';
  export let onActivate: (id: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  $: rows = buildOdaTrackDisplayRows(items, playingId);

  function handleActivate(rowFocusId: string): void {
    if (rowFocusId.startsWith('item:')) onActivate(rowFocusId.slice('item:'.length));
  }
</script>

<div class="oda-list-route">
  <div class="oda-route-header">
    <h2>{title}</h2>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>

  {#if rows.length === 0}
    <div class="oda-placeholder">
      <h2>{emptyTitle}</h2>
      <p>{emptyMessage || translate('oda.empty.default', 'There is nothing here yet.')}</p>
    </div>
  {:else}
    <OdaRouteList {rows} {focusId} {listKey} onActivate={handleActivate} {onFocus} {translate} />
  {/if}
</div>
