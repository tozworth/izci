import type { LogEntry, LogLevel, LogSource, LogWriteOptions } from './contracts';
import type { LoggingRuntime } from './runtime';

let activeRuntime: LoggingRuntime | undefined;

export function installLoggingRuntime(runtime: LoggingRuntime): () => void {
  activeRuntime = runtime;
  return () => {
    if (activeRuntime === runtime) activeRuntime = undefined;
  };
}

export function getLoggingRuntime(): LoggingRuntime | undefined {
  return activeRuntime;
}

export function log(
  level: LogLevel,
  source: LogSource,
  message: unknown,
  details?: unknown,
  options?: LogWriteOptions
): LogEntry | null {
  return activeRuntime?.log(level, source, message, details, options) ?? null;
}

export const logError = (
  source: LogSource,
  message: unknown,
  details?: unknown,
  options?: LogWriteOptions
) => log('error', source, message, details, options);

export const logWarning = (
  source: LogSource,
  message: unknown,
  details?: unknown,
  options?: LogWriteOptions
) => log('warning', source, message, details, options);

export const logInfo = (
  source: LogSource,
  message: unknown,
  details?: unknown,
  options?: LogWriteOptions
) => log('info', source, message, details, options);

export const logDebug = (
  source: LogSource,
  message: unknown,
  details?: unknown,
  options?: LogWriteOptions
) => log('debug', source, message, details, options);

export const createLogCorrelationId = (label?: string) => activeRuntime?.createCorrelationId(label) ?? null;
export const getLogEntries = () => activeRuntime?.getEntries() ?? [];
export const getOwnLogEntries = () => activeRuntime?.getOwnEntries() ?? [];
export const requestLogHistory = () => activeRuntime?.requestHistory() ?? null;
export const clearLogs = () => activeRuntime?.clear();

export function subscribeLogs(listener: (entries: LogEntry[]) => void): () => void {
  if (activeRuntime) return activeRuntime.subscribe(listener);
  try { listener([]); } catch { /* Subscriber failures stay isolated. */ }
  return () => undefined;
}

export type {
  LogEntry,
  LogLevel,
  LogSource,
  LogWriteOptions
} from './contracts';

