<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import VideoStage from './VideoStage.svelte';

  export let element: HTMLVideoElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let topInset = 0;

  const CONTROLS_HIDE_DELAY_MS = 2400;
  const dispatch = createEventDispatcher<{
    controlsHiddenChange: boolean;
    toggleVideoTheater: void;
    volumeStep: number;
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
  class:is-controls-hidden={controlsHidden}
  style={`top: ${topInset}px;`}
  aria-label={$t('workspace.videoTheater.title', { default: 'Video theater' })}
>
  <VideoStage
    {element}
    {parkingHost}
    on:volumeStep={(event) => dispatch('volumeStep', event.detail)}
    on:toggleVideoTheater={() => dispatch('toggleVideoTheater')}
  />
</section>

<style>
  .video-theater {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 45;
    overflow: hidden;
    background: #000;
  }

  .video-theater.is-controls-hidden {
    cursor: none;
  }
</style>
