import { describe, expect, it } from 'vitest';
import en from '$lib/i18n/locales/en.json';
import tr from '$lib/i18n/locales/tr.json';
import { normalizePresetIcon, PRESET_ICONS } from './preset-icons';

describe('shared preset icon palette', () => {
  it('provides forty distinct, localized symbols for the eight-by-five grid', () => {
    expect(PRESET_ICONS).toHaveLength(40);
    expect(new Set(PRESET_ICONS).size).toBe(40);
    expect(PRESET_ICONS).toContain('favorite');
    expect(PRESET_ICONS).toContain('star');
    for (const icon of PRESET_ICONS) {
      expect(en.options.presetIcons.symbols[icon]).toBeTruthy();
      expect(tr.options.presetIcons.symbols[icon]).toBeTruthy();
    }
  });

  it('accepts only palette symbols at persistence boundaries', () => {
    expect(normalizePresetIcon('favorite')).toBe('favorite');
    expect(normalizePresetIcon('star')).toBe('star');
    expect(normalizePresetIcon('unknown_symbol')).toBeUndefined();
    expect(normalizePresetIcon('default')).toBeUndefined();
    expect(normalizePresetIcon(null)).toBeUndefined();
    expect(normalizePresetIcon({ icon: 'star' })).toBeUndefined();
  });
});
