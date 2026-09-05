import { createSettingsStore } from './persistent-store';

interface UpNextPanelSettings {
  expanded: boolean;
  heightPx: number;
}

const UP_NEXT_PANEL_SETTINGS_STORAGE_KEY = 'izci.up-next-panel-settings';
const UP_NEXT_PANEL_SETTINGS_CHANNEL = 'izci.up-next-panel-settings';
const DEFAULT_UP_NEXT_PANEL_HEIGHT_PX = 184;
export const MIN_UP_NEXT_PANEL_HEIGHT_PX = 88;
export const MAX_UP_NEXT_PANEL_HEIGHT_PX = 480;
const DEFAULT_UP_NEXT_PANEL_SETTINGS: UpNextPanelSettings = {
  expanded: false,
  heightPx: DEFAULT_UP_NEXT_PANEL_HEIGHT_PX
};

function normalizeUpNextPanelSettings(value: unknown): UpNextPanelSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof UpNextPanelSettings, unknown>>)
      : {};

  const height = Number(source.heightPx);

  return {
    expanded: source.expanded === true,
    heightPx: Number.isFinite(height)
      ? Math.min(Math.max(Math.round(height), MIN_UP_NEXT_PANEL_HEIGHT_PX), MAX_UP_NEXT_PANEL_HEIGHT_PX)
      : DEFAULT_UP_NEXT_PANEL_HEIGHT_PX
  };
}

export const upNextPanelSettings = createSettingsStore({
  storageKey: UP_NEXT_PANEL_SETTINGS_STORAGE_KEY,
  channelName: UP_NEXT_PANEL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_UP_NEXT_PANEL_SETTINGS,
  normalize: normalizeUpNextPanelSettings
});
