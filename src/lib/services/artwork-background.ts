import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';

const ANALYSIS_SIZE = 24;
const BRIGHT_AVERAGE_LUMINANCE = 0.72;
const BRIGHT_MIXED_LUMINANCE = 0.62;
const BRIGHT_PIXEL_LUMINANCE = 0.82;
const BRIGHT_PIXEL_RATIO = 0.28;

export interface ArtworkBackgroundAnalysis {
  averageLuminance: number;
  brightPixelRatio: number;
  isBright: boolean;
}

export const DEFAULT_ARTWORK_BACKGROUND_ANALYSIS: ArtworkBackgroundAnalysis = {
  averageLuminance: 0,
  brightPixelRatio: 0,
  isBright: false
};

const DEFAULT_RENDERED_BRIGHTNESS = 0.42;

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_RENDERED_BRIGHTNESS;
  }

  return Math.min(Math.max(value, 0), 1);
}

export function getEffectiveArtworkBackgroundAnalysis(
  analysis: ArtworkBackgroundAnalysis,
  renderedBrightness: number
): ArtworkBackgroundAnalysis {
  const brightness = clampUnit(renderedBrightness);
  const averageLuminance = analysis.averageLuminance * brightness;
  const brightPixelRatio = analysis.brightPixelRatio * brightness;
  const isBright =
    averageLuminance >= BRIGHT_AVERAGE_LUMINANCE ||
    (averageLuminance >= BRIGHT_MIXED_LUMINANCE && brightPixelRatio >= BRIGHT_PIXEL_RATIO);

  return {
    averageLuminance,
    brightPixelRatio,
    isBright
  };
}

export function isArtworkBackgroundBrightForBrightness(
  analysis: ArtworkBackgroundAnalysis,
  brightnessPercent: number
): boolean {
  return getEffectiveArtworkBackgroundAnalysis(analysis, brightnessPercent / 100).isBright;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load artwork image.'));
    image.src = url;
  });
}

function getScaledDimensions(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: ANALYSIS_SIZE, height: ANALYSIS_SIZE };
  }

  if (width >= height) {
    return {
      width: ANALYSIS_SIZE,
      height: Math.max(1, Math.round((height / width) * ANALYSIS_SIZE))
    };
  }

  return {
    width: Math.max(1, Math.round((width / height) * ANALYSIS_SIZE)),
    height: ANALYSIS_SIZE
  };
}

export async function analyzeArtworkBackground(
  artwork: LoadedStreamArtwork | null | undefined
): Promise<ArtworkBackgroundAnalysis> {
  if (!artwork || typeof document === 'undefined') {
    return DEFAULT_ARTWORK_BACKGROUND_ANALYSIS;
  }

  try {
    const image = await loadImage(artwork.url);
    const { width, height } = getScaledDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return DEFAULT_ARTWORK_BACKGROUND_ANALYSIS;
    }

    context.drawImage(image, 0, 0, width, height);

    const { data } = context.getImageData(0, 0, width, height);
    let totalAlpha = 0;
    let totalLuminance = 0;
    let brightPixels = 0;

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;

      if (alpha <= 0) {
        continue;
      }

      const red = data[index] / 255;
      const green = data[index + 1] / 255;
      const blue = data[index + 2] / 255;
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

      totalAlpha += alpha;
      totalLuminance += luminance * alpha;

      if (luminance >= BRIGHT_PIXEL_LUMINANCE) {
        brightPixels += alpha;
      }
    }

    if (totalAlpha <= 0) {
      return DEFAULT_ARTWORK_BACKGROUND_ANALYSIS;
    }

    const averageLuminance = totalLuminance / totalAlpha;
    const brightPixelRatio = brightPixels / totalAlpha;
    const isBright =
      averageLuminance >= BRIGHT_AVERAGE_LUMINANCE ||
      (averageLuminance >= BRIGHT_MIXED_LUMINANCE && brightPixelRatio >= BRIGHT_PIXEL_RATIO);

    return {
      averageLuminance,
      brightPixelRatio,
      isBright
    };
  } catch {
    return DEFAULT_ARTWORK_BACKGROUND_ANALYSIS;
  }
}
