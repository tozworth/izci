import { appearanceSettings } from '$lib/stores/appearance-settings';
import {
  MAX_CHAMELEON_SATURATION,
  SYSTEM_FONT_FAMILY
} from '$lib/stores/appearance-settings';
import type { ColorScheme, ColorTheme } from '$lib/types';
import { readable } from 'svelte/store';

export const COLOR_THEME_OPTIONS: Array<{ value: ColorTheme; scheme: ColorScheme }> = [
  { value: 'pale-light', scheme: 'light' },
  { value: 'pale-dark', scheme: 'dark' },
  { value: 'lights-out', scheme: 'dark' },
  { value: 'solarized-light', scheme: 'light' },
  { value: 'solarized-dark', scheme: 'dark' },
  { value: 'nordic-light', scheme: 'light' },
  { value: 'nordic-dark', scheme: 'dark' },
  { value: 'chameleon-light', scheme: 'light' },
  { value: 'gruvbox', scheme: 'dark' },
  { value: 'dracula', scheme: 'dark' },
  { value: 'ember', scheme: 'dark' },
  { value: 'chameleon-dark', scheme: 'dark' }
];

export const systemColorScheme = readable<ColorScheme>('dark', (set) => {
  if (typeof window === 'undefined') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => set(query.matches ? 'dark' : 'light');
  update();
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
});

const THEME_COLOR_BY_THEME: Record<ColorTheme, string> = {
  'pale-light': '#e4e3e0',
  'pale-dark': '#101113',
  'lights-out': '#000000',
  'solarized-light': '#eee8d5',
  'solarized-dark': '#002b36',
  'nordic-light': '#e5e9f0',
  'nordic-dark': '#1b222d',
  'chameleon-light': '#e5e9ed',
  gruvbox: '#1c1d1e',
  dracula: '#1f2029',
  ember: '#1c1110',
  'chameleon-dark': '#141a20'
};

let initialized = false;

function applyThemeColor(
  theme: ColorTheme,
  chameleonHue: number,
  chameleonSaturation: number
): void {
  const themeColor = theme === 'chameleon-light'
    ? `hsl(${chameleonHue} ${Math.round(chameleonSaturation * 0.32)}% 90%)`
    : theme === 'chameleon-dark'
      ? `hsl(${chameleonHue} ${Math.round(chameleonSaturation * 0.32)}% 11%)`
      : THEME_COLOR_BY_THEME[theme];
  let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.name = 'theme-color';
    document.head.append(themeColorMeta);
  }

  themeColorMeta.content = themeColor;
}

function applyTheme(
  theme: ColorTheme,
  chameleonHue: number,
  chameleonSaturation: number,
  fontFamily: string
): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--chameleon-hue', String(chameleonHue));
  document.documentElement.style.setProperty(
    '--chameleon-surface-saturation',
    `${Math.round(chameleonSaturation * 0.32)}%`
  );
  document.documentElement.style.setProperty(
    '--chameleon-text-saturation',
    `${Math.round(chameleonSaturation * 0.2)}%`
  );
  document.documentElement.style.setProperty(
    '--chameleon-border-saturation',
    `${Math.round(chameleonSaturation * 0.68)}%`
  );
  document.documentElement.style.setProperty(
    '--chameleon-accent-saturation',
    `${chameleonSaturation}%`
  );
  document.documentElement.style.setProperty(
    '--chameleon-vivid-saturation',
    `${Math.min(chameleonSaturation + 8, MAX_CHAMELEON_SATURATION)}%`
  );
  document.documentElement.style.setProperty(
    '--app-font-family',
    fontFamily === SYSTEM_FONT_FAMILY
      ? 'var(--system-font-family)'
      : `${JSON.stringify(fontFamily)}, var(--system-font-family)`
  );
  applyThemeColor(theme, chameleonHue, chameleonSaturation);
}

export function initializeTheme(): void {
  if (initialized || typeof document === 'undefined') {
    return;
  }

  initialized = true;
  let settings = appearanceSettings.getSnapshot();
  let systemScheme: ColorScheme = 'dark';
  const update = () => {
    const scheme = settings.colorThemeMode === 'system' ? systemScheme : settings.colorThemeMode;
    const theme: ColorTheme = scheme === 'light'
      ? settings.lightColorTheme
      : settings.darkColorTheme;
    applyTheme(
      theme,
      settings.chameleonHue,
      settings.chameleonSaturation,
      settings.fontFamily
    );
  };
  systemColorScheme.subscribe((nextScheme) => {
    systemScheme = nextScheme;
    update();
  });
  appearanceSettings.subscribe((nextSettings) => {
    settings = nextSettings;
    update();
  });
}
