import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPERIMENTAL_SETTINGS, normalizeExperimentalSettings } from './experimental-settings';

describe('experimental settings normalization', () => {
  it('keeps the Raf effects-list preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: true })).toEqual({
      rafEffectsList: true,
      singlePageMode: false
    });
    expect(normalizeExperimentalSettings({ rafEffectsList: false })).toEqual({
      rafEffectsList: false,
      singlePageMode: false
    });
  });

  it('keeps the single-page preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ singlePageMode: true })).toEqual({
      rafEffectsList: false,
      singlePageMode: true
    });
  });

  it('uses the default for missing or malformed values', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: 'yes' })).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
    expect(normalizeExperimentalSettings(null)).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });
});
