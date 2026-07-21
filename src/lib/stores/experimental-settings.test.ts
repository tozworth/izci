import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPERIMENTAL_SETTINGS, normalizeExperimentalSettings } from './experimental-settings';

describe('normalizeExperimentalSettings', () => {
  it('keeps experiments disabled by default', () => {
    expect(normalizeExperimentalSettings(undefined)).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
    expect(normalizeExperimentalSettings({ stemSeparation: 'yes' })).toEqual(
      DEFAULT_EXPERIMENTAL_SETTINGS
    );
  });

  it('accepts only an explicit stem-separation opt in', () => {
    expect(normalizeExperimentalSettings({ stemSeparation: true })).toEqual({
      stemSeparation: true
    });
  });
});
