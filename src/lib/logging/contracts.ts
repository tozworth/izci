export type LogLevel = 'error' | 'warning' | 'info' | 'debug';

export type LogSource =
  | 'system'
  | 'playback'
  | 'decode'
  | 'files'
  | 'library'
  | 'tools'
  | 'multiplayer'
  | 'freeplay';

export interface LogEntry {
  readonly id: string;
  readonly correlationId: string;
  readonly originId: string;
  readonly timestamp: number;
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly context: string;
  readonly message: string;
  readonly details?: string;
}

export interface LoggingSettings {
  readonly captureDebug: boolean;
  readonly mirrorToConsole: boolean;
}

export interface LogWriteOptions {
  readonly correlationId?: string;
}

export interface LoggingConsole {
  error(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  info(...values: unknown[]): void;
  debug(...values: unknown[]): void;
}

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warning', 'info', 'debug'];
export const LOG_SOURCES: readonly LogSource[] = [
  'system',
  'playback',
  'decode',
  'files',
  'library',
  'tools',
  'multiplayer',
  'freeplay'
];

export const LOG_CHANNEL_NAME = 'izci-logs-v3';
export const LOG_PROTOCOL_VERSION = 1;
export const MAX_LOG_ENTRIES = 3000;
export const MAX_LOG_MESSAGE_IDS = 1024;
export const MAX_LOG_REQUEST_IDS = 128;
export const MAX_ACTIVE_LOG_REQUESTS = 8;

