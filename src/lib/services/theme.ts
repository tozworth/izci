import { appearanceSettings } from '$lib/stores/appearance-settings';
import {
  MAX_CHAMELEON_SATURATION,
  SYSTEM_FONT_FAMILY
} from '$lib/stores/appearance-settings';
import type { ColorTheme } from '$lib/types';

export const COLOR_THEME_OPTIONS: Array<{ value: ColorTheme; label: string }> = [
  { value: 'gray', label: 'Gray (default)' },
  { value: 'ash', label: 'Ash' },
  { value: 'coal', label: 'Coal' },
  { value: 'lights-out', label: 'Lights Out' },
  { value: 'nordic', label: 'Nordic' },
  { value: 'gruvbox', label: 'Gruvbox' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'ember', label: 'Ember' },
  { value: 'chameleon', label: 'Chameleon' }
];

const THEME_COLOR_BY_THEME: Record<ColorTheme, string> = {
  gray: '#18191b',
  ash: '#e4e3e0',
  coal: '#101113',
  'lights-out': '#000000',
  nordic: '#1b222d',
  gruvbox: '#1c1d1e',
  dracula: '#1f2029',
  ember: '#1c1110',
  chameleon: '#141a20'
};

let initialized = false;

function applyThemeColor(
  theme: ColorTheme,
  chameleonHue: number,
  chameleonSaturation: number
): void {
  const themeColor = theme === 'chameleon'
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
  const initialSettings = appearanceSettings.getSnapshot();
  applyTheme(
    initialSettings.colorTheme,
    initialSettings.chameleonHue,
    initialSettings.chameleonSaturation,
    initialSettings.fontFamily
  );
  appearanceSettings.subscribe((settings) => {
    applyTheme(
      settings.colorTheme,
      settings.chameleonHue,
      settings.chameleonSaturation,
      settings.fontFamily
    );
  });
}
