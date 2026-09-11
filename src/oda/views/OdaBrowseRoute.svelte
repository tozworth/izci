<script lang="ts">
  import type { LibraryGroupViewId, TrackItem } from '$lib/types';
  import type { OdaBrowseView } from '$lib/services/oda-session';
  import { isOdaGroupedBrowseView, odaBrowseGroupKey, odaBrowseTrackId, resolveOdaBrowseGroup } from '../oda-browse';
  import { buildOdaGroupDisplayRows, buildOdaTrackDisplayRows } from '../oda-rows';
  import type { OdaTranslate } from '../oda-translate';
  import OdaRouteList from './OdaRouteList.svelte';

  export let view: OdaBrowseView;
  /** Music items only; the caller has already filtered by medium. */
  export let items: TrackItem[] = [];
  export let groupKey: string | null = null;
  export let title = '';
  export let subtitle = '';
  export let focusId: string | null = null;
  export let playingId: string | null = null;
  export let translate: OdaTranslate;
  export let onActivateTrack: (id: string) => void = () => {};
  export let onOpenGroup: (groupKey: string) => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  $: grouped = isOdaGroupedBrowseView(view);
  $: group = grouped && groupKey
    ? resolveOdaBrowseGroup(items, view as LibraryGroupViewId, groupKey)
    : null;
  $: groupItems = group?.items ?? null;
  $: rows = groupItems
    ? buildOdaTrackDisplayRows(groupItems, playingId)
    : grouped
      ? buildOdaGroupDisplayRows(items, view as LibraryGroupViewId)
      : buildOdaTrackDisplayRows(items, playingId);
  $: listKey = `${view}:${groupKey ?? ''}`;

  function handleActivate(rowFocusId: string): void {
    const nextGroupKey = odaBrowseGroupKey(rowFocusId);
    if (nextGroupKey) {
      onOpenGroup(nextGroupKey);
      return;
    }
    const trackId = odaBrowseTrackId(rowFocusId);
    if (trackId) onActivateTrack(trackId);
  }
</script>

<div class="oda-list-route">
  <div class="oda-route-header">
    <h2>{title}</h2>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>

  {#if rows.length === 0}
    <div class="oda-placeholder">
      <h2>{translate('oda.browse.emptyTitle', 'Nothing to browse')}</h2>
      <p>{translate('oda.browse.empty', 'No library items of this kind have been added.')}</p>
    </div>
  {:else}
    <OdaRouteList {rows} {focusId} {listKey} onActivate={handleActivate} {onFocus} {translate} />
  {/if}
</div>
