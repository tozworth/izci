<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { materializeTrackItem } from '$lib/stores/queue-materialization';
  import type { TrackItem } from '$lib/types';

  export let track: TrackItem;

  let url: string | null = track.objectUrl ?? null;
  let ownsUrl = false;
  let alive = true;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let started = false;

  onMount(() => {
    if (url) return;
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
    if (ownsUrl && url) URL.revokeObjectURL(url);
  });

  async function load(): Promise<void> {
    const materialized = await materializeTrackItem(track, false);
    if (!alive || !materialized?.objectUrl) return;
    url = materialized.objectUrl;
    ownsUrl = materialized.objectUrl !== track.objectUrl;
  }

  function startLoad(): void {
    if (started || url) return;
    started = true;
    observer?.disconnect();
    void load();
  }
</script>

<span class="oda-preview-host" bind:this={host}>
  {#if url && track.kind === 'image'}
    <img class="oda-tile-image" src={url} alt="" />
  {:else if url && track.kind === 'video'}
    <video class="oda-tile-image" src={url} muted preload="metadata" playsinline></video>
  {:else}
    <span class="oda-tile-placeholder material-symbols-outlined" aria-hidden="true">
      {track.kind === 'video' ? 'movie' : 'image'}
    </span>
  {/if}
</span>
