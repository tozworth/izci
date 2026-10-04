import { writable } from 'svelte/store';
import { scheduleThumbnailJob, type CancelThumbnailJob } from './thumbnail-jobs';
import { resolveGalleryAspectRatio } from '$lib/utils/thumbnails';

interface Thumbnail {
  blob: Blob;
  width: number;
  height: number;
}

/** Transient, visibility-driven thumbnail loading shared by desktop and Oda. */
export function createThumbnailPresentation(
  load: (signal: AbortSignal) => Promise<Thumbnail | null>,
  onResolved: (available: boolean) => void = () => {}
) {
  const state = writable<{ url: string | null; aspectRatio: number }>({ url: null, aspectRatio: 4 / 3 });
  const controller = new AbortController();
  let alive = true;
  let queued = false;
  let resolved = false;
  let url: string | null = null;
  let observer: IntersectionObserver | null = null;
  let cancelQueued: CancelThumbnailJob | null = null;

  function queueLoad() {
    if (!alive || queued || resolved) return;
    queued = true;
    cancelQueued = scheduleThumbnailJob(async () => {
      cancelQueued = null;
      try {
        const thumbnail = await load(controller.signal);
        if (!alive) return;
        onResolved(Boolean(thumbnail));
        if (thumbnail) {
          url = URL.createObjectURL(thumbnail.blob);
          state.set({ url, aspectRatio: resolveGalleryAspectRatio(thumbnail.width, thumbnail.height) });
        }
      } finally {
        queued = false;
        resolved = true;
        observer?.disconnect();
      }
    });
  }

  return {
    subscribe: state.subscribe,
    observe(host: HTMLElement | null, eager = false) {
      if (eager || !host || typeof IntersectionObserver === 'undefined') { queueLoad(); return; }
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) queueLoad();
        else if (cancelQueued?.()) { cancelQueued = null; queued = false; }
      }, { rootMargin: '320px' });
      observer.observe(host);
    },
    destroy() {
      alive = false;
      controller.abort();
      cancelQueued?.();
      observer?.disconnect();
      if (url) URL.revokeObjectURL(url);
    }
  };
}
