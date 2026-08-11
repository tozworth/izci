import { appearanceSettings } from '$lib/stores/appearance-settings';
import {
  MAX_CHAMELEON_SATURATION,
  SYSTEM_FONT_FAMILY
} from '$lib/stores/appearance-settings';
import type { ColorScheme, ColorTheme } from '$lib/types';
import { findColorThemeDefinition } from '$lib/theme-definitions';
import { readable } from 'svelte/store';

export { COLOR_THEME_DEFINITIONS } from '$lib/theme-definitions';

export const systemColorScheme = readable<ColorScheme>('dark', (set) => {
  if (typeof window === 'undefined') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => set(query.matches ? 'dark' : 'light');
  update();
  query.addEventListener('change', update);
  return () => query.removeEventListener('change', update);
});

let initialized = false;

function applyThemeColor(
  theme: ColorTheme,
  scheme: ColorScheme,
  chameleonHue: number,
  chameleonSaturation: number
): void {
  const themeColor = theme === 'chameleon'
    ? `hsl(${chameleonHue} ${Math.round(chameleonSaturation * 0.32)}% ${scheme === 'light' ? 90 : 11}%)`
    : findColorThemeDefinition(theme)?.variants[scheme]?.themeColor;
  if (!themeColor) return;
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
  scheme: ColorScheme,
  chameleonHue: number,
  chameleonSaturation: number,
  fontFamily: string
): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.colorScheme = scheme;
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
  applyThemeColor(theme, scheme, chameleonHue, chameleonSaturation);
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
      scheme,
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
