<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { MenuActionItem, PlaybackSnapshot, VideoFitMode } from '$lib/types';
  import type { VideoSeekFeedback } from './types';

  export let element: HTMLVideoElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let snapshot: PlaybackSnapshot | null = null;
  export let pictureInPictureSupported = false;
  export let seekFeedback: VideoSeekFeedback | null = null;
  export let controlsHidden = false;

  const dispatch = createEventDispatcher<{
    volumeStep: number;
    toggleVideoTheater: void;
    togglePictureInPicture: void;
    setVideoFit: VideoFitMode;
  }>();
  const VOLUME_WHEEL_STEP = 0.05;
  const STATUS_HIDE_DELAY_MS = 1250;
  const CENTER_FEEDBACK_HIDE_DELAY_MS = 650;
  const SEEK_STATE_FEEDBACK_SUPPRESSION_TIMEOUT_MS = 5000;

  let host: HTMLDivElement | null = null;
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let statusText = '';
  let statusVisible = false;
  let centerFeedbackIcon: 'play_arrow' | 'pause' | null = null;
  let statusHideTimer: number | null = null;
  let centerFeedbackHideTimer: number | null = null;
  let seekStateFeedbackSuppressionTimer: number | null = null;
  let suppressSeekStateFeedback = false;
  let observedElement: HTMLVideoElement | null = null;
  let observedState: PlaybackSnapshot['state'] | null = null;
  let observedVolume = 0;
  let observedMuted = false;
  let observedSeekFeedbackId = 0;

  $: contextMenuItems = [
    {
      id: 'contain',
      label: $t('main.video.fit', { default: 'Fit to window' }),
      icon: fitMode === 'contain' ? 'check' : 'fit_screen'
    },
    {
      id: 'cover',
      label: $t('main.video.fill', { default: 'Fill window' }),
      icon: fitMode === 'cover' ? 'check' : 'crop_free'
    }
  ] satisfies MenuActionItem[];

  function clearTimer(timer: number | null): void {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  }

  function showStatus(message: string): void {
    clearTimer(statusHideTimer);
    statusText = message;
    statusVisible = true;
    statusHideTimer = window.setTimeout(() => {
      statusVisible = false;
      statusHideTimer = null;
    }, STATUS_HIDE_DELAY_MS);
  }

  function showCenterFeedback(icon: 'play_arrow' | 'pause'): void {
    clearTimer(centerFeedbackHideTimer);
    centerFeedbackIcon = icon;
    centerFeedbackHideTimer = window.setTimeout(() => {
      centerFeedbackIcon = null;
      centerFeedbackHideTimer = null;
    }, CENTER_FEEDBACK_HIDE_DELAY_MS);
  }

  function clearSeekStateFeedbackSuppression(): void {
    clearTimer(seekStateFeedbackSuppressionTimer);
    seekStateFeedbackSuppressionTimer = null;
    suppressSeekStateFeedback = false;
  }

  function suppressStateFeedbackForSeek(): void {
    clearTimer(centerFeedbackHideTimer);
    centerFeedbackHideTimer = null;
    centerFeedbackIcon = null;
    clearTimer(seekStateFeedbackSuppressionTimer);
    suppressSeekStateFeedback = true;
    seekStateFeedbackSuppressionTimer = window.setTimeout(
      clearSeekStateFeedbackSuppression,
      SEEK_STATE_FEEDBACK_SUPPRESSION_TIMEOUT_MS
    );
  }

  function observeSnapshot(nextElement: HTMLVideoElement | null, nextSnapshot: PlaybackSnapshot | null): void {
    if (!nextElement || !nextSnapshot) {
      observedElement = null;
      observedState = null;
      return;
    }

    if (observedElement !== nextElement) {
      observedElement = nextElement;
      observedState = nextSnapshot.state;
      observedVolume = nextSnapshot.volume;
      observedMuted = nextSnapshot.muted;
      observedSeekFeedbackId = seekFeedback?.id ?? 0;
      return;
    }

    if (nextSnapshot.volume !== observedVolume || nextSnapshot.muted !== observedMuted) {
      const percent = nextSnapshot.muted ? 0 : Math.round(nextSnapshot.volume * 100);
      showStatus($t('main.video.volume', {
        default: 'Volume {percent}%',
        values: { percent }
      }));
      observedVolume = nextSnapshot.volume;
      observedMuted = nextSnapshot.muted;
    }

    if (nextSnapshot.state !== observedState) {
      if (
        suppressSeekStateFeedback &&
        (nextSnapshot.state === 'playing' || nextSnapshot.state === 'paused')
      ) {
        clearSeekStateFeedbackSuppression();
      } else if (observedState === 'paused' && nextSnapshot.state === 'playing') {
        showCenterFeedback('play_arrow');
      } else if (observedState === 'playing' && nextSnapshot.state === 'paused') {
        showCenterFeedback('pause');
      }
      observedState = nextSnapshot.state;
    }
  }

  function observeSeekFeedback(nextElement: HTMLVideoElement | null, feedback: VideoSeekFeedback | null): void {
    if (!nextElement || !feedback || feedback.id === observedSeekFeedbackId) {
      return;
    }

    observedSeekFeedbackId = feedback.id;
    clearTimer(centerFeedbackHideTimer);
    centerFeedbackHideTimer = null;
    centerFeedbackIcon = null;
    if (snapshot?.state === 'playing' || snapshot?.state === 'loading') {
      suppressStateFeedbackForSeek();
    }
    const seconds = Math.max(1, Math.round(Math.abs(feedback.deltaSeconds)));
    showStatus(feedback.deltaSeconds >= 0
      ? $t('main.video.seekForward', {
          default: 'Forward {seconds}s',
          values: { seconds }
        })
      : $t('main.video.seekBackward', {
          default: 'Back {seconds}s',
          values: { seconds }
        }));
  }

  function handleWheel(event: WheelEvent): void {
    if (event.deltaY === 0) {
      return;
    }

    dispatch('volumeStep', event.deltaY < 0 ? VOLUME_WHEEL_STEP : -VOLUME_WHEEL_STEP);
  }

  function openContextMenu(event: MouseEvent): void {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function handleContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'contain' || action === 'cover') {
      dispatch('setVideoFit', action);
    }
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
  $: observeSnapshot(element, snapshot);
  $: observeSeekFeedback(element, seekFeedback);

  onDestroy(() => {
    clearTimer(statusHideTimer);
    clearTimer(centerFeedbackHideTimer);
    clearTimer(seekStateFeedbackSuppressionTimer);
    if (element?.parentElement === host) {
      parkingHost?.appendChild(element);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={host}
  class="video-stage"
  class:video-fill={fitMode === 'cover'}
  class:controls-hidden={controlsHidden}
  aria-label={$t('main.video.playback', { default: 'Video playback' })}
  on:wheel|preventDefault={handleWheel}
  on:dblclick={() => dispatch('toggleVideoTheater')}
  on:contextmenu|preventDefault|stopPropagation={openContextMenu}
>
  {#if element && pictureInPictureSupported}
    <button
      type="button"
      class="video-pip-button hover-tooltip-anchor"
      aria-label={$t('main.video.pictureInPicture', { default: 'Picture in Picture' })}
      on:click|stopPropagation={() => dispatch('togglePictureInPicture')}
      on:dblclick|stopPropagation={() => undefined}
    >
      <span class="material-symbols-outlined" aria-hidden="true">picture_in_picture_alt</span>
      <HoverTooltip placement="below" align="right" nowrap>
        {$t('main.video.pictureInPicture', { default: 'Picture in Picture' })}
      </HoverTooltip>
    </button>
  {/if}

  <div
    class="video-status-popup"
    class:is-visible={statusVisible}
    class:with-pip={element && pictureInPictureSupported}
    aria-live="polite"
  >{statusText}</div>

  {#if centerFeedbackIcon}
    <span class="video-center-feedback material-symbols-outlined" aria-hidden="true">
      {centerFeedbackIcon}
    </span>
  {:else if element && snapshot?.state === 'loading' && !suppressSeekStateFeedback}
    <span class="video-center-feedback video-buffering material-symbols-outlined" aria-hidden="true">
      progress_activity
    </span>
  {/if}
</div>

{#if contextMenuOpen}
  <MenuSurface
    items={contextMenuItems}
    x={contextMenuX}
    y={contextMenuY}
    ariaLabel={$t('main.video.menu', { default: 'Video' })}
    on:action={(event) => handleContextMenuAction(event.detail)}
    on:dismiss={() => (contextMenuOpen = false)}
  />
{/if}

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
    position: relative;
    z-index: 0;
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

  .video-stage.video-fill :global(video) {
    object-fit: cover;
  }

  .video-pip-button {
    position: absolute;
    top: calc(var(--video-theater-chrome-inset, 0px) + 0.65rem);
    right: 0.7rem;
    z-index: 3;
    display: grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    padding: 0;
    border: 0;
    border-radius: 0.35rem;
    background: rgba(0, 0, 0, 0.28);
    color: rgba(255, 255, 255, 0.72);
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.78));
    opacity: 0.74;
    cursor: pointer;
    transition:
      color 90ms ease-out,
      background-color 90ms ease-out,
      opacity 160ms ease-out,
      transform 180ms ease-out,
      top 180ms ease-out;
  }

  .video-stage.controls-hidden .video-pip-button {
    top: 0.65rem;
    opacity: 0;
    pointer-events: none;
    transform: translateY(calc(-100% - 1.35rem));
  }

  .video-pip-button:hover,
  .video-pip-button:focus-visible {
    background: rgba(0, 0, 0, 0.58);
    color: #fff;
    opacity: 1;
  }

  .video-pip-button .material-symbols-outlined {
    font-size: 1.2rem;
  }

  .video-status-popup {
    position: absolute;
    top: calc(var(--video-theater-chrome-inset, 0px) + 0.68rem);
    right: 0.7rem;
    z-index: 2;
    width: max-content;
    max-width: min(240px, 70vw);
    padding: 4px 7px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 5px;
    background: var(--menu-popover-bg);
    color: var(--menu-popover-text, var(--text-strong));
    box-shadow: var(--menu-popover-shadow, 0 5px 14px rgba(0, 0, 0, 0.38));
    font-size: 0.68rem;
    font-weight: 400;
    line-height: 1.25;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px) scale(0.98);
    transform-origin: top right;
    transition:
      opacity 55ms ease-out,
      transform 55ms ease-out,
      top 180ms ease-out;
    white-space: nowrap;
  }

  .video-status-popup.with-pip {
    right: 3rem;
  }

  .video-status-popup.is-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .video-stage.controls-hidden .video-status-popup {
    top: 0.68rem;
  }

  .video-center-feedback {
    position: absolute;
    z-index: 2;
    color: rgba(255, 255, 255, 0.72);
    font-size: clamp(3.5rem, 10vmin, 6.5rem);
    font-variation-settings: 'FILL' 1;
    filter:
      drop-shadow(0 0.18rem 0.3rem rgba(0, 0, 0, 0.8))
      drop-shadow(0 0 1.2rem rgba(0, 0, 0, 0.58));
    opacity: 0;
    pointer-events: none;
    animation: video-center-feedback 650ms ease-out;
  }

  .video-buffering {
    opacity: 0.72;
    animation: video-buffering 900ms linear infinite;
  }

  @keyframes video-center-feedback {
    0% { opacity: 0; transform: scale(0.9); }
    18% { opacity: 0.78; transform: scale(1); }
    72% { opacity: 0.78; }
    100% { opacity: 0; }
  }

  @keyframes video-buffering {
    to { transform: rotate(360deg); }
  }
</style>
