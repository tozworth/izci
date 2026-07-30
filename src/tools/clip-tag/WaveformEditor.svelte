<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';

  export let buffer: AudioBuffer | null = null;
  export let selectionStart = 0;
  export let selectionEnd = 0;
  export let playhead = 0;
  export let disabled = false;

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
  let selectionFrame = 0;
  let pendingSelection: { start: number; end: number } | null = null;

  function timeAtClientX(clientX: number): number {
    if (!canvas || !buffer) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.min(Math.max((clientX - rect.left) / Math.max(rect.width, 1), 0), 1) * buffer.duration;
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

    if (!buffer || buffer.length === 0) {
      context.strokeStyle = styles.getPropertyValue('--waveform-zero').trim() || '#4b5057';
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();
      requestDraw();
      return;
    }

    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer!.getChannelData(index));
    const samplesPerPixel = buffer.length / width;
    const middle = height / 2;
    context.strokeStyle = styles.getPropertyValue('--waveform-color').trim() || '#aeb7c2';
    context.lineWidth = Math.max(1, ratio);
    context.beginPath();
    for (let x = 0; x < width; x += 1) {
      const start = Math.floor(x * samplesPerPixel);
      const end = Math.max(start + 1, Math.min(buffer.length, Math.floor((x + 1) * samplesPerPixel)));
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
      context.moveTo(x + 0.5, middle - maximum * middle * 0.9);
      context.lineTo(x + 0.5, middle - minimum * middle * 0.9);
    }
    context.stroke();
    requestDraw();
  }

  function draw(): void {
    drawFrame = 0;
    const dimensions = prepareCanvas();
    if (!dimensions) return;
    const { width, height, ratio } = dimensions;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (!buffer || buffer.length === 0) return;
    const styles = getComputedStyle(canvas);

    const selectionX = selectionStart / buffer.duration * width;
    const selectionWidth = Math.max(0, (selectionEnd - selectionStart) / buffer.duration * width);
    context.fillStyle = styles.getPropertyValue('--waveform-selection').trim() || 'rgba(197, 204, 214, 0.14)';
    context.fillRect(selectionX, 0, selectionWidth, height);
    context.strokeStyle = styles.getPropertyValue('--waveform-handle').trim() || '#d8dee7';
    context.lineWidth = Math.max(1, ratio);
    for (const x of [selectionX, selectionX + selectionWidth]) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }

    if (playhead > 0 && playhead <= buffer.duration) {
      const x = playhead / buffer.duration * width;
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
    const secondsPerTenPixels = buffer.duration * 10 / Math.max(canvas.clientWidth, 1);
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

  onMount(() => {
    resizeObserver = new ResizeObserver(rebuildWaveformLayer);
    resizeObserver.observe(canvas);
    rebuildWaveformLayer();
    return () => {
      resizeObserver?.disconnect();
      cancelAnimationFrame(drawFrame);
      cancelAnimationFrame(selectionFrame);
    };
  });

  $: if (canvas && buffer) {
    buffer;
    queueMicrotask(rebuildWaveformLayer);
  }

  $: if (canvas) {
    selectionStart;
    selectionEnd;
    playhead;
    requestDraw();
  }
</script>

<div class="waveform-editor" class:disabled>
  <canvas bind:this={waveformLayer} class="waveform-layer" aria-hidden="true"></canvas>
  <canvas
    bind:this={canvas}
    class="waveform-overlay"
    aria-label="Audio waveform and clip selection"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={() => (dragMode = null)}
  >Audio waveform and clip selection</canvas>
</div>

<style>
  .waveform-editor {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    min-height: 190px;
    --waveform-background: color-mix(in srgb, var(--bg-input) 90%, black);
    --waveform-color: color-mix(in srgb, var(--accent-strong) 82%, var(--muted));
    --waveform-zero: var(--border);
    --waveform-selection: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    --waveform-handle: var(--accent-strong);
    --waveform-playhead: #efb34f;
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

  .waveform-editor.disabled {
    opacity: 0.55;
  }

  .waveform-editor.disabled .waveform-overlay {
    cursor: default;
  }
</style>
