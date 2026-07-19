import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_LOCALE, initializeLocalization, normalizeAppLocale, translate } from './index';

describe('normalizeAppLocale', () => {
  it('accepts supported locales', () => {
    expect(normalizeAppLocale('en')).toBe('en');
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
});
