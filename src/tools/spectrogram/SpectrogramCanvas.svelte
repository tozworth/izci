<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { SpectrogramAnalysis } from './spectrogram-analyzer';

  export let analysis: SpectrogramAnalysis;
  export let floorDb = -120;

  const LEFT = 55;
  const RIGHT = 64;
  const TOP = 14;
  const BOTTOM = 29;
  const COLOR_STOPS = [
    [0, 0, 0, 0],
    [0.18, 0, 5, 74],
    [0.36, 0, 70, 190],
    [0.53, 0, 196, 222],
    [0.68, 26, 205, 102],
    [0.82, 241, 218, 34],
    [0.93, 246, 73, 10],
    [1, 255, 241, 220]
  ] as const;

  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let width = 0;
  let height = 0;
  let cursorX: number | null = null;
  let cursorY: number | null = null;
  let heatmap: HTMLCanvasElement | null = null;
  let heatmapAnalysis: SpectrogramAnalysis | null = null;
  let heatmapFloor = 0;
  let resizeObserver: ResizeObserver | null = null;

  function colorAt(value: number): [number, number, number] {
    const clamped = Math.min(1, Math.max(0, value));
    for (let index = 1; index < COLOR_STOPS.length; index += 1) {
      const before = COLOR_STOPS[index - 1];
      const after = COLOR_STOPS[index];
      if (clamped > after[0]) continue;
      const progress = (clamped - before[0]) / (after[0] - before[0]);
      return [
        Math.round(before[1] + (after[1] - before[1]) * progress),
        Math.round(before[2] + (after[2] - before[2]) * progress),
        Math.round(before[3] + (after[3] - before[3]) * progress)
      ];
    }
    return [255, 241, 220];
  }

  function rebuildHeatmap(): void {
    const renderedBins = Math.min(1024, analysis.binCount);
    const next = document.createElement('canvas');
    next.width = analysis.columnCount;
    next.height = renderedBins;
    const context = next.getContext('2d');
    if (!context) return;
    const image = context.createImageData(next.width, next.height);
    for (let y = 0; y < renderedBins; y += 1) {
      const lowBin = Math.floor(((renderedBins - 1 - y) / renderedBins) * analysis.binCount);
      const highBin = Math.max(lowBin + 1, Math.ceil(((renderedBins - y) / renderedBins) * analysis.binCount));
      for (let x = 0; x < analysis.columnCount; x += 1) {
        let db = -160;
        const columnOffset = x * analysis.binCount;
        for (let bin = lowBin; bin < highBin; bin += 1) {
          db = Math.max(db, analysis.magnitudesDb[columnOffset + bin]);
        }
        const [red, green, blue] = colorAt((db - floorDb) / -floorDb);
        const pixel = (y * next.width + x) * 4;
        image.data[pixel] = red;
        image.data[pixel + 1] = green;
        image.data[pixel + 2] = blue;
        image.data[pixel + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    heatmap = next;
    heatmapAnalysis = analysis;
    heatmapFloor = floorDb;
  }

  function niceTimeStep(duration: number, plotWidth: number): number {
    const target = duration / Math.max(2, Math.floor(plotWidth / 105));
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 0.001)));
    const normalized = target / magnitude;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return factor * magnitude;
  }

  function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remaining = Math.floor(seconds % 60);
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
      : `${minutes}:${String(remaining).padStart(2, '0')}`;
  }

  function draw(): void {
    if (!canvas || width <= 0 || height <= 0) return;
    if (heatmapAnalysis !== analysis || heatmapFloor !== floorDb || !heatmap) rebuildHeatmap();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext('2d');
    if (!context || !heatmap) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = '#07090c';
    context.fillRect(0, 0, width, height);
    const plotWidth = Math.max(1, width - LEFT - RIGHT);
    const plotHeight = Math.max(1, height - TOP - BOTTOM);
    context.imageSmoothingEnabled = true;
    context.drawImage(heatmap, LEFT, TOP, plotWidth, plotHeight);

    context.font = '10px "Segoe UI", sans-serif';
    context.fillStyle = '#aeb6c2';
    context.strokeStyle = 'rgba(190, 200, 215, 0.2)';
    context.lineWidth = 1;
    context.textBaseline = 'middle';
    context.textAlign = 'right';
    const maxFrequency = analysis.sampleRate / 2;
    const frequencyStep = maxFrequency <= 24000 ? 5000 : maxFrequency <= 48000 ? 10000 : 20000;
    for (let frequency = 0; frequency <= maxFrequency; frequency += frequencyStep) {
      const y = TOP + plotHeight * (1 - frequency / maxFrequency);
      context.beginPath();
      context.moveTo(LEFT, Math.round(y) + 0.5);
      context.lineTo(LEFT + plotWidth, Math.round(y) + 0.5);
      context.stroke();
      context.fillText(frequency === 0 ? '0' : `${frequency / 1000} kHz`, LEFT - 7, y);
    }
    if (maxFrequency % frequencyStep !== 0) {
      context.fillText(`${(maxFrequency / 1000).toFixed(maxFrequency % 1000 ? 1 : 0)} kHz`, LEFT - 7, TOP);
    }

    context.textAlign = 'center';
    context.textBaseline = 'top';
    const timeStep = niceTimeStep(analysis.duration, plotWidth);
    for (let time = 0; time <= analysis.duration; time += timeStep) {
      const x = LEFT + plotWidth * (time / analysis.duration);
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, TOP);
      context.lineTo(Math.round(x) + 0.5, TOP + plotHeight);
      context.stroke();
      context.fillText(formatTime(time), x, TOP + plotHeight + 6);
    }

    const gradientX = width - 43;
    const gradientWidth = 12;
    const gradient = context.createLinearGradient(0, TOP + plotHeight, 0, TOP);
    for (const stop of COLOR_STOPS) gradient.addColorStop(stop[0], `rgb(${stop[1]} ${stop[2]} ${stop[3]})`);
    context.fillStyle = gradient;
    context.fillRect(gradientX, TOP, gradientWidth, plotHeight);
    context.strokeStyle = 'rgba(220, 225, 235, 0.45)';
    context.strokeRect(gradientX + 0.5, TOP + 0.5, gradientWidth - 1, plotHeight - 1);
    context.fillStyle = '#aeb6c2';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    for (let db = 0; db >= floorDb; db -= 20) {
      const y = TOP + plotHeight * (db / floorDb);
      context.fillText(String(db), gradientX + gradientWidth + 5, y);
    }

    if (cursorX !== null && cursorY !== null) {
      const x = Math.min(LEFT + plotWidth, Math.max(LEFT, cursorX));
      const y = Math.min(TOP + plotHeight, Math.max(TOP, cursorY));
      context.strokeStyle = 'rgba(255, 255, 255, 0.68)';
      context.setLineDash([3, 3]);
      context.beginPath();
      context.moveTo(x + 0.5, TOP);
      context.lineTo(x + 0.5, TOP + plotHeight);
      context.moveTo(LEFT, y + 0.5);
      context.lineTo(LEFT + plotWidth, y + 0.5);
      context.stroke();
      context.setLineDash([]);
      const time = ((x - LEFT) / plotWidth) * analysis.duration;
      const frequency = (1 - (y - TOP) / plotHeight) * maxFrequency;
      const label = `${formatTime(time)}  ·  ${(frequency / 1000).toFixed(2)} kHz`;
      context.font = '11px "Segoe UI", sans-serif';
      const labelWidth = context.measureText(label).width + 12;
      const labelX = Math.min(LEFT + plotWidth - labelWidth - 3, x + 8);
      const labelY = Math.max(TOP + 3, y - 24);
      context.fillStyle = 'rgba(5, 8, 12, 0.88)';
      context.fillRect(labelX, labelY, labelWidth, 19);
      context.fillStyle = '#eef2f8';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.fillText(label, labelX + 6, labelY + 9.5);
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    cursorX = event.clientX - rect.left;
    cursorY = event.clientY - rect.top;
  }

  onMount(() => {
    resizeObserver = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
    });
    resizeObserver.observe(host);
  });

  onDestroy(() => resizeObserver?.disconnect());

  $: {
    analysis;
    floorDb;
    width;
    height;
    cursorX;
    cursorY;
    draw();
  }
</script>

<div bind:this={host} class="spectrogram-canvas-host">
  <canvas
    bind:this={canvas}
    aria-label={$t('spectrogram.graphLabel', { default: 'Audio spectrogram: time from left to right, frequency from bottom to top, and color showing level in dBFS' })}
    on:pointermove={handlePointerMove}
    on:pointerleave={() => { cursorX = null; cursorY = null; }}
  ></canvas>
</div>
