<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import ImageStage from './ImageStage.svelte';
  import { imageSession } from '$lib/services/image-session';
  import { localizePlaybackError } from '$lib/services/transport-actions';
  import { translate } from '$lib/i18n';
  import { IMAGE_ZOOM_BUTTON_FACTOR } from '$lib/stores/video-settings';
  import { rotateImageClockwise } from '$lib/stores/image-rotation';
  import type { VideoFitMode } from '$lib/types';

  export let element: HTMLImageElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: VideoFitMode = 'contain';
  export let zoom = 1;

  const dispatch = createEventDispatcher<{
    toggleTheater: void; setFit: VideoFitMode; zoomStep: number; resetZoom: void;
  }>();

  let viewerHost: HTMLDivElement;

  function handleKeydown(event: KeyboardEvent): void {
    if (!(event.target instanceof Node) || !viewerHost?.contains(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    void imageSession.step(event.key === 'ArrowLeft' ? -1 : 1);
  }
</script>

<svelte:window on:keydown|capture={handleKeydown} />

<div bind:this={viewerHost} class="image-viewer" role="group" aria-label={$t('main.image.display', { default: 'Image display' })}>
  <div class="image-viewer-controls">
    <button type="button" aria-label={$t('main.image.previous', { default: 'Previous image' })} on:click={() => void imageSession.step(-1)}><span class="material-symbols-outlined" aria-hidden="true">skip_previous</span></button>
    <button type="button" aria-label={$t('main.image.next', { default: 'Next image' })} on:click={() => void imageSession.step(1)}><span class="material-symbols-outlined" aria-hidden="true">skip_next</span></button>
    <button type="button" class:active={$imageSession.shuffle} aria-pressed={$imageSession.shuffle} aria-label={$t('main.image.shuffle', { default: 'Shuffle images' })} on:click={imageSession.toggleShuffle}><span class="material-symbols-outlined" aria-hidden="true">shuffle</span></button>
    <button type="button" class:active={$imageSession.repeatMode === 'all'} aria-pressed={$imageSession.repeatMode === 'all'} aria-label={$t('main.image.wrap', { default: 'Wrap image navigation' })} on:click={imageSession.cycleRepeat}><span class="material-symbols-outlined" aria-hidden="true">repeat</span></button>
    <span class="image-viewer-name" title={$imageSession.item?.name}>{$imageSession.item?.name ?? ''}</span>
    <span class="image-viewer-position">{$imageSession.items.findIndex((item) => item.id === $imageSession.item?.id) + 1} / {$imageSession.items.length}</span>
    <button type="button" aria-label={$t('main.image.zoomOut', { default: 'Zoom out' })} on:click={() => dispatch('zoomStep', 1 / IMAGE_ZOOM_BUTTON_FACTOR)}><span class="material-symbols-outlined" aria-hidden="true">zoom_out</span></button>
    <button type="button" aria-label={$t('main.image.resetZoom', { default: 'Reset zoom' })} on:click={() => dispatch('resetZoom')}>{Math.round(zoom * 100)}%</button>
    <button type="button" aria-label={$t('main.image.zoomIn', { default: 'Zoom in' })} on:click={() => dispatch('zoomStep', IMAGE_ZOOM_BUTTON_FACTOR)}><span class="material-symbols-outlined" aria-hidden="true">zoom_in</span></button>
    <button type="button" aria-label={$t('main.player.rotateImage', { default: 'Rotate clockwise' })} on:click={rotateImageClockwise}><span class="material-symbols-outlined" aria-hidden="true">rotate_right</span></button>
    <button type="button" aria-label={$t('main.image.close', { default: 'Close image viewer' })} on:click={imageSession.close}><span class="material-symbols-outlined" aria-hidden="true">close</span></button>
  </div>
  <div class="image-viewer-stage">
    <ImageStage {element} {parkingHost} {fitMode} {zoom} on:toggleTheater on:setFit on:zoomStep on:resetZoom />
    {#if $imageSession.error}
      <div class="image-viewer-notice" role="alert">{$imageSession.error === 'Could not open this image.' ? $t('main.image.openFailed', { default: 'Could not open this image.' }) : localizePlaybackError($imageSession.error, translate)}</div>
    {:else if $imageSession.state === 'loading'}
      <div class="image-viewer-notice" role="status">{$t('main.image.loading', { default: 'Loading image…' })}</div>
    {/if}
  </div>
</div>

<style>
  .image-viewer { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; outline: none; }
  .image-viewer-stage { position: relative; flex: 1; min-height: 0; }
  .image-viewer-notice { position: absolute; inset: 0; display: grid; place-items: center; padding: 1rem; pointer-events: none; }
  .image-viewer-controls { display: flex; align-items: center; gap: 2px; padding: 3px 5px; background: var(--body-background); flex-wrap: wrap; }
  button { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 4px; border: 0; border-radius: 3px; background: transparent; color: inherit; }
  button:hover, button:focus-visible { background: var(--button-hover-background, #8883); }
  button.active { color: var(--accent-strong); }
  .material-symbols-outlined { font-size: 20px; }
  .image-viewer-name { flex: 1; min-width: 30px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-inline: 5px; font-size: 12px; }
  .image-viewer-position { font-size: 11px; opacity: 0.65; margin-inline: 4px; }
</style>
