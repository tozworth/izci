const ARTWORK_SAMPLE_SIZE = 32;
const paletteCache = new Map<string, Promise<ArtworkPalette>>();

export interface VisualizerPalette {
  high: string;
  mid: string;
  low: string;
  glow: string;
  bars: string;
  blocks: string;
}

export interface PlayerArtworkColorSet {
  text: string;
  textStrong: string;
  muted: string;
  rangeFill: string;
  rangeTrack: string;
  rangeBorder: string;
  rangeThumb: string;
}

export interface PlayerArtworkPalette extends PlayerArtworkColorSet {
  background: string;
  soft: string;
  popover: string;
  border: string;
  hover: string;
  separator: string;
  hairline: string;
  visualizerBlendMode: string;
  onLightBackground: PlayerArtworkColorSet;
}

interface ArtworkPalette {
  visualizer: VisualizerPalette;
  player: PlayerArtworkPalette;
}

interface Swatch {
  r: number;
  g: number;
  b: number;
  score: number;
  saturation: number;
  lightness: number;
}

export async function extractArtworkPalette(url: string): Promise<ArtworkPalette> {
  const cached = paletteCache.get(url);

  if (cached) {
    return cached;
  }

  const promise = sampleArtworkPalette(url);
  paletteCache.set(url, promise);

  try {
    return await promise;
  } catch (error) {
    paletteCache.delete(url);
    throw error;
  }
}

async function sampleArtworkPalette(url: string): Promise<ArtworkPalette> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;

  await image.decode();

  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = ARTWORK_SAMPLE_SIZE;
  sampleCanvas.height = ARTWORK_SAMPLE_SIZE;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    throw new Error('Unable to sample artwork.');
  }

  context.drawImage(image, 0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE);
  const { data } = context.getImageData(0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE);
  const swatches: Swatch[] = [];

  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;

    if (alpha < 0.45) {
      continue;
    }

    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const { saturation, lightness } = rgbToHsl(r, g, b);

    if (lightness < 0.08 || lightness > 0.94 || saturation < 0.08) {
      continue;
    }

    const vibrance = saturation * (1 - Math.abs(lightness - 0.55));
    swatches.push({ r, g, b, score: vibrance, saturation, lightness });
  }

  if (!swatches.length) {
    throw new Error('Artwork has no usable palette colors.');
  }

  swatches.sort((left, right) => right.score - left.score);

  const primary = swatches[0];
  const secondary = findDistinctSwatch(swatches, primary) ?? primary;
  const darkest = [...swatches].sort((left, right) => left.lightness - right.lightness)[0] ?? primary;
  const lightest = [...swatches].sort((left, right) => right.lightness - left.lightness)[0] ?? primary;
  const darkPoint = normalizeForText(darkest, 0.16);
  const lightPoint = normalizeForText(lightest, 0.88);
  const accent = adjustRgb(primary, 1.18, 10);
  const accentTwo = adjustRgb(secondary, 1.04, 0);
  const darkAccent = normalizeForText(primary, 0.24);
  const highlight = adjustRgb(primary, 1.22, 22);
  const visualizerMid = adjustRgb(primary, 1.02, 0);
  const visualizerLow = adjustRgb(secondary, 0.86, -8);

  return {
    visualizer: {
      high: toRgba(highlight, 0.88),
      mid: toRgba(visualizerMid, 0.68),
      low: toRgba(visualizerLow, 0.32),
      glow: toRgba(highlight, 0.32),
      bars: toRgba(visualizerMid, 0.82),
      blocks: toRgba(highlight, 0.7)
    },
    player: {
      background: `linear-gradient(90deg, ${toRgba(darkPoint, 0.86)}, ${toRgba(accentTwo, 0.34)} 50%, ${toRgba(darkPoint, 0.78)})`,
      text: toRgba(lightPoint, 0.92),
      textStrong: toRgb(lightPoint),
      muted: toRgba(lightPoint, 0.72),
      soft: toRgba(darkPoint, 0.48),
      popover: toRgba(darkPoint, 0.88),
      border: toRgba(lightPoint, 0.2),
      hover: toRgba(lightPoint, 0.1),
      separator: toRgba(accent, 0.36),
      hairline: toRgba(lightPoint, 0.1),
      rangeFill: toRgba(accent, 0.92),
      rangeTrack: toRgba(darkPoint, 0.74),
      rangeBorder: toRgba(lightPoint, 0.34),
      rangeThumb: toRgb(adjustRgb(accent, 1.16, 24)),
      visualizerBlendMode: 'screen',
      onLightBackground: {
        text: toRgba(darkPoint, 0.9),
        textStrong: toRgb(darkPoint),
        muted: toRgba(darkPoint, 0.68),
        rangeFill: toRgba(darkAccent, 0.92),
        rangeTrack: toRgba(darkPoint, 0.28),
        rangeBorder: toRgba(darkPoint, 0.34),
        rangeThumb: toRgb(adjustRgb(darkAccent, 1.08, -4))
      }
    }
  };
}

function findDistinctSwatch(swatches: Swatch[], primary: { r: number; g: number; b: number }): Swatch | undefined {
  return swatches.find((swatch) => colorDistance(swatch, primary) > 72);
}

function colorDistance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
}

function rgbToHsl(r: number, g: number, b: number): { saturation: number; lightness: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  return { saturation, lightness };
}

function normalizeForText(color: { r: number; g: number; b: number }, targetLightness: number): { r: number; g: number; b: number } {
  const current = rgbToHsl(color.r, color.g, color.b).lightness;
  const delta = (targetLightness - current) * 255;
  return adjustRgb(color, 0.72, delta);
}

function adjustRgb(
  color: { r: number; g: number; b: number },
  saturationFactor: number,
  lightnessDelta: number
): { r: number; g: number; b: number } {
  const gray = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;

  return {
    r: clampColor(gray + (color.r - gray) * saturationFactor + lightnessDelta),
    g: clampColor(gray + (color.g - gray) * saturationFactor + lightnessDelta),
    b: clampColor(gray + (color.b - gray) * saturationFactor + lightnessDelta)
  };
}

function clampColor(value: number): number {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function toRgb(color: { r: number; g: number; b: number }): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

function toRgba(color: { r: number; g: number; b: number }, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}
