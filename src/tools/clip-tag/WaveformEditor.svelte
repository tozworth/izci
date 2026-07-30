<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    clampWaveformScrollStart,
    normalizeWaveformZoom,
    waveformViewportDuration,
    zoomWaveformViewport
  } from './waveform-viewport';
  import {
    buildWaveformPeakPyramid,
    waveformPeakAt,
    waveformPeakBucketSize,
    type WaveformPeakPyramid
  } from './waveform-peaks';

  export let buffer: AudioBuffer | null = null;
  export let selectionStart = 0;
  export let selectionEnd = 0;
  export let playhead = 0;
  export let disabled = false;
  export let zoom = 1;
  export let scrollStart = 0;
  export let waveformLabel = '';
  export let overviewLabel = '';

  const dispatch = createEventDispatcher<{
    selection: { start: number; end: number };
    seek: number;
  }>();

  let canvas: HTMLCanvasElement;
  let waveformLayer: HTMLCanvasElement;
  let overviewCanvas: HTMLCanvasElement;
  let overviewWaveformLayer: HTMLCanvasElement;
  let resizeObserver: ResizeObserver | null = null;
  let dragMode: 'start' | 'end' | 'new' | null = null;
  let dragOrigin = 0;
  let drawFrame = 0;
  let waveformFrame = 0;
  let overviewDrawFrame = 0;
  let overviewWaveformFrame = 0;
  let selectionFrame = 0;
  let pendingSelection: { start: number; end: number } | null = null;
  let overviewDragMode: 'viewport' | 'seek' | null = null;
  let overviewPointerOrigin = 0;
  let overviewScrollOrigin = 0;
  let overviewPointerMoved = false;
  let peakBuffer: AudioBuffer | null = null;
  let peakPyramid: WaveformPeakPyramid | null = null;

  $: duration = buffer?.duration ?? 0;
  $: normalizedZoom = normalizeWaveformZoom(zoom);
  $: visibleDuration = waveformViewportDuration(duration, normalizedZoom);
  $: clampedScrollStart = clampWaveformScrollStart(scrollStart, duration, normalizedZoom);
  $: visibleEnd = Math.min(duration, clampedScrollStart + visibleDuration);

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

  function prepareOverviewCanvas(): { width: number; height: number; ratio: number } | null {
    if (!overviewCanvas) return null;
    const rect = overviewCanvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio));
    const height = Math.max(1, Math.round(rect.height * ratio));
    if (overviewCanvas.width !== width || overviewCanvas.height !== height) {
      overviewCanvas.width = width;
      overviewCanvas.height = height;
    }
    if (overviewWaveformLayer && (overviewWaveformLayer.width !== width || overviewWaveformLayer.height !== height)) {
      overviewWaveformLayer.width = width;
      overviewWaveformLayer.height = height;
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

  function peaksForBuffer(audioBuffer: AudioBuffer): WaveformPeakPyramid {
    if (peakBuffer !== audioBuffer || !peakPyramid) {
      peakBuffer = audioBuffer;
      peakPyramid = buildWaveformPeakPyramid(
        Array.from({ length: audioBuffer.numberOfChannels }, (_, index) => audioBuffer.getChannelData(index))
      );
    }
    return peakPyramid;
  }

  function drawWaveformChannels(
    context: CanvasRenderingContext2D,
    audioBuffer: AudioBuffer,
    width: number,
    height: number,
    firstSample: number,
    samplesPerPixel: number,
    amplitude: number
  ): void {
    const peaks = peaksForBuffer(audioBuffer);
    const bucketSize = waveformPeakBucketSize(samplesPerPixel);
    const firstBucket = Math.floor(firstSample / bucketSize) * bucketSize;
    const finalSample = Math.min(audioBuffer.length, firstSample + width * samplesPerPixel);
    const finalBucket = Math.ceil(finalSample / bucketSize) * bucketSize;
    const laneHeight = height / audioBuffer.numberOfChannels;

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      const middle = laneHeight * channelIndex + laneHeight / 2;
      context.beginPath();
      for (let bucketStart = firstBucket; bucketStart < finalBucket; bucketStart += bucketSize) {
        if (bucketStart < 0 || bucketStart >= audioBuffer.length) continue;
        const { minimum, maximum } = waveformPeakAt(peaks, channelIndex, bucketStart, bucketSize);
        const bucketEnd = Math.min(audioBuffer.length, bucketStart + bucketSize);
        const x = ((bucketStart + bucketEnd) / 2 - firstSample) / samplesPerPixel;
        context.moveTo(x, middle - maximum * laneHeight * amplitude);
        context.lineTo(x, middle - minimum * laneHeight * amplitude);
      }
      context.stroke();
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
    const firstSample = clampedScrollStart * buffer.sampleRate;
    const samplesPerPixel = visibleDuration * buffer.sampleRate / width;
    const laneHeight = height / buffer.numberOfChannels;
    context.strokeStyle = styles.getPropertyValue('--waveform-color').trim() || '#aeb7c2';
    context.lineWidth = Math.max(1, ratio);
    drawWaveformChannels(context, buffer, width, height, firstSample, samplesPerPixel, 0.38);
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
      const middle = laneHeight * channelIndex + laneHeight / 2;
      context.strokeStyle = styles.getPropertyValue('--waveform-zero').trim() || '#4b5057';
      context.globalAlpha = 0.5;
      context.beginPath();
      context.moveTo(0, Math.round(middle) + 0.5);
      context.lineTo(width, Math.round(middle) + 0.5);
      context.stroke();
      context.globalAlpha = 1;
      context.strokeStyle = styles.getPropertyValue('--waveform-color').trim() || '#aeb7c2';
    }
    requestDraw();
  }

  function requestWaveformBuild(): void {
    if (waveformFrame) return;
    waveformFrame = requestAnimationFrame(() => {
      waveformFrame = 0;
      rebuildWaveformLayer();
    });
  }

  function rebuildOverviewWaveform(): void {
    const dimensions = prepareOverviewCanvas();
    if (!dimensions) return;
    const { width, height, ratio } = dimensions;
    const context = overviewWaveformLayer.getContext('2d');
    if (!context) return;
    const styles = getComputedStyle(overviewCanvas);
    context.clearRect(0, 0, width, height);
    context.fillStyle = styles.getPropertyValue('--waveform-overview-background').trim() || '#111315';
    context.fillRect(0, 0, width, height);

    if (!buffer || buffer.length === 0 || duration <= 0) {
      context.strokeStyle = styles.getPropertyValue('--waveform-zero').trim() || '#4b5057';
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      requestOverviewDraw();
      return;
    }

    const samplesPerPixel = buffer.length / width;
    context.strokeStyle = styles.getPropertyValue('--waveform-overview-color').trim() || '#74808c';
    context.lineWidth = Math.max(1, ratio);
    drawWaveformChannels(context, buffer, width, height, 0, samplesPerPixel, 0.39);
    requestOverviewDraw();
  }

  function requestOverviewWaveformBuild(): void {
    if (overviewWaveformFrame) return;
    overviewWaveformFrame = requestAnimationFrame(() => {
      overviewWaveformFrame = 0;
      rebuildOverviewWaveform();
    });
  }

  function drawOverview(): void {
    overviewDrawFrame = 0;
    const dimensions = prepareOverviewCanvas();
    if (!dimensions) return;
    const { width, height, ratio } = dimensions;
    const context = overviewCanvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!buffer || duration <= 0) return;
    const styles = getComputedStyle(overviewCanvas);

    const selectionX = selectionStart / duration * width;
    const selectionWidth = Math.max(0, (selectionEnd - selectionStart) / duration * width);
    context.fillStyle = styles.getPropertyValue('--waveform-overview-selection').trim() || 'rgba(154, 190, 224, 0.2)';
    context.fillRect(selectionX, 0, selectionWidth, height);

    const viewportX = clampedScrollStart / duration * width;
    const viewportWidth = Math.max(2 * ratio, visibleDuration / duration * width);
    context.fillStyle = styles.getPropertyValue('--waveform-overview-outside').trim() || 'rgba(0, 0, 0, 0.46)';
    context.fillRect(0, 0, Math.max(0, viewportX), height);
    context.fillRect(Math.min(width, viewportX + viewportWidth), 0, Math.max(0, width - viewportX - viewportWidth), height);
    context.strokeStyle = styles.getPropertyValue('--waveform-overview-viewport').trim() || '#c6d0dc';
    context.lineWidth = Math.max(1, ratio);
    context.strokeRect(
      Math.max(0.5 * ratio, viewportX + 0.5 * ratio),
      0.5 * ratio,
      Math.max(1, Math.min(width - viewportX - ratio, viewportWidth - ratio)),
      Math.max(1, height - ratio)
    );

    if (normalizedZoom > 1) {
      context.fillStyle = styles.getPropertyValue('--waveform-overview-viewport').trim() || '#c6d0dc';
      const handleWidth = Math.max(2 * ratio, Math.min(4 * ratio, viewportWidth * 0.08));
      context.fillRect(viewportX, height * 0.28, handleWidth, height * 0.44);
      context.fillRect(viewportX + viewportWidth - handleWidth, height * 0.28, handleWidth, height * 0.44);
    }

    const playheadX = Math.max(0, Math.min(width, playhead / duration * width));
    context.strokeStyle = styles.getPropertyValue('--waveform-playhead').trim() || '#efb34f';
    context.lineWidth = Math.max(1, ratio);
    context.beginPath();
    context.moveTo(playheadX, 0);
    context.lineTo(playheadX, height);
    context.stroke();
  }

  function requestOverviewDraw(): void {
    if (!overviewDrawFrame) overviewDrawFrame = requestAnimationFrame(drawOverview);
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
      context.fillStyle = styles.getPropertyValue('--waveform-handle').trim() || '#d8dee7';
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + (x === selectionX ? 7 : -7) * ratio, 0);
      context.lineTo(x, 7 * ratio);
      context.closePath();
      context.fill();
    }

    if (playhead >= clampedScrollStart && playhead <= visibleEnd) {
      const x = (playhead - clampedScrollStart) / visibleDuration * width;
      context.strokeStyle = styles.getPropertyValue('--waveform-playhead').trim() || '#efb34f';
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
      context.fillStyle = styles.getPropertyValue('--waveform-playhead').trim() || '#efb34f';
      context.beginPath();
      context.moveTo(x - 4 * ratio, 0);
      context.lineTo(x + 4 * ratio, 0);
      context.lineTo(x, 6 * ratio);
      context.closePath();
      context.fill();
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

  function overviewTimeAtClientX(clientX: number): number {
    if (!overviewCanvas || duration <= 0) return 0;
    const rect = overviewCanvas.getBoundingClientRect();
    const position = Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1);
    return position * duration;
  }

  function seekFromOverview(clientX: number, recenter = true): void {
    const time = overviewTimeAtClientX(clientX);
    dispatch('seek', time);
    if (recenter && normalizedZoom > 1 && (time < clampedScrollStart || time > visibleEnd)) {
      scrollStart = clampWaveformScrollStart(time - visibleDuration / 2, duration, normalizedZoom);
    }
  }

  function handleOverviewPointerDown(event: PointerEvent): void {
    if (disabled || !buffer || duration <= 0) return;
    overviewCanvas.focus();
    overviewCanvas.setPointerCapture(event.pointerId);
    const rect = overviewCanvas.getBoundingClientRect();
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
    if (!overviewDragMode || !buffer) return;
    const rect = overviewCanvas.getBoundingClientRect();
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
    overviewCanvas.releasePointerCapture(event.pointerId);
    if (overviewDragMode === 'viewport' && !overviewPointerMoved) seekFromOverview(event.clientX, false);
    overviewDragMode = null;
  }

  function handleOverviewKeydown(event: KeyboardEvent): void {
    if (disabled || !buffer || duration <= 0) return;
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
    if (disabled || !buffer) return;
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
    resizeObserver = new ResizeObserver(() => {
      requestWaveformBuild();
      requestOverviewWaveformBuild();
    });
    resizeObserver.observe(canvas);
    resizeObserver.observe(overviewCanvas);
    rebuildWaveformLayer();
    rebuildOverviewWaveform();
    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(drawFrame);
      cancelAnimationFrame(waveformFrame);
      cancelAnimationFrame(overviewDrawFrame);
      cancelAnimationFrame(overviewWaveformFrame);
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

  $: if (overviewCanvas) {
    buffer;
    requestOverviewWaveformBuild();
  }

  $: if (overviewCanvas) {
    selectionStart;
    selectionEnd;
    playhead;
    clampedScrollStart;
    visibleDuration;
    requestOverviewDraw();
  }
</script>

<div class="waveform-editor" class:disabled>
  <div class="waveform-surface">
    <canvas bind:this={waveformLayer} class="waveform-layer" aria-hidden="true"></canvas>
    <canvas
      bind:this={canvas}
      class="waveform-overlay"
      tabindex="0"
      aria-label={waveformLabel || $t('clipTag.clip.waveform', { default: 'Editable audio waveform and selection' })}
      on:pointerdown={handlePointerDown}
      on:pointermove={handlePointerMove}
      on:pointerup={handlePointerUp}
      on:pointercancel={() => (dragMode = null)}
      on:wheel={handleWheel}
      on:keydown={handleKeydown}
      on:dblclick={() => dispatch('selection', { start: 0, end: duration })}
    >{waveformLabel || $t('clipTag.clip.waveform', { default: 'Editable audio waveform and selection' })}</canvas>
  </div>
  <div class="waveform-overview" class:dragging={overviewDragMode === 'viewport'}>
    <canvas bind:this={overviewWaveformLayer} class="overview-waveform-layer" aria-hidden="true"></canvas>
    <canvas
      bind:this={overviewCanvas}
      class="overview-overlay"
      tabindex="0"
      role="slider"
      aria-label={overviewLabel || $t('clipTag.clip.waveformOverview', { default: 'Full waveform overview and seek bar' })}
      aria-valuemin="0"
      aria-valuemax={duration}
      aria-valuenow={playhead}
      aria-valuetext={formatTimelineTime(playhead, 0.1)}
      on:pointerdown={handleOverviewPointerDown}
      on:pointermove={handleOverviewPointerMove}
      on:pointerup={handleOverviewPointerUp}
      on:pointercancel={() => (overviewDragMode = null)}
      on:keydown={handleOverviewKeydown}
      on:dblclick={() => { zoom = 1; scrollStart = 0; }}
    >{overviewLabel || $t('clipTag.clip.waveformOverview', { default: 'Full waveform overview and seek bar' })}</canvas>
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
    cursor: pointer;
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
