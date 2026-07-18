import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAMELEON_HUE,
  DEFAULT_CHAMELEON_SATURATION,
  MAX_CHAMELEON_HUE,
  MIN_CHAMELEON_HUE,
  MAX_CHAMELEON_SATURATION,
  MIN_CHAMELEON_SATURATION,
  normalizeChameleonHue,
  normalizeChameleonSaturation,
  normalizeContextualTabAutomation
} from './appearance-settings';

describe('normalizeChameleonHue', () => {
  it('keeps a valid hue independently usable by the appearance store', () => {
    expect(normalizeChameleonHue(214)).toBe(214);
  });

  it('rounds and clamps persisted hue values to the slider range', () => {
    expect(normalizeChameleonHue(72.6)).toBe(73);
    expect(normalizeChameleonHue(-20)).toBe(MIN_CHAMELEON_HUE);
    expect(normalizeChameleonHue(400)).toBe(MAX_CHAMELEON_HUE);
  });

  it('falls back to the default for a missing or invalid hue', () => {
    expect(normalizeChameleonHue(undefined)).toBe(DEFAULT_CHAMELEON_HUE);
    expect(normalizeChameleonHue('green')).toBe(DEFAULT_CHAMELEON_HUE);
  });
});

describe('normalizeContextualTabAutomation', () => {
  it('keeps supported automation modes and defaults invalid values to manual', () => {
    expect(normalizeContextualTabAutomation('open')).toBe('open');
    expect(normalizeContextualTabAutomation('open-close')).toBe('open-close');
    expect(normalizeContextualTabAutomation('close')).toBe('manual');
    expect(normalizeContextualTabAutomation(undefined)).toBe('manual');
  });
});

describe('normalizeChameleonSaturation', () => {
  it('rounds and clamps persisted saturation values', () => {
    expect(normalizeChameleonSaturation(64.6)).toBe(65);
    expect(normalizeChameleonSaturation(-1)).toBe(MIN_CHAMELEON_SATURATION);
    expect(normalizeChameleonSaturation(120)).toBe(MAX_CHAMELEON_SATURATION);
  });

  it('falls back to the default for a missing or invalid saturation', () => {
    expect(normalizeChameleonSaturation(undefined)).toBe(DEFAULT_CHAMELEON_SATURATION);
    expect(normalizeChameleonSaturation('bright')).toBe(DEFAULT_CHAMELEON_SATURATION);
  });
});
