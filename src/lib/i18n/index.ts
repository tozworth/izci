import { addMessages, init, locale as svelteI18nLocale, t } from 'svelte-i18n';
import { get } from 'svelte/store';
import { createPersistentStore } from '$lib/stores/persistent-store';
import en from './locales/en.json';
import enAskew from './locales/en-askew.json';
import tr from './locales/tr.json';

type AppLocale = 'en' | 'en-askew' | 'tr';

const APP_LOCALE_STORAGE_KEY = 'izci.locale';
const APP_LOCALE_CHANNEL = 'izci.locale';
export const DEFAULT_APP_LOCALE: AppLocale = 'en';
export const APP_LOCALE_OPTIONS: ReadonlyArray<{ value: AppLocale; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'en-askew', label: 'English (Askew)' },
  { value: 'tr', label: 'Türkçe' }
];

export const appLocale = createPersistentStore<AppLocale>({
  storageKey: APP_LOCALE_STORAGE_KEY,
  channelName: APP_LOCALE_CHANNEL,
  defaultValue: DEFAULT_APP_LOCALE,
  normalize: normalizeAppLocale
});

export { t };

export interface TranslationOptions {
  default?: string;
  values?: Record<string, string | number | boolean | Date | null | undefined>;
}

let initialized = false;

export function normalizeAppLocale(value: unknown): AppLocale {
  return value === 'en-askew' || value === 'tr' ? value : DEFAULT_APP_LOCALE;
}

export function initializeLocalization(): void {
  if (initialized) return;
  initialized = true;

  addMessages('en', en);
  addMessages('en-askew', enAskew);
  addMessages('tr', tr);
  void init({
    fallbackLocale: DEFAULT_APP_LOCALE,
    initialLocale: appLocale.getSnapshot()
  });

  appLocale.subscribe((nextLocale) => {
    void svelteI18nLocale.set(nextLocale);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = nextLocale;
      document.documentElement.dir = 'ltr';
    }
  });
}

export function translate(id: string, options?: TranslationOptions): string {
  return get(t)(id, options);
}
