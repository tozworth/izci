<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { getCachedVisualThumbnail } from '$lib/services/visual-thumbnail-cache';
  import type { TrackItem } from '$lib/types';
  import { resolveOdaGalleryAspectRatio } from '../oda-browse';
  import { scheduleOdaThumbnailJob, type CancelOdaThumbnailJob } from '../oda-thumbnail-jobs';

  export let track: TrackItem;
  export let maxEdge = 512;
  export let eager = false;
  export let onResolved: (available: boolean) => void = () => {};

  let url: string | null = null;
  let alive = true;
  let host: HTMLElement | null = null;
  let observer: IntersectionObserver | null = null;
  let resolved = false;
  let queued = false;
  let cancelQueued: CancelOdaThumbnailJob | null = null;
  let aspectRatio = 4 / 3;

  onMount(() => {
    if (eager || !host || typeof IntersectionObserver === 'undefined') {
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
    const thumbnail = await getCachedVisualThumbnail(track, maxEdge);
    if (!alive) return;
    onResolved(Boolean(thumbnail));
    if (!thumbnail) return;
    aspectRatio = resolveOdaGalleryAspectRatio(thumbnail.width, thumbnail.height);
    url = URL.createObjectURL(thumbnail.blob);
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

<span class="oda-preview-host" bind:this={host} style={`--oda-preview-aspect: ${aspectRatio}`}>
  {#if url}
    <img class="oda-tile-image" src={url} alt="" />
  {:else}
    <span class="oda-tile-placeholder material-symbols-outlined" aria-hidden="true">
      {track.kind === 'video' ? 'movie' : 'image'}
    </span>
  {/if}
</span>
