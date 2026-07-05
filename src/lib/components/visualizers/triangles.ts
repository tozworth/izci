import type { VisualizerPalette } from '$lib/services/artwork-palette';
import type { VisualizerSettings } from '$lib/types';

const TRIANGLE_SIDE_X = Math.sqrt(3) / 2;
const TRIANGLE_EDGE_FADE_SIZE_FACTOR = 1.4;
const TRIANGLE_SIZE_DAMPENING_START_PX = 160;
const TRIANGLE_SIZE_DAMPENING_EXPONENT = 0.56;
const TRIANGLE_SIZE_REFERENCE_MAX_PX = 340;

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

export interface TriangleVisualizerMetrics {
  width: number;
  height: number;
  displayScale: number;
}

export class TriangleVisualizerRenderer {
  private particles: TriangleParticle[] = [];
  private particlesNeedSort = false;
  private lastTimestamp = 0;
  private rollingEnergy = 0.12;
  private rollingLow = 0.12;
  private beatPulse = 0;
  private lastBeatAt = 0;
  private generationSignature = '';
  private referenceHeight = 0;
  private motionReferenceHeight = 0;
  private observedSelector: string | null = null;
  private referenceElement: Element | null = null;
  private referenceObserver: ResizeObserver | null = null;
  private metrics: TriangleVisualizerMetrics = {
    width: 1,
    height: 1,
    displayScale: 1
  };

  resetParticles(): void {
    this.particles = [];
    this.particlesNeedSort = true;
  }

  resetFrameTiming(): void {
    this.lastTimestamp = 0;
  }

  syncSizeReference(selector: string | null, metrics: TriangleVisualizerMetrics): void {
    this.metrics = metrics;

    if (
      this.observedSelector === selector &&
      (!selector || this.referenceElement)
    ) {
      return;
    }

    this.referenceObserver?.disconnect();
    this.referenceObserver = null;
    this.observedSelector = selector;
    this.referenceElement = selector ? document.querySelector(selector) : null;

    if (this.referenceElement && typeof ResizeObserver !== 'undefined') {
      this.referenceObserver = new ResizeObserver(() => this.updateReferenceHeight());
      this.referenceObserver.observe(this.referenceElement);
    }

    this.updateReferenceHeight();
  }

  disconnect(): void {
    this.referenceObserver?.disconnect();
    this.referenceObserver = null;
    this.referenceElement = null;
  }

  render(
    context: CanvasRenderingContext2D,
    values: number[],
    settings: VisualizerSettings,
    palette: VisualizerPalette,
    timestamp: number,
    metrics: TriangleVisualizerMetrics
  ): void {
    this.metrics = metrics;
    const { deltaSeconds } = this.getFrameDelta(timestamp);
    const heightRatio = settings.height;
    const visualTop = metrics.height * (1 - heightRatio);
    this.referenceHeight = this.getReferenceHeight();
    this.motionReferenceHeight = this.getMotionReferenceHeight();
    const generationSignature = this.getGenerationSignature(settings);

    if (generationSignature !== this.generationSignature) {
      this.generationSignature = generationSignature;
      this.resetParticles();
    }

    this.ensureParticles(settings, values.length);
    this.sortParticlesIfNeeded();

    const rhythm = this.updateRhythm(values, timestamp, deltaSeconds);

    if (rhythm.isBeat) {
      const flashCount = Math.ceil(2 + rhythm.amplitude * 6);

      for (let index = 0; index < flashCount; index += 1) {
        const particle = this.particles[Math.floor(Math.random() * this.particles.length)];

        if (!particle) {
          continue;
        }

        particle.flash = Math.max(particle.flash, randomRange(0.46, 1));
      }
    }

    const borderWidth = settings.triangleBorderWidth * metrics.displayScale;

    for (const particle of this.particles) {
      const bandValue = values[particle.bandIndex] ?? rhythm.amplitude;
      const activity = Math.max(rhythm.amplitude * 0.62, bandValue);
      const speedMultiplier = 0.12 + (activity * 1.9 + rhythm.pulse * 0.58) * settings.triangleReactiveSpeed;

      particle.flash = Math.max(0, particle.flash - deltaSeconds * (2.4 + activity * 1.4));
      particle.y -= particle.baseSpeed * speedMultiplier * deltaSeconds;

      const visibilityAlpha = this.getVisibilityAlpha(particle, visualTop);

      if (
        particle.y + particle.size * 0.5 <
        visualTop - particle.size * TRIANGLE_EDGE_FADE_SIZE_FACTOR
      ) {
        Object.assign(particle, this.createParticle(settings, values.length));
        this.particlesNeedSort = true;
        continue;
      }

      this.drawParticle(context, particle, palette, settings, bandValue, rhythm.pulse, borderWidth, visibilityAlpha);
    }

    this.drawBeatFlash(context, heightRatio, palette, settings.transparency, rhythm.pulse);
    this.sortParticlesIfNeeded();
  }

  private updateReferenceHeight(): void {
    const { height, displayScale } = this.metrics;

    if (!this.observedSelector || !this.referenceElement) {
      this.referenceHeight = this.getDampenedReferenceHeight(height);
      return;
    }

    const referenceRect = this.referenceElement.getBoundingClientRect();
    const referenceHeight = referenceRect.height * displayScale;
    const nextHeight = this.getDampenedReferenceHeight(Math.max(1, Math.round(referenceHeight || height)));

    if (nextHeight !== this.referenceHeight) {
      this.referenceHeight = nextHeight;
      this.generationSignature = '';
      this.particlesNeedSort = true;
    }
  }

  private getReferenceHeight(): number {
    if (!this.observedSelector) {
      return this.metrics.height;
    }

    return this.referenceHeight || this.getDampenedReferenceHeight(this.metrics.height);
  }

  private getMotionReferenceHeight(): number {
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight * this.metrics.displayScale;

    return Math.max(1, Math.round(Math.max(this.metrics.height, viewportHeight)));
  }

  private getDampenedReferenceHeight(referenceHeight: number): number {
    const scale = Math.max(1, this.metrics.displayScale);
    const referenceHeightPx = referenceHeight / scale;

    if (referenceHeightPx <= TRIANGLE_SIZE_DAMPENING_START_PX) {
      return referenceHeight;
    }

    const dampenedHeightPx =
      TRIANGLE_SIZE_DAMPENING_START_PX *
      Math.pow(referenceHeightPx / TRIANGLE_SIZE_DAMPENING_START_PX, TRIANGLE_SIZE_DAMPENING_EXPONENT);
    const cappedHeightPx = Math.min(dampenedHeightPx, TRIANGLE_SIZE_REFERENCE_MAX_PX);

    return Math.max(1, Math.round(cappedHeightPx * scale));
  }

  private getGenerationSignature(settings: VisualizerSettings): string {
    return [
      settings.height,
      settings.triangleMinSize,
      settings.triangleMaxSize,
      settings.triangleBaseSpeed,
      this.referenceHeight,
      this.motionReferenceHeight
    ].join(':');
  }

  private ensureParticles(settings: VisualizerSettings, bandCount: number): void {
    const targetCount = Math.round(settings.triangleCount);

    while (this.particles.length < targetCount) {
      this.particles.push(this.createParticle(settings, bandCount));
      this.particlesNeedSort = true;
    }

    if (this.particles.length > targetCount) {
      this.particles.length = targetCount;
      this.particlesNeedSort = true;
    }
  }

  private createParticle(settings: VisualizerSettings, bandCount: number): TriangleParticle {
    const { width, height } = this.metrics;
    const heightRatio = settings.height;
    const visualTop = height * (1 - heightRatio);
    const visualHeight = Math.max(1, height - visualTop);
    const depth = randomRange(0.72, 1.62);
    const sizeReferenceHeight = Math.max(1, this.referenceHeight || height);
    const motionReferenceHeight = Math.max(sizeReferenceHeight, this.motionReferenceHeight * heightRatio);
    const minSize = Math.max(8, sizeReferenceHeight * settings.triangleMinSize);
    const maxSize = Math.max(minSize + 4, sizeReferenceHeight * settings.triangleMaxSize);
    const size = randomRange(minSize, maxSize) * depth;
    const xMargin = Math.min(width * 0.12, size * 0.28);

    return {
      x: width <= xMargin * 2 ? width / 2 : randomRange(xMargin, width - xMargin),
      y: randomRange(height + size * 1.15, height + visualHeight * 1.15 + size * 2),
      size,
      baseSpeed:
        randomRange(motionReferenceHeight * 0.08, motionReferenceHeight * 0.3) *
        depth *
        settings.triangleBaseSpeed,
      depth,
      alpha: randomRange(0.48, 0.9),
      bandIndex: Math.floor(randomRange(0, Math.max(1, bandCount))),
      flash: 0
    };
  }

  private getVisibilityAlpha(particle: TriangleParticle, visualTop: number): number {
    const { height } = this.metrics;
    const size = particle.size;
    const top = particle.y - size;
    const bottom = particle.y + size * 0.5;
    const fadeDistance = Math.max(1, size * TRIANGLE_EDGE_FADE_SIZE_FACTOR);
    const bottomFade = clamp01((height - top) / fadeDistance);
    const topFade = clamp01((bottom - visualTop) / fadeDistance);

    return Math.min(bottomFade, topFade);
  }

  private sortParticlesIfNeeded(): void {
    if (!this.particlesNeedSort) {
      return;
    }

    this.particles.sort((left, right) => left.depth - right.depth);
    this.particlesNeedSort = false;
  }

  private getFrameDelta(timestamp: number): { deltaSeconds: number } {
    const deltaSeconds = this.lastTimestamp
      ? Math.min(0.08, Math.max(0.001, (timestamp - this.lastTimestamp) / 1000))
      : 1 / 60;

    this.lastTimestamp = timestamp;
    return { deltaSeconds };
  }

  private updateRhythm(values: number[], timestamp: number, deltaSeconds: number): TriangleRhythm {
    const low = average(values, 0, 18);
    const mid = average(values, 18, 46);
    const high = average(values, 46, values.length);
    const energy = clamp01(low * 0.5 + mid * 0.32 + high * 0.18);
    const previousEnergy = this.rollingEnergy;
    const previousLow = this.rollingLow;
    const onset = energy - previousEnergy;
    const lowOnset = low - previousLow;
    const enoughBeatGap = timestamp - this.lastBeatAt > 145;
    const isBeat =
      enoughBeatGap &&
      energy > 0.12 &&
      (onset > 0.055 + previousEnergy * 0.12 ||
        lowOnset > 0.065 + previousLow * 0.1 ||
        (energy > 0.62 && onset > 0.025));

    this.beatPulse *= Math.pow(0.035, deltaSeconds);

    if (isBeat) {
      this.beatPulse = Math.max(this.beatPulse, Math.min(1, 0.38 + energy * 0.78));
      this.lastBeatAt = timestamp;
    }

    this.rollingEnergy = previousEnergy * 0.94 + Math.max(energy, 0.025) * 0.06;
    this.rollingLow = previousLow * 0.92 + Math.max(low, 0.025) * 0.08;

    return {
      amplitude: Math.pow(energy, 0.85),
      pulse: this.beatPulse,
      isBeat
    };
  }

  private drawParticle(
    context: CanvasRenderingContext2D,
    particle: TriangleParticle,
    palette: VisualizerPalette,
    settings: VisualizerSettings,
    bandValue: number,
    pulse: number,
    borderWidth: number,
    visibilityAlpha: number
  ): void {
    if (visibilityAlpha <= 0) {
      return;
    }

    const baseAlpha = settings.transparency;
    const flash = Math.max(particle.flash, pulse * 0.62);
    const size = particle.size;
    const fillColor = particle.depth > 1.08 ? palette.mid : palette.low;
    const strokeColor = flash > 0.28 ? palette.high : palette.mid;
    const x = particle.x;
    const y = particle.y;

    context.beginPath();
    context.moveTo(x, y - size);
    context.lineTo(x + size * TRIANGLE_SIDE_X, y + size * 0.5);
    context.lineTo(x - size * TRIANGLE_SIDE_X, y + size * 0.5);
    context.closePath();
    context.globalAlpha = Math.min(
      0.94,
      baseAlpha * visibilityAlpha * (particle.alpha * (0.72 + bandValue * 0.52) + flash * 0.32)
    );
    context.fillStyle = fillColor;
    context.fill();

    if (borderWidth > 0) {
      context.globalAlpha = Math.min(1, baseAlpha * visibilityAlpha * (0.72 + bandValue * 0.36 + flash * 0.72));
      context.strokeStyle = strokeColor;
      context.lineJoin = 'round';
      context.lineWidth = borderWidth;
      context.shadowColor = flash > 0.18 ? palette.glow : 'transparent';
      context.shadowBlur = flash > 0.18 ? size * 0.28 : 0;
      context.stroke();
      context.shadowBlur = 0;
    }
  }

  private drawBeatFlash(
    context: CanvasRenderingContext2D,
    heightRatio: number,
    palette: VisualizerPalette,
    baseAlpha: number,
    pulse: number
  ): void {
    if (pulse <= 0.02) {
      return;
    }

    const { width, height } = this.metrics;
    const visualTop = height * (1 - heightRatio);
    const gradient = context.createLinearGradient(0, visualTop, 0, height);
    gradient.addColorStop(0, palette.high);
    gradient.addColorStop(0.52, palette.mid);
    gradient.addColorStop(1, palette.low);

    context.globalAlpha = Math.min(0.32, baseAlpha * pulse * 0.62);
    context.fillStyle = gradient;
    context.fillRect(0, visualTop, width, height - visualTop);
  }
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

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
