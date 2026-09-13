<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedArtworkThumbnail } from '$lib/services/artwork-cache';
  import type { TrackItem } from '$lib/types';

  export let tracks: TrackItem[] = [];
  export let icon = 'album';

  let url: string | null = null;
  let alive = true;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let started = false;

  onMount(() => {
    if (!host || typeof IntersectionObserver === 'undefined') {
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
    for (const track of tracks) {
      const thumbnail = await getCachedArtworkThumbnail(track, 320);
      if (!alive) return;
      if (!thumbnail) continue;
      url = URL.createObjectURL(thumbnail.blob);
      return;
    }
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
  {:else if tracks.length > 0}
    <span class="oda-tile-placeholder oda-tile-brand-glyph" aria-hidden="true"></span>
  {:else}
    <span class="oda-tile-placeholder material-symbols-outlined" aria-hidden="true">{icon}</span>
  {/if}
</span>
