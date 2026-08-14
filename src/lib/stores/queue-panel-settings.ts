import { createSettingsStore } from './persistent-store';

export interface QueuePanelSettings {
  expanded: boolean;
  heightPx: number;
}

export const QUEUE_PANEL_SETTINGS_STORAGE_KEY = 'izci.queue-panel-settings';
export const QUEUE_PANEL_SETTINGS_CHANNEL = 'izci.queue-panel-settings';
export const DEFAULT_QUEUE_PANEL_HEIGHT_PX = 184;
export const MIN_QUEUE_PANEL_HEIGHT_PX = 88;
export const MAX_QUEUE_PANEL_HEIGHT_PX = 480;
export const DEFAULT_QUEUE_PANEL_SETTINGS: QueuePanelSettings = {
  expanded: false,
  heightPx: DEFAULT_QUEUE_PANEL_HEIGHT_PX
};

function normalizeQueuePanelSettings(value: unknown): QueuePanelSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<Record<keyof QueuePanelSettings, unknown>>)
      : {};

  const height = Number(source.heightPx);

  return {
    expanded: source.expanded === true,
    heightPx: Number.isFinite(height)
      ? Math.min(Math.max(Math.round(height), MIN_QUEUE_PANEL_HEIGHT_PX), MAX_QUEUE_PANEL_HEIGHT_PX)
      : DEFAULT_QUEUE_PANEL_HEIGHT_PX
  };
}

export const queuePanelSettings = createSettingsStore({
  storageKey: QUEUE_PANEL_SETTINGS_STORAGE_KEY,
  channelName: QUEUE_PANEL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_QUEUE_PANEL_SETTINGS,
  normalize: normalizeQueuePanelSettings
});
