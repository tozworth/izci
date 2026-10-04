<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedArtworkThumbnail } from '$lib/services/artwork-cache';
  import { createThumbnailPresentation } from '$lib/services/thumbnail-presentation';
  import type { TrackItem } from '$lib/types';

  export let tracks: TrackItem[] = [];
  export let icon = 'album';
  let host: HTMLElement | null = null;
  const thumbnail = createThumbnailPresentation(async (signal) => {
    for (const track of tracks) {
      if (signal.aborted) return null;
      const rendition = await getCachedArtworkThumbnail(track, 320);
      if (rendition) return rendition;
    }
    return null;
  });
  onMount(() => thumbnail.observe(host));
  onDestroy(thumbnail.destroy);
</script>

<span class="thumbnail-host" bind:this={host}>
  {#if $thumbnail.url}
    <img class="thumbnail-image" src={$thumbnail.url} alt="" />
  {:else if tracks.length > 0}
    <span class="thumbnail-placeholder thumbnail-brand-glyph" aria-hidden="true"></span>
  {:else}
    <span class="thumbnail-placeholder material-symbols-outlined" aria-hidden="true">{icon}</span>
  {/if}
</span>
