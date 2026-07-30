<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    clampWaveformScrollStart,
    normalizeWaveformZoom,
    waveformViewportDuration,
    zoomWaveformViewport
  } from './waveform-viewport';

  export let buffer: AudioBuffer | null = null;
  export let selectionStart = 0;
  export let selectionEnd = 0;
  export let playhead = 0;
  export let disabled = false;
  export let zoom = 1;
  export let scrollStart = 0;

  const dispatch = createEventDispatcher<{
    selection: { start: number; end: number };
    seek: number;
  }>();

  let canvas: HTMLCanvasElement;
  let waveformLayer: HTMLCanvasElement;
  let resizeObserver: ResizeObserver | null = null;
  let dragMode: 'start' | 'end' | 'new' | null = null;
  let dragOrigin = 0;
  let drawFrame = 0;
  let waveformFrame = 0;
  let selectionFrame = 0;
  let pendingSelection: { start: number; end: number } | null = null;

  $: duration = buffer?.duration ?? 0;
  $: normalizedZoom = normalizeWaveformZoom(zoom);
  $: visibleDuration = waveformViewportDuration(duration, normalizedZoom);
  $: maximumScrollStart = Math.max(0, duration - visibleDuration);
  $: clampedScrollStart = clampWaveformScrollStart(scrollStart, duration, normalizedZoom);
  $: visibleEnd = Math.min(duration, clampedScrollStart + visibleDuration);
  $: navigatorStep = Math.max(0.001, visibleDuration / 500);

  function timeAtClientX(clientX: number): number {
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    const position = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return Math.min(duration, clampedScrollStart + position * visibleDuration);
  }

  function prepareCanvas(): { width: number; height: number; ratio: number } | null {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (waveformLayer && (waveformLayer.width !== width || waveformLayer.height !== height)) {
      waveformLayer.width = width;
      waveformLayer.height = height;
    }
    return { width, height, ratio };
  }

  function timelineStep(seconds: number, width: number): number {
    const targetTicks = Math.max(2, width / 90);
    const rawStep = seconds / targetTicks;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 0.001)));
    const normalized = rawStep / magnitude;
    const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return multiplier * magnitude;
  }

  function formatTimelineTime(value: number, step = 1): string {
    const safeValue = Math.max(0, value);
    const hours = Math.floor(safeValue / 3600);
    const minutes = Math.floor(safeValue % 3600 / 60);
    const seconds = safeValue % 60;
    const fractionDigits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
    const secondsText = seconds.toFixed(fractionDigits).padStart(fractionDigits ? 4 : 2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
      : `${minutes}:${secondsText}`;
  }

  function drawTimeline(context: CanvasRenderingContext2D, width: number, height: number, ratio: number): void {
    if (visibleDuration <= 0) return;
    const styles = getComputedStyle(canvas);
    const step = timelineStep(visibleDuration, width / ratio);
    const firstTick = Math.ceil(clampedScrollStart / step) * step;
    context.strokeStyle = styles.getPropertyValue('--waveform-grid').trim() || 'rgba(255, 255, 255, 0.08)';
    context.fillStyle = styles.getPropertyValue('--waveform-ruler').trim() || '#8d949d';
    context.lineWidth = Math.max(1, ratio);
    context.font = `${10 * ratio}px system-ui, sans-serif`;
    context.textBaseline = 'top';

    for (let time = firstTick; time <= visibleEnd + step * 0.001; time += step) {
      const x = (time - clampedScrollStart) / visibleDuration * width;
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, 0);
      context.lineTo(Math.round(x) + 0.5, height);
      context.stroke();
      context.fillText(formatTimelineTime(time, step), x + 4 * ratio, 4 * ratio);
    }
  }

  function rebuildWaveformLayer(): void {
    const dimensions = prepareCanvas();
    if (!dimensions) return;
    const { width, height, ratio } = dimensions;
    const context = waveformLayer.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(canvas);
    context.fillStyle = styles.getPropertyValue('--waveform-background').trim() || '#17191c';
    context.fillRect(0, 0, width, height);

    if (!buffer || buffer.length === 0 || visibleDuration <= 0) {
      context.strokeStyle = styles.getPropertyValue('--waveform-zero').trim() || '#4b5057';
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      requestDraw();
      return;
    }

    drawTimeline(context, width, height, ratio);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer!.getChannelData(index));
    const firstSample = clampedScrollStart * buffer.sampleRate;
    const samplesPerPixel = visibleDuration * buffer.sampleRate / width;
    const middle = height / 2;
    context.strokeStyle = styles.getPropertyValue('--waveform-color').trim() || '#aeb7c2';
    context.lineWidth = Math.max(1, ratio);
    context.beginPath();
    for (let x = 0; x < width; x += 1) {
      const start = Math.max(0, Math.floor(firstSample + x * samplesPerPixel));
      const end = Math.max(start + 1, Math.min(buffer.length, Math.ceil(firstSample + (x + 1) * samplesPerPixel)));
      let minimum = 1;
      let maximum = -1;
      const stride = Math.max(1, Math.floor((end - start) / 32));
      for (let index = start; index < end; index += stride) {
        let sample = 0;
        for (const channel of channels) sample += channel[index] ?? 0;
        sample /= channels.length;
        minimum = Math.min(minimum, sample);
        maximum = Math.max(maximum, sample);
      }
      context.moveTo(x + 0.5, middle - maximum * middle * 0.82);
      context.lineTo(x + 0.5, middle - minimum * middle * 0.82);
    }
    context.stroke();
    requestDraw();
  }

  function requestWaveformBuild(): void {
    if (waveformFrame) return;
    waveformFrame = requestAnimationFrame(() => {
      waveformFrame = 0;
      rebuildWaveformLayer();
    });
  }

  function draw(): void {
    drawFrame = 0;
    const dimensions = prepareCanvas();
    if (!dimensions) return;
    const { width, height, ratio } = dimensions;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!buffer || buffer.length === 0 || visibleDuration <= 0) return;
    const styles = getComputedStyle(canvas);

    const selectionX = (selectionStart - clampedScrollStart) / visibleDuration * width;
    const selectionWidth = Math.max(0, (selectionEnd - selectionStart) / visibleDuration * width);
    context.fillStyle = styles.getPropertyValue('--waveform-selection').trim() || 'rgba(197, 204, 214, 0.14)';
    context.fillRect(selectionX, 0, selectionWidth, height);
    context.strokeStyle = styles.getPropertyValue('--waveform-handle').trim() || '#d8dee7';
    context.lineWidth = Math.max(1, ratio);
    for (const x of [selectionX, selectionX + selectionWidth]) {
      if (x < 0 || x > width) continue;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    if (playhead >= clampedScrollStart && playhead <= visibleEnd) {
      const x = (playhead - clampedScrollStart) / visibleDuration * width;
      context.strokeStyle = styles.getPropertyValue('--waveform-playhead').trim() || '#efb34f';
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  function requestDraw(): void {
    if (!drawFrame) drawFrame = requestAnimationFrame(draw);
  }

  function scheduleSelection(start: number, end: number): void {
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
    if (disabled || !buffer) return;
    canvas.setPointerCapture(event.pointerId);
    const time = timeAtClientX(event.clientX);
    const secondsPerTenPixels = visibleDuration * 10 / Math.max(canvas.clientWidth, 1);
    if (Math.abs(time - selectionStart) <= secondsPerTenPixels) dragMode = 'start';
    else if (Math.abs(time - selectionEnd) <= secondsPerTenPixels) dragMode = 'end';
    else {
      dragMode = 'new';
      dragOrigin = time;
      dispatch('selection', { start: time, end: time });
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    if (!dragMode || !buffer) return;
    const time = timeAtClientX(event.clientX);
    if (dragMode === 'start') scheduleSelection(Math.min(time, selectionEnd), selectionEnd);
    else if (dragMode === 'end') scheduleSelection(selectionStart, Math.max(time, selectionStart));
    else scheduleSelection(Math.min(dragOrigin, time), Math.max(dragOrigin, time));
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragMode) return;
    canvas.releasePointerCapture(event.pointerId);
    const time = timeAtClientX(event.clientX);
    if (pendingSelection) {
      cancelAnimationFrame(selectionFrame);
      selectionFrame = 0;
      dispatch('selection', pendingSelection);
      pendingSelection = null;
    }
    if (Math.abs(selectionEnd - selectionStart) < 0.01) dispatch('seek', time);
    dragMode = null;
  }

  function wheelPixels(event: WheelEvent, delta: number): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * Math.max(canvas.clientWidth, 1);
    return delta;
  }

  function handleWheel(event: WheelEvent): void {
    if (disabled || !buffer) return;
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

  onMount(() => {
    resizeObserver = new ResizeObserver(requestWaveformBuild);
    resizeObserver.observe(canvas);
    rebuildWaveformLayer();
    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(drawFrame);
      cancelAnimationFrame(waveformFrame);
      cancelAnimationFrame(selectionFrame);
    };
  });

  $: if (canvas) {
    buffer;
    normalizedZoom;
    clampedScrollStart;
    requestWaveformBuild();
  }

  $: if (canvas) {
    selectionStart;
    selectionEnd;
    playhead;
    clampedScrollStart;
    requestDraw();
  }
</script>

<div class="waveform-editor" class:disabled>
  <div class="waveform-surface">
    <canvas bind:this={waveformLayer} class="waveform-layer" aria-hidden="true"></canvas>
    <canvas
      bind:this={canvas}
      class="waveform-overlay"
      aria-label={$t('clipTag.clip.waveform', { default: 'Audio waveform and clip selection' })}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={() => (dragMode = null)}
      on:wheel={handleWheel}
    >{$t('clipTag.clip.waveform', { default: 'Audio waveform and clip selection' })}</canvas>
  </div>
  <div class="waveform-navigator" class:is-hidden={normalizedZoom <= 1}>
    <span>{formatTimelineTime(clampedScrollStart, 0.1)}</span>
    <input
      type="range"
      min="0"
      max={maximumScrollStart}
      step={navigatorStep}
      value={clampedScrollStart}
      disabled={!buffer || normalizedZoom <= 1}
      aria-label={$t('clipTag.clip.scrollWaveform', { default: 'Scroll waveform' })}
      on:input={(event) => (scrollStart = Number(event.currentTarget.value))}
    />
    <span>{formatTimelineTime(visibleEnd, 0.1)}</span>
  </div>
</div>

<style>
  .waveform-editor {
    position: relative;
    display: grid;
    grid-template-rows: minmax(0, 1fr) 1.65rem;
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
  }

  .waveform-surface {
    position: relative;
    min-height: 0;
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
    cursor: text;
  }

  .waveform-navigator {
    display: grid;
    grid-template-columns: 4.6rem minmax(3rem, 1fr) 4.6rem;
    align-items: center;
    gap: 0.42rem;
    padding: 0 0.5rem;
    background: color-mix(in srgb, var(--bg-soft) 72%, var(--bg-input));
    border-top: 1px solid var(--border-soft);
    color: var(--muted);
    font-size: 0.65rem;
    font-variant-numeric: tabular-nums;
  }

  .waveform-navigator span:last-child {
    text-align: right;
  }

  .waveform-navigator input {
    width: 100%;
    height: 1rem;
    margin: 0;
    accent-color: var(--accent-strong);
  }

  .waveform-navigator.is-hidden {
    opacity: 0.48;
  }

  .waveform-editor.disabled {
    opacity: 0.55;
  }

  .waveform-editor.disabled .waveform-overlay {
    cursor: default;
  }
</style>
