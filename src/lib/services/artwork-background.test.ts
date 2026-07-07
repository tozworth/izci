import { describe, expect, it } from 'vitest';

import {
  getEffectiveArtworkBackgroundAnalysis,
  isArtworkBackgroundBrightForBrightness,
  type ArtworkBackgroundAnalysis
} from './artwork-background';

const brightArtwork: ArtworkBackgroundAnalysis = {
  averageLuminance: 0.84,
  brightPixelRatio: 0.64,
  isBright: true
};

const paleArtwork: ArtworkBackgroundAnalysis = {
  averageLuminance: 0.48,
  brightPixelRatio: 0.12,
  isBright: false
};

describe('artwork background brightness helpers', () => {
  it('keeps bright artwork bright at full backdrop brightness', () => {
    expect(isArtworkBackgroundBrightForBrightness(brightArtwork, 100)).toBe(true);
  });

  it('does not treat higher exposure as artificial lightening for text contrast', () => {
    const effectiveAnalysis = getEffectiveArtworkBackgroundAnalysis(paleArtwork, 1);

    expect(effectiveAnalysis.averageLuminance).toBe(0.48);
    expect(effectiveAnalysis.isBright).toBe(false);
    expect(isArtworkBackgroundBrightForBrightness(paleArtwork, 100)).toBe(false);
  });

  it('treats dimmed bright artwork as dark for text contrast', () => {
    const effectiveAnalysis = getEffectiveArtworkBackgroundAnalysis(brightArtwork, 0.05);

    expect(effectiveAnalysis.averageLuminance).toBeLessThan(0.2);
    expect(effectiveAnalysis.isBright).toBe(false);
    expect(isArtworkBackgroundBrightForBrightness(brightArtwork, 5)).toBe(false);
  });
});
