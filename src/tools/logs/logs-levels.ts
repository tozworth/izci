import { createPersistentStore } from '$lib/stores/persistent-store';
import type { LogLevel } from '$lib/services/logging';

export type LogLevelVisibility = Record<LogLevel, boolean>;

/** Debug starts hidden; the popup shows error/warning/info unless the user opts in. */
export const LOG_LEVEL_DEFAULT_VISIBILITY: LogLevelVisibility = {
  error: true,
  warning: true,
  info: true,
  debug: false
};

const STORAGE_KEY = 'izci.logs-levels.v1';
const CHANNEL_NAME = 'izci-logs-levels-v1';

export function normalizeLogLevelVisibility(value: unknown): LogLevelVisibility {
  const source = value && typeof value === 'object' ? (value as Partial<LogLevelVisibility>) : {};
  const visibility = { ...LOG_LEVEL_DEFAULT_VISIBILITY };

  for (const level of Object.keys(LOG_LEVEL_DEFAULT_VISIBILITY) as LogLevel[]) {
    const entry = source[level];
    if (typeof entry === 'boolean') {
      visibility[level] = entry;
    }
  }

  return visibility;
}

const visibilityStore = createPersistentStore<LogLevelVisibility>({
  storageKey: STORAGE_KEY,
  channelName: CHANNEL_NAME,
  defaultValue: LOG_LEVEL_DEFAULT_VISIBILITY,
  normalize: normalizeLogLevelVisibility
});

export const logsLevelVisibility = {
  subscribe: visibilityStore.subscribe,
  getSnapshot: visibilityStore.getSnapshot,
  setVisibility(visibility: LogLevelVisibility): LogLevelVisibility {
    return visibilityStore.set(visibility);
  },
  reset: visibilityStore.reset
};
