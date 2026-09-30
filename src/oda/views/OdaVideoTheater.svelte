<script lang="ts">
  import VideoStage from '$lib/components/workspace/VideoStage.svelte';
  import type { PlaybackSnapshot, RepeatMode, TrackItem, VideoFitMode } from '$lib/types';
  import type { VideoSeekFeedback } from '$lib/components/workspace/types';
  import type { OdaTranslate } from '../oda-translate';
  import OdaTheaterControls from './OdaTheaterControls.svelte';

  export let element: HTMLVideoElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let track: TrackItem | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let seekFeedback: VideoSeekFeedback | null = null;
  export let focusId: string | null = null;
  export let translate: OdaTranslate;

  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onToggleShuffle: () => void = () => {};
  export let onCycleRepeat: () => void = () => {};
  export let onSeek: (seconds: number) => void = () => {};
  export let onVolumeStep: (delta: number) => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onToggleQueue: () => void = () => {};
  export let onFocus: (focusId: string) => void = () => {};

</script>

<div class="oda-theater oda-theater-video">
  <VideoStage
    {element}
    {parkingHost}
    {fitMode}
    {snapshot}
    {seekFeedback}
    on:volumeStep={(event) => onVolumeStep(event.detail)}
    on:setVideoFit={(event) => onSetFit(event.detail)}
    on:toggleVideoTheater={() => {}}
  />
  <OdaTheaterControls
    kind="video"
    {track}
    {focusId}
    {snapshot}
    {shuffleEnabled}
    {repeatMode}
    {fitMode}
    {translate}
    {onTogglePlayback}
    {onStepTrack}
    {onToggleShuffle}
    {onCycleRepeat}
    {onSeek}
    {onSetFit}
    {onToggleQueue}
    {onFocus}
  />
</div>
