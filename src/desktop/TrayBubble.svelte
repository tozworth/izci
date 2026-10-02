<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { createTrayBubblePresenter } from './tray-bubble-presenter';
  import type { TrackBubble } from './tray-bubble-protocol';

  let track: TrackBubble | null = null;
  let visible = false;
  let bubble: HTMLDivElement;

  onMount(() => createTrayBubblePresenter(
    (next, shown) => { track = next; visible = shown; },
    async () => {
      await tick();
      await document.fonts.ready;
      // Measure independently of the previous track's native window width.
      bubble.style.maxWidth = '440px';
      const bounds = bubble.getBoundingClientRect();
      const size = { width: Math.ceil(bounds.width) + 1, height: Math.ceil(bounds.height) };
      bubble.style.removeProperty('max-width');
      return size;
    },
  ));
</script>

<div bind:this={bubble} class="track-bubble" class:visible role="status" aria-live="polite">
  <span class="izci-glyph" aria-hidden="true"></span>
  <span class="track-info"><strong class="title">{track?.title ?? ''}</strong>{#if track?.artist}<span class="artist">{track.artist}</span>{/if}</span>
</div>
