<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { IMAGE_ZOOM_MIN, IMAGE_ZOOM_WHEEL_FACTOR, stepImageZoom } from '$lib/stores/video-settings';
  import { clampImagePanOffset, imagePan } from '$lib/stores/image-pan';
  import { imageRotation, isSidewaysRotation, rotationFitScale } from '$lib/stores/image-rotation';
  import type { MenuActionItem } from '$lib/types';

  type ImageFitMode = 'contain' | 'cover';

  export let element: HTMLImageElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: ImageFitMode = 'contain';
  export let zoom = IMAGE_ZOOM_MIN;

  const dispatch = createEventDispatcher<{
    toggleTheater: void;
    setFit: ImageFitMode;
    zoomStep: number;
    resetZoom: void;
  }>();

  const ZOOM_STATUS_HIDE_DELAY_MS = 1250;
  const PAN_DRAG_THRESHOLD_PX = 4;
  const PAN_DBLCLICK_SUPPRESSION_MS = 400;

  let host: HTMLDivElement | null = null;
  let attachedElement: HTMLImageElement | null = null;
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let zoomStatusText = '';
  let zoomStatusVisible = false;
  let zoomStatusHideTimer: number | null = null;
  let panning = false;
  let panMoved = false;
  let panStartPoint = { x: 0, y: 0 };
  let lastPanPoint: { x: number; y: number } | null = null;
  let lastPanEndTime = 0;

  $: zoomed = zoom > IMAGE_ZOOM_MIN;

  $: contextMenuItems = [
    {
      id: 'contain',
      label: $t('main.image.fit', { default: 'Fit to window' }),
      icon: fitMode === 'contain' ? 'check' : 'fit_screen'
    },
    {
      id: 'cover',
      label: $t('main.image.fill', { default: 'Fill window' }),
      icon: fitMode === 'cover' ? 'check' : 'crop_free'
    },
    ...(zoomed
      ? [
          {
            id: 'resetZoom',
            label: $t('main.image.resetZoom', { default: 'Reset zoom' }),
            icon: 'zoom_out_map',
            separatorBefore: true
          }
        ]
      : [])
  ] satisfies MenuActionItem[];

  function showZoomStatus(nextZoom: number): void {
    if (zoomStatusHideTimer !== null) {
      window.clearTimeout(zoomStatusHideTimer);
    }
    zoomStatusText = $t('main.image.zoom', { default: 'Zoom {percent}%', values: { percent: Math.round(nextZoom * 100) } });
    zoomStatusVisible = true;
    zoomStatusHideTimer = window.setTimeout(() => {
      zoomStatusVisible = false;
      zoomStatusHideTimer = null;
    }, ZOOM_STATUS_HIDE_DELAY_MS);
  }

  function handleWheel(event: WheelEvent): void {
    if (!element || event.deltaY === 0) {
      return;
    }

    const factor = event.deltaY < 0 ? IMAGE_ZOOM_WHEEL_FACTOR : 1 / IMAGE_ZOOM_WHEEL_FACTOR;
    const nextZoom = stepImageZoom(zoom, factor);
    if (nextZoom === zoom) {
      return;
    }

    showZoomStatus(nextZoom);
    dispatch('zoomStep', factor);
  }

  function openContextMenu(event: MouseEvent): void {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function handleContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'contain' || action === 'cover') {
      dispatch('setFit', action);
    } else if (action === 'resetZoom') {
      dispatch('resetZoom');
    }
  }

  function readPanBounds(): Parameters<typeof clampImagePanOffset>[1] | null {
    if (!host || !attachedElement) {
      return null;
    }

    const sideways = isSidewaysRotation($imageRotation);
    return {
      hostWidth: host.clientWidth,
      hostHeight: host.clientHeight,
      naturalWidth: sideways ? attachedElement.naturalHeight : attachedElement.naturalWidth,
      naturalHeight: sideways ? attachedElement.naturalWidth : attachedElement.naturalHeight,
      fitMode,
      zoom
    };
  }

  function applyViewport(): void {
    if (!attachedElement) {
      return;
    }

    if (!zoomed && $imageRotation === 0) {
      attachedElement.style.transform = '';
      return;
    }

    const bounds = readPanBounds();
    const pan = bounds ? clampImagePanOffset($imagePan, bounds) : $imagePan;
    const fitScale = host && attachedElement
      ? rotationFitScale(
          $imageRotation,
          host.clientWidth,
          host.clientHeight,
          attachedElement.naturalWidth,
          attachedElement.naturalHeight
        )
      : 1;
    const parts: string[] = [];
    if (zoomed) {
      parts.push(`translate(${pan.x}px, ${pan.y}px)`);
    }
    if ($imageRotation !== 0) {
      parts.push(`rotate(${$imageRotation}deg)`);
    }
    if (zoomed || fitScale !== 1) {
      parts.push(`scale(${zoom * fitScale})`);
    }
    attachedElement.style.transform = parts.join(' ');
  }

  function attachElement(): void {
    if (attachedElement && attachedElement !== element && attachedElement.parentElement === host) {
      attachedElement.style.transform = '';
      parkingHost?.appendChild(attachedElement);
    }
    if (host && element && element.parentElement !== host) {
      host.appendChild(element);
    }
    attachedElement = element;
    applyViewport();
    if (element && !(element.complete && element.naturalWidth > 0)) {
      // Natural dimensions arrive after decode; re-clamp the viewport then.
      element.addEventListener('load', applyViewport, { once: true });
    }
  }

  function beginPan(event: PointerEvent): void {
    if (event.pointerType === 'touch' || event.button !== 0 || !zoomed || !host) {
      return;
    }

    panning = true;
    panMoved = false;
    panStartPoint = { x: event.clientX, y: event.clientY };
    lastPanPoint = { x: event.clientX, y: event.clientY };
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; movement still tracks while over the stage.
    }
  }

  function updatePan(event: PointerEvent): void {
    if (!panning || !lastPanPoint || event.pointerType === 'touch') {
      return;
    }

    const deltaX = event.clientX - lastPanPoint.x;
    const deltaY = event.clientY - lastPanPoint.y;
    lastPanPoint = { x: event.clientX, y: event.clientY };
    if (Math.abs(deltaX) + Math.abs(deltaY) === 0) {
      return;
    }
    if (!panMoved && Math.hypot(event.clientX - panStartPoint.x, event.clientY - panStartPoint.y) > PAN_DRAG_THRESHOLD_PX) {
      panMoved = true;
    }

    const bounds = readPanBounds();
    if (!bounds) {
      return;
    }

    const next = clampImagePanOffset({ x: $imagePan.x + deltaX, y: $imagePan.y + deltaY }, bounds);
    if (next.x !== $imagePan.x || next.y !== $imagePan.y) {
      imagePan.set(next);
    }
  }

  function endPan(event: PointerEvent): void {
    if (!panning) {
      return;
    }

    panning = false;
    lastPanPoint = null;
    if (panMoved) {
      lastPanEndTime = Date.now();
    }
    try {
      host?.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore release failures for already-released pointers.
    }
  }

  function handleDoubleClick(): void {
    // A pan gesture ending in a quick second press can surface as a
    // dblclick; don't mistake it for a theater toggle.
    if (Date.now() - lastPanEndTime < PAN_DBLCLICK_SUPPRESSION_MS) {
      return;
    }

    dispatch('toggleTheater');
  }

  $: {
    host;
    element;
    attachElement();
  }

  $: {
    zoom;
    fitMode;
    $imagePan;
    $imageRotation;
    applyViewport();
  }

  onMount(() => {
    // Rotated fit depends on host size, which workspace resizes can change
    // without a window resize; re-fit the viewport then.
    if (typeof ResizeObserver === 'undefined' || !host) {
      return;
    }
    const observer = new ResizeObserver(() => applyViewport());
    observer.observe(host);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    if (zoomStatusHideTimer !== null) {
      window.clearTimeout(zoomStatusHideTimer);
    }
    if (attachedElement?.parentElement === host) {
      attachedElement.style.transform = '';
      parkingHost?.appendChild(attachedElement);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={host}
  class="image-stage"
  class:image-fill={fitMode === 'cover'}
  class:zoomed
  class:panning
  aria-label={$t('main.image.display', { default: 'Image display' })}
  on:wheel|preventDefault={handleWheel}
  on:pointerdown={beginPan}
  on:pointermove={updatePan}
  on:pointerup={endPan}
  on:pointercancel={endPan}
  on:dblclick={handleDoubleClick}
  on:contextmenu|preventDefault|stopPropagation={openContextMenu}
>
  <div
    class="image-zoom-status"
    class:is-visible={zoomStatusVisible}
    aria-live="polite"
  >{zoomStatusText}</div>
</div>

<svelte:window on:resize={applyViewport} />

{#if contextMenuOpen}
  <MenuSurface
    items={contextMenuItems}
    x={contextMenuX}
    y={contextMenuY}
    ariaLabel={$t('main.image.menu', { default: 'Image' })}
    on:action={(event) => handleContextMenuAction(event.detail)}
    on:dismiss={() => (contextMenuOpen = false)}
  />
{/if}

<style>
  .image-stage {
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

  .image-stage :global(img) {
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
    transform-origin: center center;
  }

  .image-stage.image-fill :global(img) {
    object-fit: cover;
  }

  .image-stage.zoomed {
    cursor: grab;
  }

  .image-stage.zoomed.panning {
    cursor: grabbing;
  }

  .image-zoom-status {
    position: absolute;
    top: 0.68rem;
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
      transform 55ms ease-out;
    white-space: nowrap;
  }

  .image-zoom-status.is-visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
</style>
