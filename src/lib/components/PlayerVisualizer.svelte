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
  interface TriangleParticle {
    x: number;
    y: number;
    size: number;
    baseSpeed: number;
    depth: number;
    alpha: number;
    bandIndex: number;
    flash: number;
  }

  interface TriangleRhythm {
    amplitude: number;
    pulse: number;
    isBeat: boolean;
  }

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
  let triangleParticles: TriangleParticle[] = [];
  let triangleLastTimestamp = 0;
  let triangleRollingEnergy = 0.12;
  let triangleRollingLow = 0.12;
  let triangleBeatPulse = 0;
  let triangleLastBeatAt = 0;
  let triangleGenerationSignature = '';

  function resizeCanvas() {
    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * scale));
    const nextHeight = Math.max(1, Math.round(rect.height * scale));
    const sizeChanged = canvas.width !== nextWidth || canvas.height !== nextHeight;

    width = nextWidth;
    height = nextHeight;

    if (sizeChanged) {
      canvas.width = width;
      canvas.height = height;
      triangleParticles = [];
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

  function clamp01(value: number): number {
    return Math.min(Math.max(value, 0), 1);
  }

  function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  function getTriangleGenerationSignature(settings: VisualizerSettings): string {
    return [
      settings.height,
      settings.triangleMinSize,
      settings.triangleMaxSize,
      settings.triangleBaseSpeed
    ].join(':');
  }

  function getTriangleTargetCount(settings: VisualizerSettings): number {
    return Math.round(settings.triangleCount);
  }

  function ensureTriangleParticles(settings: VisualizerSettings, bandCount: number): void {
    const targetCount = getTriangleTargetCount(settings);

    while (triangleParticles.length < targetCount) {
      triangleParticles.push(createTriangleParticle(settings, bandCount));
    }

    if (triangleParticles.length > targetCount) {
      triangleParticles.length = targetCount;
    }
  }

  function createTriangleParticle(settings: VisualizerSettings, bandCount: number): TriangleParticle {
    const heightRatio = settings.height;
    const visualTop = height * (1 - heightRatio);
    const visualHeight = Math.max(1, height - visualTop);
    const depth = randomRange(0.72, 1.62);
    const minSize = Math.max(8, height * settings.triangleMinSize);
    const maxSize = Math.max(minSize + 4, height * settings.triangleMaxSize);
    const size = randomRange(minSize, maxSize) * depth;
    const xMargin = Math.min(width * 0.12, size * 0.28);

    return {
      x: width <= xMargin * 2 ? width / 2 : randomRange(xMargin, width - xMargin),
      y: randomRange(height + size * 0.2, height + visualHeight * 1.15 + size),
      size,
      baseSpeed: randomRange(height * 0.08, height * 0.3) * depth * settings.triangleBaseSpeed,
      depth,
      alpha: randomRange(0.48, 0.9),
      bandIndex: Math.floor(randomRange(0, Math.max(1, bandCount))),
      flash: 0
    };
  }

  function getTriangleFrameDelta(): { timestamp: number; deltaSeconds: number } {
    const timestamp = performance.now();
    const deltaSeconds = triangleLastTimestamp
      ? Math.min(0.08, Math.max(0.001, (timestamp - triangleLastTimestamp) / 1000))
      : 1 / 60;

    triangleLastTimestamp = timestamp;
    return { timestamp, deltaSeconds };
  }

  function updateTriangleRhythm(values: number[], timestamp: number, deltaSeconds: number): TriangleRhythm {
    const low = average(values, 0, 18);
    const mid = average(values, 18, 46);
    const high = average(values, 46, values.length);
    const energy = clamp01(low * 0.5 + mid * 0.32 + high * 0.18);
    const previousEnergy = triangleRollingEnergy;
    const previousLow = triangleRollingLow;
    const onset = energy - previousEnergy;
    const lowOnset = low - previousLow;
    const enoughBeatGap = timestamp - triangleLastBeatAt > 145;
    const isBeat =
      enoughBeatGap &&
      energy > 0.12 &&
      (onset > 0.055 + previousEnergy * 0.12 ||
        lowOnset > 0.065 + previousLow * 0.1 ||
        (energy > 0.62 && onset > 0.025));

    triangleBeatPulse *= Math.pow(0.035, deltaSeconds);

    if (isBeat) {
      triangleBeatPulse = Math.max(triangleBeatPulse, Math.min(1, 0.38 + energy * 0.78));
      triangleLastBeatAt = timestamp;
    }

    triangleRollingEnergy = previousEnergy * 0.94 + Math.max(energy, 0.025) * 0.06;
    triangleRollingLow = previousLow * 0.92 + Math.max(low, 0.025) * 0.08;

    return {
      amplitude: Math.pow(energy, 0.85),
      pulse: triangleBeatPulse,
      isBeat
    };
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
      triangleLastTimestamp = 0;
      drawWave(context, values, settings.height, palette);
    } else if (settings.style === 'bars') {
      triangleLastTimestamp = 0;
      drawBars(context, values, settings.height, palette);
    } else if (settings.style === 'mirror') {
      triangleLastTimestamp = 0;
      drawMirror(context, values, settings.height, palette);
    } else if (settings.style === 'blocks') {
      triangleLastTimestamp = 0;
      drawBlocks(context, values, settings.height, palette);
    } else {
      drawTriangles(context, values, settings, palette);
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

  function drawTriangles(
    context: CanvasRenderingContext2D,
    values: number[],
    settings: VisualizerSettings,
    palette: VisualizerPalette
  ) {
    const { timestamp, deltaSeconds } = getTriangleFrameDelta();
    const heightRatio = settings.height;
    const visualTop = height * (1 - heightRatio);
    const generationSignature = getTriangleGenerationSignature(settings);

    if (generationSignature !== triangleGenerationSignature) {
      triangleGenerationSignature = generationSignature;
      triangleParticles = [];
    }

    ensureTriangleParticles(settings, values.length);

    const rhythm = updateTriangleRhythm(values, timestamp, deltaSeconds);

    if (rhythm.isBeat) {
      const flashCount = Math.ceil(2 + rhythm.amplitude * 6);

      for (let index = 0; index < flashCount; index += 1) {
        const particle = triangleParticles[Math.floor(Math.random() * triangleParticles.length)];

        if (!particle) {
          continue;
        }

        particle.flash = Math.max(particle.flash, randomRange(0.46, 1));
      }
    }

    triangleParticles.sort((left, right) => left.depth - right.depth);

    for (const particle of triangleParticles) {
      const bandValue = values[particle.bandIndex] ?? rhythm.amplitude;
      const activity = Math.max(rhythm.amplitude * 0.62, bandValue);
      const speedMultiplier = 0.12 + (activity * 1.9 + rhythm.pulse * 0.58) * settings.triangleReactiveSpeed;

      particle.flash = Math.max(0, particle.flash - deltaSeconds * (2.4 + activity * 1.4));
      particle.y -= particle.baseSpeed * speedMultiplier * deltaSeconds;

      if (particle.y < visualTop - particle.size * 4) {
        Object.assign(particle, createTriangleParticle(settings, values.length));
      }

      drawTriangleParticle(context, particle, palette, settings, bandValue, rhythm.pulse);
    }

    drawTriangleBeatFlash(context, heightRatio, palette, settings.transparency, rhythm.pulse);
  }

  function drawTriangleParticle(
    context: CanvasRenderingContext2D,
    particle: TriangleParticle,
    palette: VisualizerPalette,
    settings: VisualizerSettings,
    bandValue: number,
    pulse: number
  ) {
    const baseAlpha = settings.transparency;
    const flash = Math.max(particle.flash, pulse * 0.62);
    const size = particle.size;
    const fillColor = particle.depth > 1.08 ? palette.mid : palette.low;
    const strokeColor = flash > 0.28 ? palette.high : palette.mid;
    const borderWidth = settings.triangleBorderWidth * (window.devicePixelRatio || 1);

    context.save();
    context.translate(particle.x, particle.y);
    context.beginPath();

    for (let index = 0; index < 3; index += 1) {
      const angle = -Math.PI / 2 + index * ((Math.PI * 2) / 3);
      const x = Math.cos(angle) * size;
      const y = Math.sin(angle) * size;

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.closePath();
    context.globalAlpha = Math.min(0.94, baseAlpha * (particle.alpha * (0.72 + bandValue * 0.52) + flash * 0.32));
    context.fillStyle = fillColor;
    context.fill();

    if (borderWidth > 0) {
      context.globalAlpha = Math.min(1, baseAlpha * (0.72 + bandValue * 0.36 + flash * 0.72));
      context.strokeStyle = strokeColor;
      context.lineJoin = 'round';
      context.lineWidth = borderWidth;
      context.shadowColor = flash > 0.18 ? palette.glow : 'transparent';
      context.shadowBlur = flash > 0.18 ? size * 0.28 : 0;
      context.stroke();
      context.shadowBlur = 0;
    }

    context.restore();
  }

  function drawTriangleBeatFlash(
    context: CanvasRenderingContext2D,
    heightRatio: number,
    palette: VisualizerPalette,
    baseAlpha: number,
    pulse: number
  ) {
    if (pulse <= 0.02) {
      return;
    }

    const visualTop = height * (1 - heightRatio);
    const gradient = context.createLinearGradient(0, visualTop, 0, height);
    gradient.addColorStop(0, palette.high);
    gradient.addColorStop(0.52, palette.mid);
    gradient.addColorStop(1, palette.low);

    context.globalAlpha = Math.min(0.32, baseAlpha * pulse * 0.62);
    context.fillStyle = gradient;
    context.fillRect(0, visualTop, width, height - visualTop);
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
