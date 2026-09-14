<script lang="ts">
  import VideoStage from '$lib/components/workspace/VideoStage.svelte';
  import type { PlaybackSnapshot, VideoFitMode } from '$lib/types';
  import type { VideoSeekFeedback } from '$lib/components/workspace/types';
  import type { OdaTranslate } from '../oda-translate';
  import OdaTheaterControls from './OdaTheaterControls.svelte';

  export let element: HTMLVideoElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let snapshot: PlaybackSnapshot | null = null;
  export let pictureInPictureSupported = false;
  export let seekFeedback: VideoSeekFeedback | null = null;
  export let focusId: string | null = null;
  export let translate: OdaTranslate;

  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onVolumeStep: (delta: number) => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onZoomStep: (factor: number) => void = () => {};
  export let onRotateImage: () => void = () => {};
  export let onTogglePictureInPicture: () => void = () => {};
  export let onBack: () => void = () => {};
  export let onToggleQueue: () => void = () => {};

  function handleSeekDelta(seconds: number): void {
    const current = snapshot?.currentTime ?? 0;
    const duration = snapshot?.duration ?? 0;
    const target = duration > 0 ? Math.min(Math.max(current + seconds, 0), duration) : current + seconds;
    onSeek(target);
  }
</script>

<div class="oda-theater oda-theater-video">
  <VideoStage
    {element}
    {parkingHost}
    {fitMode}
    {snapshot}
    {pictureInPictureSupported}
    {seekFeedback}
    on:volumeStep={(event) => onVolumeStep(event.detail)}
    on:togglePictureInPicture={onTogglePictureInPicture}
    on:setVideoFit={(event) => onSetFit(event.detail)}
    on:toggleVideoTheater={() => {}}
  />
  <OdaTheaterControls
    kind="video"
    {focusId}
    {snapshot}
    {fitMode}
    {translate}
    {onTogglePlayback}
    {onStepTrack}
    onSeekDelta={handleSeekDelta}
    {onSetFit}
    {onZoomStep}
    {onRotateImage}
    {onToggleQueue}
    {onBack}
  />
</div>
