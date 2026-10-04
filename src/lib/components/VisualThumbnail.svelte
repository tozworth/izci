<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedVisualThumbnail } from '$lib/services/visual-thumbnail-cache';
  import { createThumbnailPresentation } from '$lib/services/thumbnail-presentation';
  import type { TrackItem } from '$lib/types';

  export let track: TrackItem;
  export let maxEdge = 512;
  export let eager = false;
  export let onResolved: (available: boolean) => void = () => {};
  let host: HTMLElement | null = null;
  const thumbnail = createThumbnailPresentation(
    () => getCachedVisualThumbnail(track, maxEdge), (available) => onResolved(available)
  );
  onMount(() => thumbnail.observe(host, eager));
  onDestroy(thumbnail.destroy);
</script>

<span class="thumbnail-host" bind:this={host} style={`--thumbnail-aspect: ${$thumbnail.aspectRatio}`}>
  {#if $thumbnail.url}
    <img class="thumbnail-image" src={$thumbnail.url} alt="" />
  {:else}
    <span class="thumbnail-placeholder material-symbols-outlined" aria-hidden="true">
      {track.kind === 'video' ? 'movie' : 'image'}
    </span>
  {/if}
</span>
