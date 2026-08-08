import { readable } from 'svelte/store';
import { version as appVersion } from '../../../package.json';

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
  /** Unique per-window id (`<window>:<sequence>`); used to dedupe cross-window broadcasts. */
  id: string;
  timestamp: number;
  level: LogLevel;
  source: LogSource;
  /** The window (or context) that produced the entry. */
  window: string;
  message: string;
  /** JSON-safe details, normalized to a string so entries are always clone-safe. */
  details?: string;
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

/** Number of entries retained in memory per window. Logs are transient presentation data — never persisted. */
export const MAX_LOG_ENTRIES = 3000;

const CHANNEL_NAME = 'izci-logs';

interface LogChannelMessage {
  type: 'entry' | 'request';
  entry?: LogEntry;
}

const entries: LogEntry[] = [];
const listeners = new Set<(list: LogEntry[]) => void>();
const seenIds = new Set<string>();
const seenIdLimit = MAX_LOG_ENTRIES * 2;

let sequence = 0;
let channel: BroadcastChannel | null = null;
let initialized = false;

// Per-context token so entries from same-labeled contexts (two tabs, workers,
// or multiple test instances) never collide on id-based dedupe.
const instanceToken =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);

function getWindowLabel(): string {
  if (typeof location === 'undefined') return 'unknown';
  const path = location.pathname;
  if (path.endsWith('options.html')) return 'options';
  if (path.endsWith('troubadour-options.html')) return 'troubadour-options';
  if (path.endsWith('troubadour.html')) return 'troubadour';
  if (path.endsWith('editor.html')) return 'editor';
  if (path.endsWith('converter.html')) return 'converter';
  if (path.endsWith('audio-compare.html')) return 'audio-compare';
  if (path.endsWith('logs.html')) return 'logs';
  if (path.endsWith('index.html') || path === '/' || path === '') return 'main';
  return 'window';
}

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener('message', handleChannelMessage);
  } catch {
    channel = null;
  }
  return channel;
}

function normalizeDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) return undefined;
  if (typeof details === 'string') return details;
  try {
    const json = JSON.stringify(details);
    if (json !== undefined) return json;
  } catch {
    // Fall through to String() for non-serializable values.
  }
  try {
    return String(details);
  } catch {
    return undefined;
  }
}

function notifyListeners(): void {
  const snapshot = entries.slice();
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      // A faulty listener must not break logging itself.
    }
  }
}

function publishEntry(entry: LogEntry, broadcast: boolean): void {
  seenIds.add(entry.id);
  if (seenIds.size > seenIdLimit) {
    seenIds.clear();
    for (const existing of entries) seenIds.add(existing.id);
  }

  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    const overflow = entries.length - MAX_LOG_ENTRIES;
    entries.splice(0, overflow);
  }

  if (broadcast) {
    getChannel()?.postMessage({ type: 'entry', entry } satisfies LogChannelMessage);
  }

  notifyListeners();
}

function handleChannelMessage(event: MessageEvent<LogChannelMessage>): void {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'request') {
    // Re-broadcast our buffer so newly opened windows (e.g. the Logs popup)
    // receive history they missed; receivers dedupe by entry id.
    for (const entry of entries) {
      try {
        getChannel()?.postMessage({ type: 'entry', entry } satisfies LogChannelMessage);
      } catch {
        return;
      }
    }
    return;
  }

  if (message.type !== 'entry' || !isValidEntry(message.entry)) return;

  const entry = message.entry;
  if (seenIds.has(entry.id)) return;

  publishEntry(entry, false);
}

function isValidEntry(entry: LogEntry | undefined): entry is LogEntry {
  if (!entry || typeof entry !== 'object') return false;
  return (
    typeof entry.id === 'string'
    && typeof entry.message === 'string'
    && LOG_LEVELS.includes(entry.level)
    && LOG_SOURCES.includes(entry.source)
    && typeof entry.timestamp === 'number'
    && typeof entry.window === 'string'
  );
}

/**
 * Blink dispatches benign global error events when a ResizeObserver cannot
 * deliver its notifications within the frame budget — routine while resizing
 * any window; not an app defect. Filtering keeps resize storms out of the log.
 */
const BENIGN_GLOBAL_ERROR_MESSAGES = [
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded'
];

function isBenignGlobalError(event: ErrorEvent): boolean {
  return BENIGN_GLOBAL_ERROR_MESSAGES.includes(event.message);
}

function mirrorToConsole(entry: LogEntry): void {
  // Skip console mirroring outside browsers (node tests, workers without window).
  if (typeof window === 'undefined') return;
  const prefix = `[izci:${entry.level}] [${entry.source}] [${entry.window}]`;
  const text = `${entry.message}${entry.details ? ` ${entry.details}` : ''}`;
  switch (entry.level) {
    case 'error':
      console.error(prefix, text);
      break;
    case 'warning':
      console.warn(prefix, text);
      break;
    case 'info':
      console.info(prefix, text);
      break;
    case 'debug':
      console.debug(prefix, text);
      break;
  }
}

export function log(level: LogLevel, source: LogSource, message: string, details?: unknown): LogEntry {
  const normalizedDetails = normalizeDetails(details);
  const entry: LogEntry = {
    id: `${getWindowLabel()}:${instanceToken}:${++sequence}`,
    timestamp: Date.now(),
    level,
    source,
    window: getWindowLabel(),
    message,
    ...(normalizedDetails !== undefined ? { details: normalizedDetails } : {})
  };

  mirrorToConsole(entry);
  publishEntry(entry, true);
  return entry;
}

export function logError(source: LogSource, message: string, details?: unknown): LogEntry {
  return log('error', source, message, details);
}

export function logWarning(source: LogSource, message: string, details?: unknown): LogEntry {
  return log('warning', source, message, details);
}

export function logInfo(source: LogSource, message: string, details?: unknown): LogEntry {
  return log('info', source, message, details);
}

export function logDebug(source: LogSource, message: string, details?: unknown): LogEntry {
  return log('debug', source, message, details);
}

/** Snapshot of the in-memory log buffer (newest last). */
export function getLogEntries(): LogEntry[] {
  return entries.slice();
}

/**
 * Subscribes to log updates. The listener receives a snapshot of the whole
 * buffer on every change (including immediately on subscribe).
 */
export function subscribeLogs(listener: (list: LogEntry[]) => void): () => void {
  listeners.add(listener);
  try {
    listener(entries.slice());
  } catch {
    // Same protection as notifyListeners.
  }
  return () => listeners.delete(listener);
}

/** Clears this window's local buffer. Other windows keep theirs. */
export function clearLogs(): void {
  entries.length = 0;
  notifyListeners();
}

/** A Svelte store view of the shared log buffer. */
export const logsStore = readable<LogEntry[]>([], (set) => subscribeLogs(set));

/**
 * Initializes logging for the current window: attaches global error capture,
 * logs a startup banner, and asks other windows for their buffered history.
 * Idempotent — safe to call from every window entrypoint.
 */
export function initLogging(): void {
  if (initialized) return;
  initialized = true;

  getChannel();

  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      if (isBenignGlobalError(event)) return;
      logError('system', 'Uncaught error', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno
      });
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      logError('system', 'Unhandled promise rejection', {
        reason:
          reason instanceof Error
            ? reason.message
            : typeof reason === 'string'
              ? reason
              : undefined
      });
    });
  }

  logInfo('system', `${getWindowLabel()} window started`, {
    version: appVersion,
    ...(typeof navigator !== 'undefined'
      ? { platform: navigator.platform, userAgent: navigator.userAgent }
      : {})
  });

  getChannel()?.postMessage({ type: 'request' } satisfies LogChannelMessage);
}
