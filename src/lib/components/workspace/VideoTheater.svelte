<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { PlaybackSnapshot, VideoFitMode } from '$lib/types';
  import type { VideoSeekFeedback } from './types';
  import ImageViewer from './ImageViewer.svelte';
  import VideoStage from './VideoStage.svelte';

  export let element: HTMLVideoElement | null = null;
  export let imageElement: HTMLImageElement | null = null;
  export let imageMode = false;
  export let parkingHost: HTMLDivElement | null = null;
  export let topInset = 0;
  export let chromeInset = 0;
  export let fitMode: VideoFitMode = 'contain';
  export let imageZoom = 1;
  export let snapshot: PlaybackSnapshot | null = null;
  export let pictureInPictureSupported = false;
  export let seekFeedback: VideoSeekFeedback | null = null;

  const CONTROLS_HIDE_DELAY_MS = 2400;
  const dispatch = createEventDispatcher<{
    controlsHiddenChange: boolean;
    toggleVideoTheater: void;
    togglePictureInPicture: void;
    setVideoFit: VideoFitMode;
    volumeStep: number;
    zoomStep: number;
    resetZoom: void;
  }>();

  let controlsHidden = false;
  let controlsHideTimer: number | null = null;

  function setControlsHidden(hidden: boolean): void {
    if (controlsHidden === hidden) {
      return;
    }

    controlsHidden = hidden;
    dispatch('controlsHiddenChange', hidden);
  }

  function clearControlsHideTimer(): void {
    if (controlsHideTimer === null) {
      return;
    }

    window.clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }

  function scheduleControlsHide(): void {
    clearControlsHideTimer();
    controlsHideTimer = window.setTimeout(() => {
      setControlsHidden(true);
      controlsHideTimer = null;
    }, CONTROLS_HIDE_DELAY_MS);
  }

  function revealControls(): void {
    setControlsHidden(false);
    scheduleControlsHide();
  }

  onMount(() => {
    scheduleControlsHide();

    return () => {
      clearControlsHideTimer();
      dispatch('controlsHiddenChange', false);
    };
  });
</script>

<svelte:window on:pointermove={revealControls} on:keydown={revealControls} />

<section
  class="video-theater"
  class:is-image={imageMode}
  class:is-controls-hidden={controlsHidden}
  style={`top: ${topInset}px; --video-theater-chrome-inset: ${chromeInset}px;`}
  aria-label={imageMode
    ? $t('workspace.imageTheater.title', { default: 'Image theater' })
    : $t('workspace.videoTheater.title', { default: 'Video theater' })}
>
  {#if imageMode}
    <ImageViewer
      element={imageElement}
      {parkingHost}
      {fitMode}
      zoom={imageZoom}
      on:toggleTheater={() => dispatch('toggleVideoTheater')}
      on:setFit={(event) => dispatch('setVideoFit', event.detail)}
      on:zoomStep={(event) => dispatch('zoomStep', event.detail)}
      on:resetZoom={() => dispatch('resetZoom')}
    />
  {:else}
    <VideoStage
      {element}
      {parkingHost}
      {fitMode}
      {snapshot}
      {pictureInPictureSupported}
      {seekFeedback}
      controlsHidden={controlsHidden}
      on:volumeStep={(event) => dispatch('volumeStep', event.detail)}
      on:toggleVideoTheater={() => dispatch('toggleVideoTheater')}
      on:togglePictureInPicture={() => dispatch('togglePictureInPicture')}
      on:setVideoFit={(event) => dispatch('setVideoFit', event.detail)}
    />
  {/if}
</section>

<style>
  .video-theater {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 39;
    overflow: hidden;
    background: #000;
  }

  .video-theater.is-image {
    background: var(--body-background);
  }

  .video-theater.is-controls-hidden {
    cursor: none;
  }
</style>
