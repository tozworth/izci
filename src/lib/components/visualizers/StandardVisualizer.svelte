<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { extractArtworkPalette, type VisualizerPalette } from '$lib/services/artwork-palette';
  import { visualizerService } from '$lib/services/visualizer';
  import { DEFAULT_VISUALIZER_SETTINGS, visualizerSettings } from '$lib/stores/visualizer-settings';
  import { TriangleVisualizerRenderer } from '$lib/components/visualizers/triangles';
  import type { VisualizerSettings } from '$lib/types';

  const BAND_COUNT = 72;
  const IDLE_FALLBACK = 0;
  const MAX_CANVAS_BACKING_PIXELS = 1_000_000;
  const MIN_CANVAS_DISPLAY_SCALE = 0.5;
  const MAX_VISUALIZED_FREQUENCY_HZ = 16_000;
  const PALETTE_REFRESH_INTERVAL_MS = 250;
  const FRAME_INTERVAL_TOLERANCE_MS = 0.75;
  const CANVAS_CONTEXT_OPTIONS: CanvasRenderingContext2DSettings = {
    alpha: true,
    desynchronized: true
  };

  interface VisualizerClipRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export let artworkUrl: string | undefined = undefined;
  export let triangleSizeReferenceSelector: string | null = null;
  export let clipRects: VisualizerClipRect[] = [];
  export let standalone = false;

  let canvas: HTMLCanvasElement;
  let canvasContext: CanvasRenderingContext2D | null = null;
  let frame: number | null = null;
  let lastRenderedAt = 0;
  let width = 0;
  let height = 0;
  let displayScale = 1;
  let lastClipSignature = '';
  let analyser: AnalyserNode | null = null;
  let frequencyData = new Uint8Array(0);
  let bandValues = new Array<number>(BAND_COUNT).fill(IDLE_FALLBACK);
  let rollingLow = 0.55;
  let rollingMid = 0.55;
  let rollingHigh = 0.55;
  let currentSettings = DEFAULT_VISUALIZER_SETTINGS;
  let artworkPalette: VisualizerPalette | null = null;
  let artworkPaletteUrl: string | undefined = undefined;
  let artworkPaletteToken = 0;
  let themePalette: VisualizerPalette | null = null;
  let paletteCacheDirty = true;
  let lastPaletteRefreshAt = 0;
  const triangleRenderer = new TriangleVisualizerRenderer();
  let resizeObserver: ResizeObserver | null = null;
  let paletteMutationObserver: MutationObserver | null = null;
  let mounted = false;

  function resizeCanvas() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const rawScale = Math.max(1, window.devicePixelRatio || 1);
    const cssPixels = Math.max(1, rect.width * rect.height);
    const scale = Math.max(
      MIN_CANVAS_DISPLAY_SCALE,
      Math.min(rawScale, Math.sqrt(MAX_CANVAS_BACKING_PIXELS / cssPixels))
    );
    const nextWidth = Math.max(1, Math.round(rect.width * scale));
    const nextHeight = Math.max(1, Math.round(rect.height * scale));
    const sizeChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;

    width = nextWidth;
    height = nextHeight;
    displayScale = scale;

    if (sizeChanged) {
      canvas.width = width;
      canvas.height = height;
      lastClipSignature = '';
      triangleRenderer.resetParticles();
    }

    syncTriangleReferenceObserver();
  }

  function getVisualizerMetrics() {
    return { width, height, displayScale };
  }

  function getFrameIntervalMs(settings: VisualizerSettings): number {
    return 1000 / Math.max(settings.frameRateLimit, 1);
  }

  function getScaledClipRect(rect: VisualizerClipRect): VisualizerClipRect {
    return {
      x: Math.round(rect.x * displayScale),
      y: Math.round(rect.y * displayScale),
      width: Math.round(rect.width * displayScale),
      height: Math.round(rect.height * displayScale)
    };
  }

  function getClipSignature(): string {
    return clipRects
      .map((rect) => {
        const scaled = getScaledClipRect(rect);
        return `${scaled.x},${scaled.y},${scaled.width},${scaled.height}`;
      })
      .join('|');
  }

  function clearVisualizerCanvas(context: CanvasRenderingContext2D): void {
    if (clipRects.length === 0) {
      context.clearRect(0, 0, width, height);
      lastClipSignature = '';
      return;
    }

    const clipSignature = getClipSignature();

    if (clipSignature !== lastClipSignature) {
      context.clearRect(0, 0, width, height);
      lastClipSignature = clipSignature;
    }

    for (const rect of clipRects) {
      const scaled = getScaledClipRect(rect);
      context.clearRect(scaled.x, scaled.y, scaled.width, scaled.height);
    }
  }

  function sampleBands(settings: VisualizerSettings): number[] {
    if (!analyser || frequencyData.length !== analyser.frequencyBinCount) {
      frequencyData = analyser ? new Uint8Array(analyser.frequencyBinCount) : new Uint8Array(0);
    }

    if (analyser) {
      analyser.getByteFrequencyData(frequencyData);
    }

    const values = bandValues;
    const binCount = frequencyData.length;
    const nyquistFrequency = analyser ? analyser.context.sampleRate / 2 : 0;
    const visualizedBinCount =
      nyquistFrequency > 0
        ? Math.max(1, Math.min(binCount, Math.floor((MAX_VISUALIZED_FREQUENCY_HZ / nyquistFrequency) * binCount)))
        : binCount;

    for (let index = 0; index < BAND_COUNT; index += 1) {
      if (!binCount) {
        values[index] = IDLE_FALLBACK;
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

      values[index] = total / (end - start) / 255;
    }

    const normalizationStrength =
      settings.style === 'triangles'
        ? DEFAULT_VISUALIZER_SETTINGS.normalizationStrength
        : settings.normalizationStrength;

    return normalizeBands(values, normalizationStrength);
  }

  function normalizeBands(values: number[], strength: number): number[] {
    if (strength <= 0) {
      for (let index = 0; index < values.length; index += 1) {
        values[index] = Math.pow(values[index], 0.72);
      }

      return values;
    }

    const low = average(values, 0, 18);
    const mid = average(values, 18, 46);
    const high = average(values, 46, values.length);
    rollingLow = rollingLow * 0.985 + Math.max(low, 0.08) * 0.015;
    rollingMid = rollingMid * 0.985 + Math.max(mid, 0.08) * 0.015;
    rollingHigh = rollingHigh * 0.985 + Math.max(high, 0.08) * 0.015;

    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const balance =
        index < 18
          ? rollingLow
          : index < 46
            ? rollingMid
            : rollingHigh;
      const normalized = value / Math.max(balance, 0.14);
      values[index] = Math.min(1, Math.pow(value * (1 - strength) + normalized * 0.52 * strength, 0.72));
    }

    return values;
  }

  function getPalette(): VisualizerPalette {
    const settings = currentSettings;

    if (settings.colorSource === 'artwork' && artworkPalette) {
      return artworkPalette;
    }

    const timestamp = performance.now();

    if (themePalette && !paletteCacheDirty && timestamp - lastPaletteRefreshAt < PALETTE_REFRESH_INTERVAL_MS) {
      return themePalette;
    }

    const styles = getComputedStyle(canvas);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;

    themePalette = {
      high: read('--visualizer-high', 'rgba(255, 246, 210, 0.95)'),
      mid: read('--visualizer-mid', 'rgba(120, 205, 255, 0.68)'),
      low: read('--visualizer-low', 'rgba(255, 121, 198, 0.22)'),
      glow: read('--visualizer-glow', 'rgba(120, 205, 255, 0.42)'),
      bars: read('--visualizer-bars', 'rgba(155, 220, 255, 0.86)'),
      blocks: read('--visualizer-blocks', 'rgba(255, 246, 210, 0.72)')
    };
    paletteCacheDirty = false;
    lastPaletteRefreshAt = timestamp;

    return themePalette;
  }

  function average(values: number[], start: number, end: number): number {
    const normalizedStart = Math.max(0, start);
    const normalizedEnd = Math.min(values.length, end);
    let total = 0;

    for (let index = normalizedStart; index < normalizedEnd; index += 1) {
      total += values[index];
    }

    return total / Math.max(normalizedEnd - normalizedStart, 1);
  }

  function syncTriangleReferenceObserver() {
    if (!mounted) {
      return;
    }

    triangleRenderer.syncSizeReference(triangleSizeReferenceSelector, getVisualizerMetrics());
  }

  async function syncArtworkPalette(url: string | undefined): Promise<void> {
    const token = ++artworkPaletteToken;
    artworkPaletteUrl = url;
    artworkPalette = null;
    paletteCacheDirty = true;

    if (!url) {
      return;
    }

    try {
      const palette = await extractArtworkPalette(url);

      if (token === artworkPaletteToken && artworkPaletteUrl === url) {
        artworkPalette = palette.visualizer;
        paletteCacheDirty = true;
      }
    } catch {
      if (token === artworkPaletteToken) {
        artworkPalette = null;
        paletteCacheDirty = true;
      }
    }
  }

  function draw(timestamp = performance.now()) {
    frame = null;

    if (!canvas) {
      return;
    }

    if (!width || !height) {
      resizeCanvas();
    }

    const context = canvasContext ?? canvas.getContext('2d', CANVAS_CONTEXT_OPTIONS);

    if (!context) {
      return;
    }

    canvasContext = context;
    const settings = standalone ? { ...currentSettings, transparency: 1 } : currentSettings;

    if (lastRenderedAt > 0 && timestamp - lastRenderedAt + FRAME_INTERVAL_TOLERANCE_MS < getFrameIntervalMs(settings)) {
      frame = requestAnimationFrame(draw);
      return;
    }

    lastRenderedAt = timestamp;

    const values = sampleBands(settings);
    const palette = getPalette();
    clearVisualizerCanvas(context);
    context.save();

    if (clipRects.length > 0) {
      context.beginPath();

      for (const rect of clipRects) {
        const scaled = getScaledClipRect(rect);
        context.rect(scaled.x, scaled.y, scaled.width, scaled.height);
      }

      context.clip();
    }

    context.globalAlpha = settings.transparency;

    if (settings.style === 'wave') {
      triangleRenderer.resetFrameTiming();
      drawWave(context, values, settings.height, palette);
    } else if (settings.style === 'bars') {
      triangleRenderer.resetFrameTiming();
      drawBars(context, values, settings.height, palette);
    } else if (settings.style === 'mirror') {
      triangleRenderer.resetFrameTiming();
      drawMirror(context, values, settings.height, palette);
    } else if (settings.style === 'blocks') {
      triangleRenderer.resetFrameTiming();
      drawBlocks(context, values, settings.height, palette, settings.transparency);
    } else {
      triangleRenderer.render(context, values, settings, palette, timestamp, getVisualizerMetrics());
    }

    context.restore();
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
    palette: VisualizerPalette,
    transparency: number
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
        context.globalAlpha = transparency * (0.44 + (row / rows) * 0.56);
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
    const unsubscribeSettings = visualizerSettings.subscribe((nextSettings) => {
      currentSettings = nextSettings;
      paletteCacheDirty = true;
    });

    mounted = true;
    canvasContext = canvas.getContext('2d', CANVAS_CONTEXT_OPTIONS);
    draw();

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resizeCanvas);
      resizeObserver.observe(canvas);
    }

    paletteMutationObserver = new MutationObserver(() => {
      paletteCacheDirty = true;
    });
    paletteMutationObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    paletteMutationObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
    if (canvas.parentElement) {
      paletteMutationObserver.observe(canvas.parentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    }

    resizeCanvas();
    syncTriangleReferenceObserver();
    window.addEventListener('resize', resizeCanvas);

    return () => {
      mounted = false;
      unsubscribeSource();
      unsubscribeSettings();
      window.removeEventListener('resize', resizeCanvas);
      resizeObserver?.disconnect();
      triangleRenderer.disconnect();
      paletteMutationObserver?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  });

  $: if (artworkUrl !== artworkPaletteUrl) {
    void syncArtworkPalette(artworkUrl);
  }

  $: syncTriangleReferenceObserver();

  onDestroy(() => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
  });
</script>

<canvas bind:this={canvas} class="player-visualizer" aria-hidden="true"></canvas>
