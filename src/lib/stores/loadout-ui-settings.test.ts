import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOADOUT_CAPTURE_CATEGORIES,
  normalizeLoadoutUiSettings
} from './loadout-ui-settings';

describe('loadout UI settings', () => {
  it('defaults to every capture category', () => {
    expect(normalizeLoadoutUiSettings(null).captureCategories).toEqual(
      DEFAULT_LOADOUT_CAPTURE_CATEGORIES
    );
  });

  it('remembers a unique, valid category selection including an empty selection', () => {
    expect(
      normalizeLoadoutUiSettings({
        captureCategories: ['modules', 'playback', 'modules', 'nope']
      }).captureCategories
    ).toEqual(['playback']);
    expect(normalizeLoadoutUiSettings({ captureCategories: [] }).captureCategories).toEqual([]);
  });
});
