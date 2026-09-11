<script lang="ts">
  import type { PlaybackSnapshot, VideoFitMode } from '$lib/types';
  import { IMAGE_ZOOM_WHEEL_FACTOR } from '$lib/stores/video-settings';
  import {
    ODA_THEATER_BACK,
    ODA_THEATER_FIT,
    ODA_THEATER_NEXT,
    ODA_THEATER_PLAY_PAUSE,
    ODA_THEATER_PREVIOUS,
    ODA_THEATER_ROTATE,
    ODA_THEATER_SEEK_BACK,
    ODA_THEATER_SEEK_FORWARD,
    ODA_THEATER_ZOOM_IN,
    ODA_THEATER_ZOOM_OUT,
    ODA_THEATER_SEEK_STEP_SECONDS,
    type OdaTheaterKind
  } from '../oda-theater';
  import type { OdaTranslate } from '../oda-translate';

  export let kind: OdaTheaterKind;
  export let focusId: string | null = null;
  export let snapshot: PlaybackSnapshot | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let translate: OdaTranslate;

  export let onTogglePlayback: () => void = () => {};
  export let onStepTrack: (direction: -1 | 1) => void = () => {};
  export let onSeekDelta: (seconds: number) => void = () => {};
  export let onSetFit: (fitMode: VideoFitMode) => void = () => {};
  export let onZoomStep: (factor: number) => void = () => {};
  export let onRotateImage: () => void = () => {};
  export let onBack: () => void = () => {};

  $: playing = snapshot?.state === 'playing';

  function focusClass(id: string): boolean {
    return focusId === id;
  }
</script>

<div class="oda-theater-controls" role="toolbar" aria-label={translate('oda.theater.controls', 'Playback controls')}>
  <button
    type="button"
    class:is-focused={focusClass(ODA_THEATER_PLAY_PAUSE)}
    on:click={onTogglePlayback}
  >
    <span class="material-symbols-outlined" aria-hidden="true">{playing ? 'pause' : 'play_arrow'}</span>
  </button>
  <button
    type="button"
    class:is-focused={focusClass(ODA_THEATER_PREVIOUS)}
    on:click={() => onStepTrack(-1)}
  >
    <span class="material-symbols-outlined" aria-hidden="true">skip_previous</span>
  </button>
  <button
    type="button"
    class:is-focused={focusClass(ODA_THEATER_NEXT)}
    on:click={() => onStepTrack(1)}
  >
    <span class="material-symbols-outlined" aria-hidden="true">skip_next</span>
  </button>

  {#if kind === 'video'}
    <button
      type="button"
      class:is-focused={focusClass(ODA_THEATER_SEEK_BACK)}
      on:click={() => onSeekDelta(-ODA_THEATER_SEEK_STEP_SECONDS)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">replay_10</span>
    </button>
    <button
      type="button"
      class:is-focused={focusClass(ODA_THEATER_SEEK_FORWARD)}
      on:click={() => onSeekDelta(ODA_THEATER_SEEK_STEP_SECONDS)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">forward_10</span>
    </button>
  {:else}
    <button
      type="button"
      class:is-focused={focusClass(ODA_THEATER_ZOOM_OUT)}
      on:click={() => onZoomStep(1 / IMAGE_ZOOM_WHEEL_FACTOR)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">zoom_out</span>
    </button>
    <button
      type="button"
      class:is-focused={focusClass(ODA_THEATER_ZOOM_IN)}
      on:click={() => onZoomStep(IMAGE_ZOOM_WHEEL_FACTOR)}
    >
      <span class="material-symbols-outlined" aria-hidden="true">zoom_in</span>
    </button>
    <button
      type="button"
      class:is-focused={focusClass(ODA_THEATER_ROTATE)}
      on:click={onRotateImage}
    >
      <span class="material-symbols-outlined" aria-hidden="true">rotate_right</span>
    </button>
  {/if}

  <button
    type="button"
    class:is-focused={focusClass(ODA_THEATER_FIT)}
    on:click={() => onSetFit(fitMode === 'contain' ? 'cover' : 'contain')}
  >
    <span class="material-symbols-outlined" aria-hidden="true">
      {fitMode === 'cover' ? 'crop_free' : 'fit_screen'}
    </span>
  </button>
  <button
    type="button"
    class:is-focused={focusClass(ODA_THEATER_BACK)}
    on:click={onBack}
  >
    <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
    <span>{translate('oda.theater.back', 'Back')}</span>
  </button>
</div>
