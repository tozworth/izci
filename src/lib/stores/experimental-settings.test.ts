import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPERIMENTAL_SETTINGS, normalizeExperimentalSettings } from './experimental-settings';

describe('experimental settings normalization', () => {
  it('keeps the Raf effects-list preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: true })).toEqual({ rafEffectsList: true });
    expect(normalizeExperimentalSettings({ rafEffectsList: false })).toEqual({ rafEffectsList: false });
  });

  it('uses the default for missing or malformed values', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: 'yes' })).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
    expect(normalizeExperimentalSettings(null)).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });
});
