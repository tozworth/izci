import type { LoadoutColor, LoadoutType } from '$lib/types';

export const LOADOUT_TYPE_ICONS: Record<LoadoutType, string> = {
  file: 'audio_file',
  path: 'folder',
  type: 'extension',
  tags: 'tag',
  preset: 'bookmark'
};

export const LOADOUT_COLOR_VALUES: Record<LoadoutColor, string> = {
  white: '#f5f5f5',
  red: '#ef5350',
  orange: '#ff8a3d',
  amber: '#f6bd3a',
  lime: '#a6ce39',
  green: '#43b96e',
  teal: '#35b7a5',
  cyan: '#35b9d5',
  blue: '#4f8ee8',
  indigo: '#6674dc',
  violet: '#9569df',
  magenta: '#d858b0'
};

export function getLoadoutColorValue(color?: LoadoutColor): string {
  return color ? LOADOUT_COLOR_VALUES[color] : 'var(--accent-strong)';
}
