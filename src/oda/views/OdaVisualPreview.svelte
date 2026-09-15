<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedVisualThumbnail } from '$lib/services/visual-thumbnail-cache';
  import type { TrackItem } from '$lib/types';

  export let track: TrackItem;
  export let maxEdge = 512;
  export let eager = false;
  export let onResolved: (available: boolean) => void = () => {};

  let url: string | null = null;
  let alive = true;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let started = false;

  onMount(() => {
    if (eager || !host || typeof IntersectionObserver === 'undefined') {
      startLoad();
      return;
    }
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) startLoad();
    }, { rootMargin: '320px' });
    observer.observe(host);
  });

  onDestroy(() => {
    alive = false;
    observer?.disconnect();
    if (url) URL.revokeObjectURL(url);
  });

  async function load(): Promise<void> {
    const thumbnail = await getCachedVisualThumbnail(track, maxEdge);
    if (!alive) return;
    onResolved(Boolean(thumbnail));
    if (!thumbnail) return;
    url = URL.createObjectURL(thumbnail.blob);
  }

  function startLoad(): void {
    if (started) return;
    started = true;
    observer?.disconnect();
    void load();
  }
</script>

<span class="oda-preview-host" bind:this={host}>
  {#if url}
    <img class="oda-tile-image" src={url} alt="" />
  {:else}
    <span class="oda-tile-placeholder material-symbols-outlined" aria-hidden="true">
      {track.kind === 'video' ? 'movie' : 'image'}
    </span>
  {/if}
</span>
