import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHAMELEON_HUE,
  DEFAULT_CHAMELEON_SATURATION,
  DEFAULT_DARK_COLOR_THEME,
  DEFAULT_LIGHT_COLOR_THEME,
  DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
  MAX_CHAMELEON_HUE,
  MIN_CHAMELEON_HUE,
  MAX_CHAMELEON_SATURATION,
  MIN_CHAMELEON_SATURATION,
  MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
  MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
  normalizeChameleonHue,
  normalizeChameleonSaturation,
  normalizeAppearanceSettings,
  normalizeContextualTabAutomation,
  normalizeSynthwaveBackgroundBrightness
} from './appearance-settings';

describe('normalizeAppearanceSettings theme selection', () => {
  it('defaults to following the system with a remembered theme for each scheme', () => {
    const settings = normalizeAppearanceSettings(undefined);

    expect(settings.colorThemeMode).toBe('system');
    expect(settings.lightColorTheme).toBe(DEFAULT_LIGHT_COLOR_THEME);
    expect(settings.darkColorTheme).toBe(DEFAULT_DARK_COLOR_THEME);
  });

  it('keeps valid scheme-specific themes and rejects themes from the other scheme', () => {
    const settings = normalizeAppearanceSettings({
      colorThemeMode: 'light',
      lightColorTheme: 'chameleon',
      darkColorTheme: 'chameleon'
    });
    const invalidSettings = normalizeAppearanceSettings({
      colorThemeMode: 'sepia',
      lightColorTheme: 'dracula',
      darkColorTheme: 'unknown'
    });

    expect(settings.colorThemeMode).toBe('light');
    expect(settings.lightColorTheme).toBe('chameleon');
    expect(settings.darkColorTheme).toBe('chameleon');
    expect(invalidSettings.colorThemeMode).toBe('system');
    expect(invalidSettings.lightColorTheme).toBe(DEFAULT_LIGHT_COLOR_THEME);
    expect(invalidSettings.darkColorTheme).toBe(DEFAULT_DARK_COLOR_THEME);
  });
});

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

describe('normalizeSynthwaveBackgroundBrightness', () => {
  it('rounds and clamps persisted brightness values', () => {
    expect(normalizeSynthwaveBackgroundBrightness(37.4)).toBe(37);
    expect(normalizeSynthwaveBackgroundBrightness(-5)).toBe(MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS);
    expect(normalizeSynthwaveBackgroundBrightness(140)).toBe(MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS);
  });

  it('falls back to the default for a missing or invalid brightness', () => {
    expect(normalizeSynthwaveBackgroundBrightness(undefined)).toBe(
      DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS
    );
    expect(normalizeSynthwaveBackgroundBrightness('neon')).toBe(
      DEFAULT_SYNTHWAVE_BACKGROUND_BRIGHTNESS
    );
  });
});
