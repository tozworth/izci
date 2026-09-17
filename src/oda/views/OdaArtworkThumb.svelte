<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedArtworkThumbnail } from '$lib/services/artwork-cache';
  import type { TrackItem } from '$lib/types';
  import { scheduleOdaThumbnailJob, type CancelOdaThumbnailJob } from '../oda-thumbnail-jobs';

  export let tracks: TrackItem[] = [];
  export let icon = 'album';

  let url: string | null = null;
  let alive = true;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let resolved = false;
  let queued = false;
  let cancelQueued: CancelOdaThumbnailJob | null = null;

  onMount(() => {
    if (!host || typeof IntersectionObserver === 'undefined') {
      queueLoad();
      return;
    }
    observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible) {
        queueLoad();
      } else if (cancelQueued?.()) {
        cancelQueued = null;
        queued = false;
      }
    }, { rootMargin: '320px' });
    observer.observe(host);
  });

  onDestroy(() => {
    alive = false;
    cancelQueued?.();
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

  function queueLoad(): void {
    if (queued || resolved) return;
    queued = true;
    cancelQueued = scheduleOdaThumbnailJob(async () => {
      cancelQueued = null;
      await load();
      queued = false;
      resolved = true;
      observer?.disconnect();
    });
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
