<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';

  export let element: HTMLVideoElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;

  const dispatch = createEventDispatcher<{
    volumeStep: number;
    toggleVideoTheater: void;
  }>();
  const VOLUME_WHEEL_STEP = 0.05;

  let host: HTMLDivElement | null = null;

  function handleWheel(event: WheelEvent): void {
    if (event.deltaY === 0) {
      return;
    }

    dispatch('volumeStep', event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP);
  }

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
      parkingHost?.appendChild(element);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={host}
  class="video-stage"
  aria-label="Video playback"
  on:wheel|preventDefault={handleWheel}
  on:dblclick={() => dispatch('toggleVideoTheater')}
></div>

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
    contain: strict;
  }

  .video-stage :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #000;
  }
</style>
