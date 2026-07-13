import { describe, expect, it } from 'vitest';

import { DEFAULT_EXPERIMENTAL_SETTINGS, normalizeExperimentalSettings } from './experimental-settings';

describe('experimental settings normalization', () => {
  it('keeps the Raf effects-list preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: true })).toEqual({
      hideRedundantAlbumMetadata: false,
      rafEffectsList: true,
      singlePageMode: false
    });
    expect(normalizeExperimentalSettings({ rafEffectsList: false })).toEqual({
      hideRedundantAlbumMetadata: false,
      rafEffectsList: false,
      singlePageMode: false
    });
  });

  it('keeps the single-page preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ singlePageMode: true })).toEqual({
      hideRedundantAlbumMetadata: false,
      rafEffectsList: false,
      singlePageMode: true
    });
  });

  it('keeps the redundant album metadata preference when it is boolean', () => {
    expect(normalizeExperimentalSettings({ hideRedundantAlbumMetadata: true })).toEqual({
      hideRedundantAlbumMetadata: true,
      rafEffectsList: false,
      singlePageMode: false
    });
  });

  it('uses the default for missing or malformed values', () => {
    expect(normalizeExperimentalSettings({ rafEffectsList: 'yes' })).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
    expect(normalizeExperimentalSettings(null)).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });
});
