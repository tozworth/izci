<script lang="ts">
  import ImageStage from '$lib/components/workspace/ImageStage.svelte';
  import type { RepeatMode, TrackItem, VideoFitMode } from '$lib/types';
  import type { OdaTranslate } from '../oda-translate';
  import OdaTheaterControls from './OdaTheaterControls.svelte';

  export let element: HTMLImageElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let track: TrackItem | null = null;
  export let error: string | null = null;
  export let zoom = 1;
  export let focusId: string | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let translate: OdaTranslate;

  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onZoomStep: (factor: number) => void = () => {};
  export let onResetZoom: () => void = () => {};
  export let onToggleQueue: () => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

  let imageFitMode: VideoFitMode = 'contain';
  $: imageFitMode = fitMode === 'cover' ? 'cover' : 'contain';
</script>

<div class="oda-theater oda-theater-image">
  <ImageStage
    {element}
    {parkingHost}
    fitMode={imageFitMode}
    {zoom}
    on:setFit={(event) => onSetFit(event.detail)}
    on:zoomStep={(event) => onZoomStep(event.detail)}
    on:resetZoom={onResetZoom}
    on:toggleTheater={() => {}}
  />
  {#if error}<div class="image-error" role="alert">{error}</div>{/if}
  <OdaTheaterControls
    kind="image"
    {track}
    {focusId}
    {shuffleEnabled}
    {repeatMode}
    {fitMode}
    {translate}
    {onStepTrack}
    {onToggleShuffle}
    {onCycleRepeat}
    {onSetFit}
    {onToggleQueue}
    {onFocus}
  />
</div>

<style>
  .image-error { position: absolute; inset: 0; display: grid; place-items: center; padding: 2rem; pointer-events: none; }
</style>
