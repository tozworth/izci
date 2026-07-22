<script lang="ts">
  import { onDestroy } from 'svelte';

  export let element: HTMLVideoElement | null = null;

  let host: HTMLDivElement | null = null;

  function attachElement(): void {
    if (host && element && element.parentElement !== host) {
      host.appendChild(element);
    }
  }

  $: {
    host;
    element;
    attachElement();
  }

  onDestroy(() => {
    if (element?.parentElement === host) {
      element.remove();
    }
  });
</script>

<div bind:this={host} class="video-stage" aria-label="Video playback"></div>

<style>
  .video-stage {
    position: absolute;
    inset: 0;
    z-index: 7;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #000;
  }

  .video-stage :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
</style>
