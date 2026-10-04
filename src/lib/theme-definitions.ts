import type { ColorScheme, ColorTheme } from '$lib/types';

interface ColorThemeVariantDefinition {
  themeColor: string;
}

interface ColorThemeDefinition {
  value: ColorTheme;
  variants: Partial<Record<ColorScheme, ColorThemeVariantDefinition>>;
}

export const COLOR_THEME_DEFINITIONS: ColorThemeDefinition[] = [
  {
    value: 'pale',
    variants: {
      light: { themeColor: '#e4e3e0' },
      dark: { themeColor: '#101113' }
    }
  },
  {
    value: 'accented',
    variants: {
      light: { themeColor: '#e4e3e0' },
      dark: { themeColor: '#101113' }
    }
  },
  { value: 'lights-out', variants: { dark: { themeColor: '#000000' } } },
  {
    value: 'solarized',
    variants: {
      light: { themeColor: '#eee8d5' },
      dark: { themeColor: '#002b36' }
    }
  },
  {
    value: 'nordic',
    variants: {
      light: { themeColor: '#e5e9f0' },
      dark: { themeColor: '#1b222d' }
    }
  },
  {
    value: 'chameleon',
    variants: {
      light: { themeColor: '#e5e9ed' },
      dark: { themeColor: '#141a20' }
    }
  },
  { value: 'gruvbox', variants: { dark: { themeColor: '#1c1d1e' } } },
  { value: 'dracula', variants: { dark: { themeColor: '#1f2029' } } },
  { value: 'ember', variants: { dark: { themeColor: '#1c1110' } } },
  { value: 'synthwave', variants: { dark: { themeColor: '#150d2e' } } }
];

export function findColorThemeDefinition(theme: unknown): ColorThemeDefinition | undefined {
  return COLOR_THEME_DEFINITIONS.find((definition) => definition.value === theme);
}

export function hasColorThemeVariant(theme: unknown, scheme: ColorScheme): theme is ColorTheme {
  return findColorThemeDefinition(theme)?.variants[scheme] !== undefined;
}
