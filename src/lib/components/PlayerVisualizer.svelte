<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { extractArtworkPalette, type VisualizerPalette } from '$lib/services/artwork-palette';
  import { visualizerService } from '$lib/services/visualizer';
  import { visualizerSettings } from '$lib/stores/visualizer-settings';
  import type { VisualizerSettings } from '$lib/types';

  export let artworkUrl: string | undefined = undefined;

  const BAND_COUNT = 72;
  const IDLE_FALLBACK = 0;
  const MAX_VISUALIZED_FREQUENCY_HZ = 16_000;

  let canvas: HTMLCanvasElement;
  let frame: number | null = null;
  let width = 0;
  let height = 0;
  let analyser: AnalyserNode | null = null;
  let frequencyData = new Uint8Array(0);
  let rollingLow = 0.55;
  let rollingMid = 0.55;
  let rollingHigh = 0.55;
  let artworkPalette: VisualizerPalette | null = null;
  let artworkPaletteUrl: string | undefined = undefined;
  let artworkPaletteToken = 0;

  function resizeCanvas() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    width = Math.max(1, Math.round(rect.width * scale));
    height = Math.max(1, Math.round(rect.height * scale));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function sampleBands(settings: VisualizerSettings): number[] {
    if (!analyser || frequencyData.length !== analyser.frequencyBinCount) {
      frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : new Uint8Array(0);
    }

    if (analyser) {
      analyser.getByteFrequencyData(frequencyData);
    }

    const values: number[] = [];
    const binCount = frequencyData.length;
    const nyquistFrequency = analyser ? analyser.context.sampleRate / 2 : 0;
    const visualizedBinCount =
      nyquistFrequency > 0
        ? Math.max(1, Math.min(binCount, Math.floor((MAX_VISUALIZED_FREQUENCY_HZ / nyquistFrequency) * binCount)))
        : binCount;

    for (let index = 0; index < BAND_COUNT; index += 1) {
      if (!binCount) {
        values.push(IDLE_FALLBACK);
        continue;
      }

      const start = Math.min(
        visualizedBinCount - 1,
        Math.floor(Math.pow(index / BAND_COUNT, 1.72) * visualizedBinCount)
      );
      const end = Math.max(
        start + 1,
        Math.min(
          visualizedBinCount,
          Math.floor(Math.pow((index + 1) / BAND_COUNT, 1.72) * visualizedBinCount)
        )
      );
      let total = 0;

      for (let bin = start; bin < end; bin += 1) {
        total += frequencyData[bin];
      }

      values.push(total / (end - start) / 255);
    }

    return normalizeBands(values, settings.normalizationStrength);
  }

  function normalizeBands(values: number[], strength: number): number[] {
    if (strength <= 0) {
      return values.map((value) => Math.pow(value, 0.72));
    }

    const low = average(values, 0, 18);
    const mid = average(values, 18, 46);
    const high = average(values, 46, values.length);
    rollingLow = rollingLow * 0.985 + Math.max(low, 0.08) * 0.015;
    rollingMid = rollingMid * 0.985 + Math.max(mid, 0.08) * 0.015;
    rollingHigh = rollingHigh * 0.985 + Math.max(high, 0.08) * 0.015;

    return values.map((value, index) => {
      const balance =
        index < 18
          ? rollingLow
          : index < 46
            ? rollingMid
            : rollingHigh;
      const normalized = value / Math.max(balance, 0.14);
      return Math.min(1, Math.pow(value * (1 - strength) + normalized * 0.52 * strength, 0.72));
    });
  }

  function getPalette(): VisualizerPalette {
    const settings = visualizerSettings.getSnapshot();

    if (settings.colorSource === 'artwork' && artworkPalette) {
      return artworkPalette;
    }

    const styles = getComputedStyle(canvas);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

    return {
      high: read('--visualizer-high', 'rgba(255, 246, 210, 0.95)'),
      mid: read('--visualizer-mid', 'rgba(120, 205, 255, 0.68)'),
      low: read('--visualizer-low', 'rgba(255, 121, 198, 0.22)'),
      glow: read('--visualizer-glow', 'rgba(120, 205, 255, 0.42)'),
      bars: read('--visualizer-bars', 'rgba(155, 220, 255, 0.86)'),
      blocks: read('--visualizer-blocks', 'rgba(255, 246, 210, 0.72)')
    };
  }

  function average(values: number[], start: number, end: number): number {
    const slice = values.slice(start, end);
    return slice.reduce((total, value) => total + value, 0) / Math.max(slice.length, 1);
  }

  async function syncArtworkPalette(url: string | undefined): Promise<void> {
    const token = ++artworkPaletteToken;
    artworkPaletteUrl = url;
    artworkPalette = null;

    if (!url) {
      return;
    }

    try {
      const palette = await extractArtworkPalette(url);

      if (token === artworkPaletteToken && artworkPaletteUrl === url) {
        artworkPalette = palette.visualizer;
      }
    } catch {
      if (token === artworkPaletteToken) {
        artworkPalette = null;
      }
    }
  }

  function draw() {
    frame = null;

    if (!canvas) {
      return;
    }

    resizeCanvas();

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const settings = visualizerSettings.getSnapshot();
    const values = sampleBands(settings);
    const palette = getPalette();
    context.clearRect(0, 0, width, height);
    context.globalAlpha = settings.transparency;

    if (settings.style === 'wave') {
      drawWave(context, values, settings.height, palette);
    } else if (settings.style === 'bars') {
      drawBars(context, values, settings.height, palette);
    } else if (settings.style === 'mirror') {
      drawMirror(context, values, settings.height, palette);
    } else {
      drawBlocks(context, values, settings.height, palette);
    }

    context.globalAlpha = 1;
    frame = requestAnimationFrame(draw);
  }

  function drawWave(
    context: CanvasRenderingContext2D,
    values: number[],
    heightRatio: number,
    palette: VisualizerPalette
  ) {
    const visualHeight = height * heightRatio;
    const step = width / (values.length - 1);
    const gradient = context.createLinearGradient(0, height - visualHeight, 0, height);
    gradient.addColorStop(0, palette.high);
    gradient.addColorStop(0.42, palette.mid);
    gradient.addColorStop(1, palette.low);

    context.beginPath();
    context.moveTo(0, height);

    values.forEach((value, index) => {
      const previous = values[Math.max(index - 1, 0)];
      const next = values[Math.min(index + 1, values.length - 1)];
      const softened = (previous + value * 1.7 + next) / 3.7;
      const x = index * step;
      const y = height - Math.max(2, softened * visualHeight);
      context.lineTo(x, y);
    });

    context.lineTo(width, height);
    context.closePath();
    context.fillStyle = gradient;
    context.shadowColor = palette.glow;
    context.shadowBlur = height * 0.08;
    context.fill();
    context.shadowBlur = 0;
  }

  function drawBars(
    context: CanvasRenderingContext2D,
    values: number[],
    heightRatio: number,
    palette: VisualizerPalette
  ) {
    const visualHeight = height * heightRatio;
    const gap = Math.max(2, width * 0.0026);
    const barWidth = width / values.length - gap;
    context.fillStyle = palette.bars;

    values.forEach((value, index) => {
      const barHeight = Math.max(2, value * visualHeight);
      const x = index * (barWidth + gap);
      context.fillRect(x, height - barHeight, Math.max(1, barWidth), barHeight);
    });
  }

  function drawMirror(
    context: CanvasRenderingContext2D,
    values: number[],
    heightRatio: number,
    palette: VisualizerPalette
  ) {
    const centerY = height * 0.58;
    const visualHeight = height * heightRatio * 0.46;
    const step = width / values.length;
    const gradient = context.createLinearGradient(0, centerY - visualHeight, 0, centerY + visualHeight);
    gradient.addColorStop(0, palette.high);
    gradient.addColorStop(0.5, palette.mid);
    gradient.addColorStop(1, palette.low);
    context.fillStyle = gradient;
    context.shadowColor = palette.glow;
    context.shadowBlur = height * 0.045;

    values.forEach((value, index) => {
      const barHeight = Math.max(1, value * visualHeight);
      const x = index * step;
      context.fillRect(x, centerY - barHeight, Math.max(1, step * 0.72), barHeight * 2);
    });

    context.shadowBlur = 0;
  }

  function drawBlocks(
    context: CanvasRenderingContext2D,
    values: number[],
    heightRatio: number,
    palette: VisualizerPalette
  ) {
    const columns = 48;
    const rows = 7;
    const visualHeight = height * heightRatio;
    const blockWidth = width / columns;
    const blockHeight = visualHeight / rows;
    const yOffset = height - visualHeight;

    for (let column = 0; column < columns; column += 1) {
      const value = values[Math.floor((column / columns) * values.length)] ?? 0;
      const litRows = Math.ceil(value * rows);

      for (let row = 0; row < litRows; row += 1) {
        context.globalAlpha = (visualizerSettings.getSnapshot().transparency * (0.44 + (row / rows) * 0.56));
        context.fillStyle = palette.blocks;
        context.fillRect(
          column * blockWidth + blockWidth * 0.14,
          yOffset + (rows - row - 1) * blockHeight + blockHeight * 0.16,
          blockWidth * 0.72,
          blockHeight * 0.68
        );
      }
    }
  }

  onMount(() => {
    const unsubscribeSource = visualizerService.source.subscribe((nextSource) => {
      analyser = nextSource?.analyser ?? null;
    });
    const unsubscribeSettings = visualizerSettings.subscribe(() => undefined);

    draw();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      unsubscribeSource();
      unsubscribeSettings();
      window.removeEventListener('resize', resizeCanvas);
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  });

  $: if (artworkUrl !== artworkPaletteUrl) {
    void syncArtworkPalette(artworkUrl);
  }

  onDestroy(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  });
</script>

<canvas bind:this={canvas} class="player-visualizer" aria-hidden="true"></canvas>
