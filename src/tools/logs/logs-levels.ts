import { createPersistentStore } from '$lib/stores/persistent-store';
import type { LogLevel } from '$lib/services/logging';

type LogLevelVisibility = Record<LogLevel, boolean>;
const LOG_LEVEL_DEFAULT_VISIBILITY: LogLevelVisibility = {
  error: true, warning: true, info: true, debug: false
};
function normalizeLogLevelVisibility(value: unknown): LogLevelVisibility {
  const source = value && typeof value === 'object' ? value as Partial<LogLevelVisibility> : {};
  const result = { ...LOG_LEVEL_DEFAULT_VISIBILITY };
  for (const level of Object.keys(result) as LogLevel[]) {
    if (typeof source[level] === 'boolean') result[level] = source[level];
  }
  return result;
}
const store = createPersistentStore<LogLevelVisibility>({
  storageKey: 'izci.logs-levels.v2', channelName: 'izci-logs-levels-v2',
  defaultValue: LOG_LEVEL_DEFAULT_VISIBILITY, normalize: normalizeLogLevelVisibility
});
export const logsLevelVisibility = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  setVisibility: (visibility: LogLevelVisibility) => store.set(visibility),
  reset: store.reset
};
