import { createSettingsStore } from './persistent-store';

export interface LoggingSettings {
  captureDebug: boolean;
  mirrorToConsole: boolean;
}

export const DEFAULT_LOGGING_SETTINGS: LoggingSettings = {
  captureDebug: false,
  mirrorToConsole: false
};

export function normalizeLoggingSettings(value: unknown): LoggingSettings {
  const source = value && typeof value === 'object' ? value as Partial<LoggingSettings> : {};
  return {
    captureDebug: typeof source.captureDebug === 'boolean'
      ? source.captureDebug
      : DEFAULT_LOGGING_SETTINGS.captureDebug,
    mirrorToConsole: typeof source.mirrorToConsole === 'boolean'
      ? source.mirrorToConsole
      : DEFAULT_LOGGING_SETTINGS.mirrorToConsole
  };
}

export const loggingSettings = createSettingsStore<LoggingSettings>({
  storageKey: 'izci.logging-settings.v1',
  channelName: 'izci-logging-settings-v1',
  defaultValue: DEFAULT_LOGGING_SETTINGS,
  normalize: normalizeLoggingSettings
});
