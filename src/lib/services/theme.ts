import { appearanceSettings } from '$lib/stores/appearance-settings';
import { SYSTEM_FONT_FAMILY } from '$lib/stores/appearance-settings';
import type { ColorTheme } from '$lib/types';

export const COLOR_THEME_OPTIONS: Array<{ value: ColorTheme; label: string }> = [
  { value: 'gray', label: 'Gray (default)' },
  { value: 'coal', label: 'Coal' },
  { value: 'lights-out', label: 'Lights Out' },
  { value: 'nordic', label: 'Nordic' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'ember', label: 'Ember' }
];

const THEME_COLOR_BY_THEME: Record<ColorTheme, string> = {
  gray: '#18191b',
  coal: '#101113',
  'lights-out': '#000000',
  nordic: '#1b222d',
  gruvbox: '#1c1d1e',
  dracula: '#1f2029',
  ember: '#1c1110'
};

let initialized = false;

function applyThemeColor(theme: ColorTheme): void {
  const themeColor = THEME_COLOR_BY_THEME[theme];
  let themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (!themeColorMeta) {
    themeColorMeta = document.createElement('meta');
    themeColorMeta.name = 'theme-color';
    document.head.append(themeColorMeta);
  }

  themeColorMeta.content = themeColor;
}

function applyTheme(theme: ColorTheme, fontFamily: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty(
    '--app-font-family',
    fontFamily === SYSTEM_FONT_FAMILY
      ? 'var(--system-font-family)'
      : `${JSON.stringify(fontFamily)}, var(--system-font-family)`
  );
  applyThemeColor(theme);
}

export function initializeTheme(): void {
  if (initialized || typeof document === 'undefined') {
    return;
  }

  initialized = true;
  const initialSettings = appearanceSettings.getSnapshot();
  applyTheme(initialSettings.colorTheme, initialSettings.fontFamily);
  appearanceSettings.subscribe((settings) => {
    applyTheme(settings.colorTheme, settings.fontFamily);
  });
}
