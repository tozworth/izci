import { appearanceSettings } from '$lib/stores/appearance-settings';
import type { ColorTheme } from '$lib/types';

export const COLOR_THEME_OPTIONS: Array<{ value: ColorTheme; label: string }> = [
  { value: 'gruvbox', label: 'Gruvbox (default)' },
  { value: 'dracula', label: 'Dracula' }
];

let initialized = false;

function applyTheme(theme: ColorTheme): void {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.dataset.theme = theme;
}

export function initializeTheme(): void {
  if (initialized || typeof document === 'undefined') {
    return;
  }

  initialized = true;
  applyTheme(appearanceSettings.getSnapshot().colorTheme);
  appearanceSettings.subscribe((settings) => {
    applyTheme(settings.colorTheme);
  });
}
