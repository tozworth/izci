import { createSettingsStore, normalizeBoolean } from './persistent-store';

interface LoggingSettings {
  captureDebug: boolean;
  mirrorToConsole: boolean;
}

const DEFAULT_LOGGING_SETTINGS: LoggingSettings = {
  captureDebug: false,
  mirrorToConsole: false
};

function normalizeLoggingSettings(value: unknown): LoggingSettings {
  const source = value && typeof value === 'object' ? value as Partial<LoggingSettings> : {};
  return {
    captureDebug: normalizeBoolean(source.captureDebug, DEFAULT_LOGGING_SETTINGS.captureDebug),
    mirrorToConsole: normalizeBoolean(source.mirrorToConsole, DEFAULT_LOGGING_SETTINGS.mirrorToConsole)
  };
}

export const loggingSettings = createSettingsStore<LoggingSettings>({
  storageKey: 'izci.logging-settings.v1',
  channelName: 'izci-logging-settings-v1',
  defaultValue: DEFAULT_LOGGING_SETTINGS,
  normalize: normalizeLoggingSettings
});
