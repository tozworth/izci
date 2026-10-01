<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    clampWaveformScrollStart,
    normalizeWaveformZoom,
    waveformViewportDuration,
    zoomWaveformViewport
  } from './waveform-viewport';
  import type { AudioDocument } from './audio-document';
  import { createWaveformRenderer, formatWaveformTime } from './waveform-renderer';

  export let audio: AudioDocument | null = null;
  export let selectionStart = 0;
  export let selectionEnd = 0;
  export let playhead = 0;
  export let playbackPosition: (() => number) | null = null;
  export let disabled = false;
  export let twoChannelView = false;
  export let zoom = 1;
  export let scrollStart = 0;
  export let waveformLabel = '';
  export let overviewLabel = '';

  const dispatch = createEventDispatcher<{
    selection: { start: number; end: number };
    seek: number;
    error: unknown;
  }>();

  let canvas: HTMLCanvasElement;
  let waveformLayer: HTMLCanvasElement;
  let overviewCanvas: HTMLCanvasElement;
  let overviewWaveformLayer: HTMLCanvasElement;
  let mainCursor: HTMLDivElement;
  let overviewCursor: HTMLDivElement;
  let renderer: ReturnType<typeof createWaveformRenderer> | null = null;
  let preparing = false;
  let dragMode: 'start' | 'end' | 'new' | null = null;
  let dragOrigin = 0;
  let dragRect: DOMRect | null = null;
  let overviewDragRect: DOMRect | null = null;
  let selectionFrame = 0;
  let seekFrame = 0;
  let pendingSeek: number | null = null;
  let pendingSelection: { start: number; end: number } | null = null;
  let overviewDragMode: 'viewport' | 'seek' | null = null;
  let overviewPointerOrigin = 0;
  let overviewScrollOrigin = 0;
  let overviewPointerMoved = false;

  $: duration = audio?.duration ?? 0;
  $: normalizedZoom = normalizeWaveformZoom(zoom);
  $: visibleDuration = waveformViewportDuration(duration, normalizedZoom);
  $: clampedScrollStart = clampWaveformScrollStart(scrollStart, duration, normalizedZoom);
  $: visibleEnd = Math.min(duration, clampedScrollStart + visibleDuration);

  function timeAtClientX(clientX: number): number {
    if (!canvas || !audio) return 0;
    const rect = dragRect ?? canvas.getBoundingClientRect();
    const position = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return Math.min(duration, clampedScrollStart + position * visibleDuration);
  }

  function scheduleSelection(start: number, end: number): void {
    selectionStart = start;
    selectionEnd = end;
    pendingSelection = { start, end };
    if (selectionFrame) return;
    selectionFrame = requestAnimationFrame(() => {
      selectionFrame = 0;
      if (!pendingSelection) return;
      dispatch('selection', pendingSelection);
      pendingSelection = null;
    });
  }

  function handlePointerDown(event: PointerEvent): void {
    if (disabled || !audio || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    dragRect = canvas.getBoundingClientRect();
    const time = timeAtClientX(event.clientX);
    const secondsPerTenPixels = visibleDuration * 10 / Math.max(dragRect.width, 1);
    if (Math.abs(time - selectionStart) <= secondsPerTenPixels) dragMode = 'start';
    else if (Math.abs(time - selectionEnd) <= secondsPerTenPixels) dragMode = 'end';
    else {
      dragMode = 'new';
      dragOrigin = time;
      scheduleSelection(time, time);
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (disabled || !dragMode || !audio) return;
    const time = timeAtClientX(event.clientX);
    if (dragMode === 'start') scheduleSelection(Math.min(time, selectionEnd), selectionEnd);
    else if (dragMode === 'end') scheduleSelection(selectionStart, Math.max(time, selectionStart));
    else scheduleSelection(Math.min(dragOrigin, time), Math.max(dragOrigin, time));
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragMode) return;
    handlePointerMove(event);
    const time = timeAtClientX(event.clientX);
    const selection = pendingSelection;
    cancelSelection();
    if (selection) dispatch('selection', selection);
    if (Math.abs(selectionEnd - selectionStart) < 0.01) dispatch('seek', time);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  function cancelSelection(): void {
    cancelAnimationFrame(selectionFrame);
    selectionFrame = 0;
    pendingSelection = null;
    dragMode = null;
    dragRect = null;
  }

  function scheduleSeek(time: number): void {
    pendingSeek = time;
    if (seekFrame) return;
    seekFrame = requestAnimationFrame(flushSeek);
  }

  function flushSeek(): void {
    cancelAnimationFrame(seekFrame);
    seekFrame = 0;
    if (pendingSeek !== null) dispatch('seek', pendingSeek);
    pendingSeek = null;
  }

  function cancelOverview(): void {
    cancelAnimationFrame(seekFrame);
    seekFrame = 0;
    pendingSeek = null;
    overviewDragMode = null;
    overviewDragRect = null;
  }

  function wheelPixels(event: WheelEvent, delta: number): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * Math.max(canvas.clientWidth, 1);
    return delta;
  }

  function handleWheel(event: WheelEvent): void {
    if (disabled || !audio) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = Math.min(Math.max((event.clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
      const delta = wheelPixels(event, event.deltaY);
      const next = zoomWaveformViewport(scrollStart, duration, zoom, zoom * Math.exp(-delta / 180), anchor);
      zoom = next.zoom;
      scrollStart = next.start;
      return;
    }

    if (normalizedZoom <= 1) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (rawDelta === 0) return;
    event.preventDefault();
    const delta = wheelPixels(event, rawDelta);
    scrollStart = clampWaveformScrollStart(
      scrollStart + delta / Math.max(canvas.clientWidth, 1) * visibleDuration,
      duration,
      normalizedZoom
    );
  }

  function overviewTimeAtClientX(clientX: number): number {
    if (!overviewCanvas || duration <= 0) return 0;
    const rect = overviewDragRect ?? overviewCanvas.getBoundingClientRect();
    const position = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return position * duration;
  }

  function seekFromOverview(clientX: number, recenter = true): void {
    const time = overviewTimeAtClientX(clientX);
    scheduleSeek(time);
    if (recenter && normalizedZoom > 1 && (time < clampedScrollStart || time > visibleEnd)) {
      scrollStart = clampWaveformScrollStart(time - visibleDuration / 2, duration, normalizedZoom);
    }
  }

  function handleOverviewPointerDown(event: PointerEvent): void {
    if (disabled || !audio || duration <= 0 || event.button !== 0) return;
    overviewCanvas.focus();
    overviewCanvas.setPointerCapture(event.pointerId);
    const rect = overviewCanvas.getBoundingClientRect();
    overviewDragRect = rect;
    const viewportStartX = clampedScrollStart / duration * rect.width;
    const viewportEndX = visibleEnd / duration * rect.width;
    const localX = event.clientX - rect.left;
    overviewPointerOrigin = event.clientX;
    overviewScrollOrigin = clampedScrollStart;
    overviewPointerMoved = false;
    overviewDragMode = normalizedZoom > 1 && localX >= viewportStartX && localX <= viewportEndX
      ? 'viewport'
      : 'seek';
    if (overviewDragMode === 'seek') seekFromOverview(event.clientX);
  }

  function handleOverviewPointerMove(event: PointerEvent): void {
    if (disabled || !overviewDragMode || !audio) return;
    const rect = overviewDragRect ?? overviewCanvas.getBoundingClientRect();
    const deltaX = event.clientX - overviewPointerOrigin;
    if (Math.abs(deltaX) > 3) overviewPointerMoved = true;
    if (overviewDragMode === 'viewport') {
      scrollStart = clampWaveformScrollStart(
        overviewScrollOrigin + deltaX / Math.max(rect.width, 1) * duration,
        duration,
        normalizedZoom
      );
      return;
    }
    seekFromOverview(event.clientX);
  }

  function handleOverviewPointerUp(event: PointerEvent): void {
    if (!overviewDragMode) return;
    handleOverviewPointerMove(event);
    if (overviewDragMode === 'viewport' && !overviewPointerMoved) seekFromOverview(event.clientX, false);
    flushSeek();
    overviewDragMode = null;
    overviewDragRect = null;
    if (overviewCanvas.hasPointerCapture(event.pointerId)) overviewCanvas.releasePointerCapture(event.pointerId);
  }

  function handleOverviewKeydown(event: KeyboardEvent): void {
    if (disabled || !audio || duration <= 0) return;
    const seekStep = Math.max(0.001, duration / (event.altKey ? 1_000 : 100));
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const next = Math.max(0, Math.min(duration, playhead + seekStep * direction));
      dispatch('seek', next);
      if (normalizedZoom > 1 && (next < clampedScrollStart || next > visibleEnd)) {
        scrollStart = clampWaveformScrollStart(next - visibleDuration / 2, duration, normalizedZoom);
      }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : duration;
      dispatch('seek', next);
      if (normalizedZoom > 1) scrollStart = clampWaveformScrollStart(next - visibleDuration / 2, duration, normalizedZoom);
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (disabled || !audio) return;
    const step = Math.max(0.001, visibleDuration / (event.altKey ? 1_000 : 100));
    let position: number | null = null;
    if (event.key === 'ArrowLeft') position = playhead - step;
    else if (event.key === 'ArrowRight') position = playhead + step;
    else if (event.key === 'Home') position = 0;
    else if (event.key === 'End') position = duration;
    else if (event.key === 'PageUp' && normalizedZoom > 1) {
      scrollStart = clampWaveformScrollStart(scrollStart - visibleDuration * 0.8, duration, normalizedZoom);
    } else if (event.key === 'PageDown' && normalizedZoom > 1) {
      scrollStart = clampWaveformScrollStart(scrollStart + visibleDuration * 0.8, duration, normalizedZoom);
    } else return;
    event.preventDefault();
    if (position === null) return;
    position = Math.max(0, Math.min(duration, position));
    if (event.shiftKey) dispatch('selection', { start: Math.min(playhead, position), end: Math.max(playhead, position) });
    dispatch('seek', position);
  }

  onMount(() => {
    renderer = createWaveformRenderer(
      waveformLayer, canvas, mainCursor, overviewWaveformLayer, overviewCanvas, overviewCursor,
      (busy) => { preparing = busy; }, (error) => dispatch('error', error)
    );
    return () => {
      renderer?.destroy();
      renderer = null;
      cancelAnimationFrame(selectionFrame);
      cancelAnimationFrame(seekFrame);
    };
  });

  $: renderer?.update({
    document: audio, selectionStart, selectionEnd, playhead, zoom, scrollStart, twoChannelView, playbackPosition
  });

  $: if (disabled) { cancelSelection(); cancelOverview(); }

</script>

<div class="waveform-editor" class:disabled>
  <div class="waveform-surface">
    <canvas bind:this={waveformLayer} class="waveform-layer" aria-hidden="true"></canvas>
    <canvas
      bind:this={canvas}
      class="waveform-overlay"
      tabindex="0"
      aria-label={waveformLabel || $t('editor.clip.waveform', { default: 'Editable audio waveform and selection' })}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={cancelSelection}
      on:lostpointercapture={cancelSelection}
      on:wheel={handleWheel}
      on:keydown={handleKeydown}
      on:dblclick={() => { if (!disabled) dispatch('selection', { start: 0, end: duration }); }}
      aria-disabled={disabled}
    >{waveformLabel || $t('editor.clip.waveform', { default: 'Editable audio waveform and selection' })}</canvas>
    <div bind:this={mainCursor} class="waveform-cursor" aria-hidden="true" hidden></div>
    {#if preparing}<span class="waveform-preparing" role="status">{$t('editor.clip.preparingWaveform', { default: 'Preparing waveform...' })}</span>{/if}
  </div>
  <div class="waveform-overview" class:dragging={overviewDragMode === 'viewport'}>
    <canvas bind:this={overviewWaveformLayer} class="overview-waveform-layer" aria-hidden="true"></canvas>
    <canvas
      bind:this={overviewCanvas}
      class="overview-overlay"
      tabindex="0"
      role="slider"
      aria-label={overviewLabel || $t('editor.clip.waveformOverview', { default: 'Full waveform overview and seek bar' })}
      aria-disabled={disabled}
      aria-valuemin="0"
      aria-valuemax={duration}
      aria-valuenow={playhead}
      aria-valuetext={formatWaveformTime(playhead, 0.1)}
      on:pointerdown={handleOverviewPointerDown}
      on:pointermove={handleOverviewPointerMove}
      on:pointerup={handleOverviewPointerUp}
      on:pointercancel={cancelOverview}
      on:lostpointercapture={cancelOverview}
      on:keydown={handleOverviewKeydown}
      on:dblclick={() => { if (!disabled) { zoom = 1; scrollStart = 0; } }}
    >{overviewLabel || $t('editor.clip.waveformOverview', { default: 'Full waveform overview and seek bar' })}</canvas>
    <div bind:this={overviewCursor} class="waveform-cursor overview-cursor" aria-hidden="true" hidden></div>
  </div>
</div>

<style>
  .waveform-editor {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) 3rem;
    width: 100%;
    height: 100%;
    min-height: 190px;
    --waveform-background: color-mix(in srgb, var(--bg-input) 90%, black);
    --waveform-color: color-mix(in srgb, var(--accent-strong) 82%, var(--muted));
    --waveform-zero: var(--border);
    --waveform-grid: color-mix(in srgb, var(--border) 54%, transparent);
    --waveform-ruler: color-mix(in srgb, var(--muted) 82%, transparent);
    --waveform-selection: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    --waveform-handle: var(--accent-strong);
    --waveform-playhead: #efb34f;
    --waveform-overview-background: color-mix(in srgb, var(--bg-input) 94%, black);
    --waveform-overview-color: color-mix(in srgb, var(--accent-strong) 46%, var(--muted));
    --waveform-overview-selection: color-mix(in srgb, var(--accent-strong) 22%, transparent);
    --waveform-overview-outside: rgb(0 0 0 / 52%);
    --waveform-overview-viewport: color-mix(in srgb, var(--accent-strong) 72%, var(--text-strong));
  }

  .waveform-cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: var(--waveform-playhead);
    pointer-events: none;
    will-change: transform;
  }

  .waveform-cursor::before {
    content: '';
    position: absolute;
    top: 0;
    left: -4px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-top: 6px solid var(--waveform-playhead);
  }

  .overview-cursor::before { display: none; }

  .waveform-preparing {
    position: absolute;
    right: 8px;
    top: 8px;
    padding: 2px 5px;
    background: var(--waveform-background);
    color: var(--muted);
    font-size: 0.7rem;
    pointer-events: none;
  }

  .waveform-surface {
    position: relative;
    min-height: 0;
    contain: strict;
  }

  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
  }

  .waveform-layer {
    pointer-events: none;
  }

  .waveform-overlay {
    touch-action: none;
    cursor: crosshair;
    outline: 0;
  }

  .waveform-overlay:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-focus-border);
  }

  .waveform-overview {
    position: relative;
    min-height: 0;
    background: var(--waveform-overview-background);
    border-top: 1px solid var(--border-soft);
    box-shadow: inset 0 1px color-mix(in srgb, var(--border-soft) 45%, transparent);
  }

  .overview-waveform-layer {
    pointer-events: none;
  }

  .overview-overlay {
    cursor: crosshair;
    touch-action: none;
    outline: 0;
  }

  .waveform-overview.dragging .overview-overlay {
    cursor: grabbing;
  }

  .overview-overlay:focus-visible {
    box-shadow: inset 0 0 0 1px var(--accent-focus-border);
  }

  .waveform-editor.disabled {
    opacity: 0.55;
  }

  .waveform-editor.disabled .waveform-overlay,
  .waveform-editor.disabled .overview-overlay {
    cursor: default;
  }
</style>
