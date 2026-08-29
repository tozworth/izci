import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_LOCALE,
  appLocale,
  initializeLocalization,
  normalizeAppLocale,
  translate
} from './index';

describe('normalizeAppLocale', () => {
  it('accepts supported locales', () => {
    expect(normalizeAppLocale('en')).toBe('en');
    expect(normalizeAppLocale('en-askew')).toBe('en-askew');
    expect(normalizeAppLocale('tr')).toBe('tr');
  });

  it('falls back to English for unsupported or malformed values', () => {
    expect(normalizeAppLocale('de')).toBe(DEFAULT_APP_LOCALE);
    expect(normalizeAppLocale(null)).toBe(DEFAULT_APP_LOCALE);
    expect(normalizeAppLocale({ locale: 'tr' })).toBe(DEFAULT_APP_LOCALE);
  });
});

describe('localization runtime', () => {
  it('formats default English messages after initialization', () => {
    initializeLocalization();
    expect(translate('test.default-message', { default: 'Default message' })).toBe('Default message');
  });

  it('loads Askew messages when the locale changes', () => {
    initializeLocalization();
    const english = translate('options.views.raf');
    appLocale.set('en-askew');
    expect(translate('options.views.raf')).toBeTruthy();
    expect(translate('options.views.raf')).not.toBe(english);
    appLocale.reset();
  });
});
