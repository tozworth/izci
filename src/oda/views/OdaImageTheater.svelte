<script lang="ts">
  import ImageStage from '$lib/components/workspace/ImageStage.svelte';
  import type { VideoFitMode } from '$lib/types';
  import type { OdaTranslate } from '../oda-translate';
  import OdaTheaterControls from './OdaTheaterControls.svelte';

  export let element: HTMLImageElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let zoom = 1;
  export let focusId: string | null = null;
  export let translate: OdaTranslate;

  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onZoomStep: (factor: number) => void = () => {};
  export let onResetZoom: () => void = () => {};
  export let onRotateImage: () => void = () => {};
  export let onBack: () => void = () => {};
  export let onToggleQueue: () => void = () => {};

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
  <OdaTheaterControls
    kind="image"
    {focusId}
    {fitMode}
    {translate}
    {onTogglePlayback}
    {onStepTrack}
    {onSetFit}
    {onZoomStep}
    {onRotateImage}
    {onToggleQueue}
    {onBack}
  />
</div>
